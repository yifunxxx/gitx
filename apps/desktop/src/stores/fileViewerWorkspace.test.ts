import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useFileViewerStore } from "./fileViewerStore";
const mocks = vi.hoisted(() => ({
  fsReadFile: vi.fn(),
  fsWriteFile: vi.fn(),
  diffFile: vi.fn(),
  fileWriteWorktree: vi.fn(),
  workspace: {} as any,
  layout: {} as any,
  refresh: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("./changesStore", () => ({ useChangesStore: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.workspace = reactive({
    folderPath: "C:/folder",
    repoPath: "C:/folder",
    repoId: "folder",
    isRepo: false,
    token: 1,
    appliedOpenToken() {
      return this.token;
    },
    navigationToken() {
      return this.token;
    },
  });
  mocks.layout = reactive({ activeEditorKind: "welcome" });
  mocks.fsReadFile.mockResolvedValue("initial\n");
  mocks.fsWriteFile.mockResolvedValue(null);
  mocks.diffFile.mockResolvedValue({ rightText: "initial\n", hunks: [] });
  mocks.fileWriteWorktree.mockResolvedValue(null);
});

it("opens and saves non-Git text without invoking Git operations", async () => {
  const store = useFileViewerStore();
  await store.open("src/note.txt", { folderPath: mocks.workspace.folderPath });
  const tab = store.tabs[0]!;
  expect(tab).toMatchObject({ editable: true, text: "initial\n", folderPath: "C:/folder" });
  expect(mocks.layout.activeEditorKind).toBe("file");
  store.setDocument(tab.id, "edited\n");
  expect(await store.saveActive()).toBe(true);
  expect(mocks.fsWriteFile).toHaveBeenCalledExactlyOnceWith({
    folderPath: "C:/folder",
    filePath: "src/note.txt",
    content: "edited\n",
  });
  expect(tab.dirty).toBe(false);
  expect(mocks.fileWriteWorktree).not.toHaveBeenCalled();
  expect(mocks.diffFile).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("keeps a dirty document through a directory move and saves to its new path", async () => {
  const store = useFileViewerStore();
  await store.open("src/a.txt", { folderPath: "C:/folder" });
  const tab = store.tabs[0]!;
  store.setDocument(tab.id, "unsaved text");
  tab.fileOperationPending = true;
  expect(await store.saveActive()).toBe(false);
  expect(mocks.fsWriteFile).not.toHaveBeenCalled();
  store.applyFileMutation("C:/folder", "move", [{ path: "src", destination: "dest" }]);
  tab.fileOperationPending = false;
  expect(tab.path).toBe("dest/a.txt");
  expect(tab.dirty).toBe(true);
  expect(store.activeId).toBe(tab.id);
  expect(await store.saveActive()).toBe(true);
  expect(mocks.fsWriteFile).toHaveBeenCalledWith({
    folderPath: "C:/folder",
    filePath: "dest/a.txt",
    content: "unsaved text",
  });
  await store.open("src/a.txt", { folderPath: "C:/folder" });
  expect(new Set(store.tabs.map((item) => item.id)).size).toBe(2);
});

it("keeps newer draft edits made while a non-Git save is pending", async () => {
  const store = useFileViewerStore();
  await store.open("note.txt");
  const tab = store.tabs[0]!;
  store.setDocument(tab.id, "first");
  const write = deferred();
  mocks.fsWriteFile.mockReturnValueOnce(write.promise);
  const saving = store.saveActive();
  store.setDocument(tab.id, "later");
  write.resolve(null);
  await saving;
  expect(tab).toMatchObject({ baseline: "first", text: "later", dirty: true, saving: false });
});
it("closes only successfully recycled clean tabs and preserves late drafts", async () => {
  const store = useFileViewerStore();
  await store.open("a", { folderPath: "C:/folder" });
  await store.open("b", { folderPath: "C:/folder" });
  await store.open("c", { folderPath: "C:/folder" });
  const draft = store.tabs[1]!;
  store.setDocument(draft.id, "late edit");
  store.applyFileMutation("C:/folder", "delete", [
    { path: "a", destination: null },
    { path: "b", destination: null },
  ]);
  expect(store.tabs.map((tab) => tab.path)).toEqual(["b", "c"]);
  expect(draft.deletedOnDisk).toBe(true);
  expect(draft.text).toBe("late edit");
  expect(await store.save(draft.id)).toBe(false);
});
it("opens another nested repository using its disk path instead of the active parent's Git path", async () => {
  mocks.workspace.isRepo = true;
  mocks.workspace.roots = [
    { id: "folder", worktreeRoot: "C:/folder" },
    { id: "nested", worktreeRoot: "C:/folder/nested" },
  ];
  const store = useFileViewerStore();
  await store.open("nested/a.txt", { folderPath: "C:/folder" });
  expect(mocks.fsReadFile).toHaveBeenCalledWith({
    folderPath: "C:/folder",
    filePath: "nested/a.txt",
  });
  expect(mocks.diffFile).not.toHaveBeenCalled();
});

it("keeps read failures uneditable and write failures dirty", async () => {
  const store = useFileViewerStore();
  mocks.fsReadFile.mockRejectedValueOnce(new Error("Binary file"));
  await store.open("image.png");
  expect(store.tabs[0]!.editable).toBe(false);
  expect(await store.saveActive()).toBe(false);
  await store.open("note.txt");
  store.setDocument(store.activeId!, "draft");
  mocks.fsWriteFile.mockRejectedValueOnce(new Error("denied"));
  expect(await store.saveActive()).toBe(false);
  expect(store.tabs[1]!.dirty).toBe(true);
  expect(mocks.toast).toHaveBeenCalledOnce();
});

it("blocks opening and saving during a filesystem mutation then resumes", async () => {
  const store = useFileViewerStore();
  await store.open("a");
  store.setDocument(store.activeId!, "draft");
  store.fileMutationPending = true;
  await store.open("b");
  expect(store.tabs).toHaveLength(1);
  expect(await store.saveActive()).toBe(false);
  store.fileMutationPending = false;
  expect(await store.saveActive()).toBe(true);
});

it("remaps a case-insensitive source into an inactive nested repository without losing its draft", async () => {
  mocks.workspace.isRepo = true;
  mocks.workspace.roots = [{ id: "nested", worktreeRoot: "C:/folder/nested" }];
  const store = useFileViewerStore();
  await store.open("SRC/a.txt", { folderPath: "C:/folder" });
  store.setDocument(store.activeId!, "draft");
  expect(store.affectedByFiles("C:/folder", ["src"])).toHaveLength(1);
  store.applyFileMutation("C:/folder", "move", [{ path: "src", destination: "nested" }]);
  expect(store.tabs[0]).toMatchObject({
    path: "nested/a.txt",
    folderPath: "C:/folder",
    dirty: true,
  });
  expect(await store.saveActive()).toBe(true);
  expect(mocks.fsWriteFile).toHaveBeenCalledWith({
    folderPath: "C:/folder",
    filePath: "nested/a.txt",
    content: "draft",
  });
});

it("ignores a closed/reopened tab's stale read and a same-path reopened workspace save", async () => {
  const old = deferred();
  mocks.fsReadFile.mockReturnValueOnce(old.promise);
  const store = useFileViewerStore();
  const loading = store.open("note.txt");
  store.closeTab(store.activeId!);
  await store.open("note.txt");
  old.resolve("stale");
  await loading;
  expect(store.tabs[0]!.text).toBe("initial\n");
  store.setDocument(store.activeId!, "draft");
  const write = deferred();
  mocks.fsWriteFile.mockReturnValueOnce(write.promise);
  const saving = store.saveActive();
  mocks.workspace.token++;
  await store.open("note.txt");
  write.resolve(null);
  expect(await saving).toBe(false);
  expect(store.tabs[0]).toMatchObject({ text: "initial\n", dirty: false });
});

it("maps a workspace subdirectory to repository-relative paths and deduplicates existing tabs", async () => {
  Object.assign(mocks.workspace, {
    isRepo: true,
    repoPath: "C:/repo",
    repoId: "repo",
    folderPath: "C:/repo/src",
  });
  const store = useFileViewerStore();
  await store.open("app.ts", { folderPath: "C:/repo/src" });
  expect(mocks.fsReadFile).toHaveBeenCalledWith({ folderPath: "C:/repo/src", filePath: "app.ts" });
  expect(mocks.diffFile).toHaveBeenCalledWith(
    expect.objectContaining({ filePath: "src/app.ts", path: "C:/repo" }),
  );
  await store.open("src/app.ts");
  expect(store.tabs).toHaveLength(1);
  expect(store.tabs[0]!.id).toBe("file:src/app.ts");
  store.setDocument(store.activeId!, "edit");
  await store.saveActive();
  expect(mocks.fileWriteWorktree).toHaveBeenCalledWith(
    expect.objectContaining({ filePath: "src/app.ts" }),
  );
});

it("opens a workspace file outside the active repo through filesystem endpoints", async () => {
  Object.assign(mocks.workspace, {
    isRepo: true,
    folderPath: "C:/workspace",
    repoPath: "C:/workspace/repo",
  });
  const store = useFileViewerStore();
  await store.open("notes.txt", { folderPath: "C:/workspace" });
  expect(store.tabs[0]!.folderPath).toBe("C:/workspace");
  expect(mocks.diffFile).not.toHaveBeenCalled();
});

it("opens a large Commit file from its full disk text and preserves it when saving", async () => {
  mocks.workspace.isRepo = true;
  const text = "large line\n".repeat(530_000) + "last line\n";
  mocks.fsReadFile.mockResolvedValue(text);
  mocks.diffFile.mockResolvedValue({ rightText: null, hunks: [], tooLarge: true });
  const store = useFileViewerStore();
  await store.open("large.txt");
  const tab = store.tabs[0]!;
  expect(tab.text.length).toBe(text.length);
  expect(tab.text === text && tab.baseline === text).toBe(true);
  expect(tab).toMatchObject({ editable: true, dirty: false });
  store.setDocument(tab.id, text + "appended\n");
  expect(await store.saveActive()).toBe(true);
  expect(mocks.fileWriteWorktree).toHaveBeenCalledWith(
    expect.objectContaining({ filePath: "large.txt", content: text + "appended\n" }),
  );
  expect(mocks.diffFile).not.toHaveBeenCalled();
});

it.each([
  ["binary.dat", "binary files cannot be edited as text", null],
  ["legacy.txt", "file is not valid UTF-8 text", "replacement �"],
  ["deleted.txt", "file not found", null],
])(
  "does not expose %s from Commit as an editable empty or lossy file",
  async (path, error, diffText) => {
    mocks.workspace.isRepo = true;
    mocks.fsReadFile.mockRejectedValue(new Error(error));
    mocks.diffFile.mockResolvedValue({ rightText: diffText, hunks: [] });
    const store = useFileViewerStore();
    await store.open(path);
    const tab = store.tabs[0]!;
    expect(tab.editable).toBe(false);
    expect(tab.text).toContain(error);
    store.setDocument(tab.id, "accidental overwrite");
    expect(await store.saveActive()).toBe(false);
    expect(mocks.fileWriteWorktree).not.toHaveBeenCalled();
    expect(mocks.fsWriteFile).not.toHaveBeenCalled();
    expect(mocks.diffFile).not.toHaveBeenCalled();
  },
);

it("retains exact disk text and omits gutters from a different diff snapshot", async () => {
  mocks.workspace.isRepo = true;
  const text = "\uFEFFcurrent\r\n中文 😀\r\n";
  mocks.fsReadFile.mockResolvedValue(text);
  mocks.diffFile.mockResolvedValue({ rightText: "other snapshot\n", hunks: [{ index: 0 }] });
  const store = useFileViewerStore();
  await store.open("note.txt");
  expect(store.tabs[0]).toMatchObject({ text, baseline: text, hunks: [], editable: true });
  expect(mocks.fsReadFile).toHaveBeenCalledWith({ folderPath: "C:/folder", filePath: "note.txt" });
});

it.each([false, true])(
  "keeps valid text editable when optional Git gutters fail (File source: %s)",
  async (source) => {
    mocks.workspace.isRepo = true;
    mocks.diffFile.mockRejectedValue(new Error("HEAD unavailable"));
    const store = useFileViewerStore();
    await store.open("note.txt", source ? { folderPath: "C:/folder" } : undefined);
    expect(store.tabs[0]).toMatchObject({
      text: "initial\n",
      baseline: "initial\n",
      hunks: [],
      editable: true,
    });
    store.setDocument(store.activeId!, "saved\n");
    expect(await store.saveActive()).toBe(true);
    expect(mocks.fileWriteWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ content: "saved\n" }),
    );
  },
);

it.each(["binary HEAD", "large HEAD"])(
  "opens valid worktree text when the diff omits it for %s",
  async (reason) => {
    mocks.workspace.isRepo = true;
    mocks.diffFile.mockResolvedValue({
      rightText: null,
      hunks: [],
      binary: reason === "binary HEAD",
      tooLarge: reason === "large HEAD",
    });
    const store = useFileViewerStore();
    await store.open("converted.txt");
    expect(store.tabs[0]).toMatchObject({ text: "initial\n", editable: true, hunks: [] });
  },
);

it("keeps matching HEAD gutter data without using it as the editing source", async () => {
  mocks.workspace.isRepo = true;
  const hunks = [{ index: 0 }];
  mocks.diffFile.mockResolvedValue({ rightText: "initial\n", hunks });
  const store = useFileViewerStore();
  await store.open("note.txt");
  expect(store.tabs[0]).toMatchObject({ text: "initial\n", hunks });
  expect(mocks.fsReadFile).toHaveBeenCalledOnce();
});

it.each(["navigation", "reopen"])(
  "ignores an optional gutter result after %s invalidates the file",
  async (change) => {
    mocks.workspace.isRepo = true;
    const old = deferred();
    mocks.diffFile.mockReturnValueOnce(old.promise);
    const store = useFileViewerStore();
    const pending = store.open("note.txt");
    await vi.waitFor(() => expect(mocks.diffFile).toHaveBeenCalledOnce());
    if (change === "navigation") mocks.workspace.token++;
    else store.closeTab(store.activeId!);
    mocks.fsReadFile.mockResolvedValue("new file\n");
    mocks.diffFile.mockResolvedValue({ rightText: "new file\n", hunks: [] });
    await store.open("note.txt");
    old.resolve({ rightText: "initial\n", hunks: [{ index: 0 }] });
    await pending;
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0]).toMatchObject({
      text: "new file\n",
      baseline: "new file\n",
      hunks: [],
      loading: false,
    });
  },
);
