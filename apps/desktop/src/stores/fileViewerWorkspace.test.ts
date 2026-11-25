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
