import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { reactive } from "vue";
import { useFileOperationsStore } from "./fileOperationsStore";
import { useFileViewerStore } from "./fileViewerStore";
import { useJobsStore } from "./jobsStore";

const m = vi.hoisted(() => ({
  workspace: {} as any,
  layout: {} as any,
  fsReadFile: vi.fn(),
  fsWriteFile: vi.fn(),
  fsMutate: vi.fn(),
  jobList: vi.fn(),
  refresh: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => m.workspace }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => m.layout }));
vi.mock("./fileTreeStore", () => ({ useFileTreeStore: () => ({ refreshExpanded: m.refresh }) }));
vi.mock("./changesStore", () => ({ useChangesStore: () => ({ snapshot: null }) }));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: m.confirm, promptDialog: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let pinia: Pinia;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  m.workspace = reactive({
    folderPath: "C:/project",
    repoPath: null,
    repoId: null,
    isRepo: false,
    roots: [],
    token: 1,
    navigationToken() {
      return this.token;
    },
    appliedOpenToken() {
      return this.token;
    },
  });
  m.layout = reactive({ activeEditorKind: "welcome" });
  m.fsReadFile.mockImplementation(async ({ filePath }) => `disk ${filePath}`);
  m.fsMutate.mockResolvedValue({ completed: [], failures: [] });
  m.jobList.mockResolvedValue([]);
  m.confirm.mockResolvedValue(true);
});
afterEach(() => disposePinia(pinia));

async function draft(path = "a.txt") {
  const viewer = useFileViewerStore();
  await viewer.open(path, { folderPath: "C:/project" });
  const tab = viewer.tabs.find((item) => item.path === path)!;
  viewer.setDocument(tab.id, `draft ${path}`);
  return tab;
}

it.each(["rejected", "failed result"])(
  "keeps a confirmed draft dirty and saveable after deletion is %s",
  async (outcome) => {
    const tab = await draft();
    if (outcome === "rejected") m.fsMutate.mockRejectedValueOnce(new Error("access denied"));
    else
      m.fsMutate.mockResolvedValueOnce({
        completed: [],
        failures: [{ path: "a.txt", message: "access denied" }],
      });
    await useFileOperationsStore().run("delete", ["a.txt"]);
    expect(tab.dirty).toBe(true);
    expect(tab.text).toBe("draft a.txt");
    expect(tab.deletedOnDisk).not.toBe(true);
    expect(useFileViewerStore().tabs).toContain(tab);
    expect(await useFileViewerStore().save(tab.id)).toBe(true);
    expect(m.fsWriteFile).toHaveBeenCalledExactlyOnceWith({
      folderPath: "C:/project",
      filePath: "a.txt",
      content: "draft a.txt",
    });
    expect(useJobsStore().count).toBe(0);
    expect(useFileOperationsStore().busy).toBe(false);
  },
);

it("keeps the unsaved marker throughout pending deletion and blocks saving until it ends", async () => {
  const tab = await draft();
  const pending = deferred<any>();
  m.fsMutate.mockReturnValueOnce(pending.promise);
  const request = useFileOperationsStore().run("delete", ["a.txt"]);
  await vi.waitFor(() => expect(m.fsMutate).toHaveBeenCalledOnce());
  const dirtyWhilePending = tab.dirty;
  const saveWhilePending = await useFileViewerStore().save(tab.id);
  const pendingTab = tab.fileOperationPending;
  pending.resolve({ completed: [], failures: [{ path: "a.txt", message: "locked" }] });
  await request;
  expect(dirtyWhilePending).toBe(true);
  expect(pendingTab).toBe(true);
  expect(saveWhilePending).toBe(false);
  expect(m.fsWriteFile).not.toHaveBeenCalled();
  expect(tab.fileOperationPending).toBe(false);
  expect(useFileViewerStore().fileMutationPending).toBe(false);
});

it.each([
  { paths: ["a.txt", "b.txt"], files: ["a.txt", "b.txt"] },
  { paths: ["src", "locked"], files: ["src/a.txt", "locked/b.txt"] },
])("discards only successfully recycled drafts for $paths", async ({ paths, files }) => {
  const removed = await draft(files[0]);
  const retained = await draft(files[1]);
  m.fsMutate.mockResolvedValueOnce({
    completed: [{ path: paths[0], destination: null }],
    failures: [{ path: paths[1], message: "locked" }],
  });
  await useFileOperationsStore().run("delete", paths);
  expect(useFileViewerStore().tabs).not.toContain(removed);
  expect(useFileViewerStore().tabs).toContain(retained);
  expect(retained.dirty).toBe(true);
  expect(retained.text).toBe(`draft ${files[1]}`);
  expect(retained.deletedOnDisk).not.toBe(true);
  expect(m.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      description: `${paths[1]}: locked`,
    }),
  );
});

it("preserves the draft if a save starts before discard confirmation finishes", async () => {
  const tab = await draft();
  const confirm = deferred<boolean>();
  const saving = deferred<void>();
  m.confirm.mockResolvedValueOnce(true).mockReturnValueOnce(confirm.promise);
  m.fsWriteFile.mockReturnValueOnce(saving.promise);
  const deleting = useFileOperationsStore().run("delete", ["a.txt"]);
  await vi.waitFor(() => expect(m.confirm).toHaveBeenCalledTimes(2));
  const save = useFileViewerStore().save(tab.id);
  confirm.resolve(true);
  await deleting;
  const dirtyBeforeSaveSettles = tab.dirty;
  saving.reject(new Error("disk unavailable"));
  expect(await save).toBe(false);
  expect(m.fsMutate).not.toHaveBeenCalled();
  expect(dirtyBeforeSaveSettles).toBe(true);
  expect(tab.dirty).toBe(true);
});

it.each(["confirmation", "recycling"])(
  "retains edits entered during %s even when recycling succeeds",
  async (phase) => {
    const tab = await draft();
    const confirm = deferred<boolean>();
    const mutation = deferred<any>();
    m.confirm.mockResolvedValueOnce(true).mockReturnValueOnce(confirm.promise);
    m.fsMutate.mockReturnValueOnce(mutation.promise);
    const request = useFileOperationsStore().run("delete", ["a.txt"]);
    await vi.waitFor(() => expect(m.confirm).toHaveBeenCalledTimes(2));
    if (phase === "confirmation") useFileViewerStore().setDocument(tab.id, "newer draft");
    confirm.resolve(true);
    await vi.waitFor(() => expect(m.fsMutate).toHaveBeenCalledOnce());
    if (phase === "recycling") useFileViewerStore().setDocument(tab.id, "newer draft");
    mutation.resolve({ completed: [{ path: "a.txt", destination: null }], failures: [] });
    await request;
    expect(useFileViewerStore().tabs).toContain(tab);
    expect(tab.text).toBe("newer draft");
    expect(tab.dirty).toBe(true);
    expect(tab.deletedOnDisk).toBe(true);
    expect(await useFileViewerStore().save(tab.id)).toBe(false);
    expect(m.fsWriteFile).not.toHaveBeenCalled();
  },
);

it("closes an unchanged confirmed draft only after successful recycling", async () => {
  const tab = await draft();
  m.fsMutate.mockResolvedValueOnce({
    completed: [{ path: "a.txt", destination: null }],
    failures: [],
  });
  await useFileOperationsStore().run("delete", ["a.txt"]);
  expect(m.confirm).toHaveBeenCalledTimes(2);
  expect(useFileViewerStore().tabs).not.toContain(tab);
  expect(useFileViewerStore().activeId).toBeNull();
  expect(m.layout.activeEditorKind).toBe("welcome");
});

it("keeps the draft untouched when discard is cancelled", async () => {
  const tab = await draft();
  m.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await useFileOperationsStore().run("delete", ["a.txt"]);
  expect(m.fsMutate).not.toHaveBeenCalled();
  expect(tab.text).toBe("draft a.txt");
  expect(tab.dirty).toBe(true);
  expect(useFileViewerStore().tabs).toContain(tab);
});

it("asks again on retry and closes only after the new deletion succeeds", async () => {
  const tab = await draft();
  m.fsMutate.mockResolvedValueOnce({
    completed: [],
    failures: [{ path: "a.txt", message: "locked" }],
  });
  const operations = useFileOperationsStore();
  await operations.run("delete", ["a.txt"]);
  useFileViewerStore().setDocument(tab.id, "retry draft");
  m.fsMutate.mockResolvedValueOnce({
    completed: [{ path: "a.txt", destination: null }],
    failures: [],
  });
  await operations.run("delete", ["a.txt"]);
  expect(m.confirm).toHaveBeenCalledTimes(4);
  expect(m.fsMutate).toHaveBeenCalledTimes(2);
  expect(useFileViewerStore().tabs).not.toContain(tab);
  expect(useJobsStore().count).toBe(0);
});

it("does not apply an old discard to a reopened tab with the same id and text", async () => {
  const original = await draft();
  const confirm = deferred<boolean>();
  m.confirm.mockResolvedValueOnce(true).mockReturnValueOnce(confirm.promise);
  const request = useFileOperationsStore().run("delete", ["a.txt"]);
  await vi.waitFor(() => expect(m.confirm).toHaveBeenCalledTimes(2));
  useFileViewerStore().closeTab(original.id);
  const replacement = await draft();
  expect(replacement.id).toBe(original.id);
  expect(replacement.text).toBe(original.text);
  m.fsMutate.mockResolvedValueOnce({
    completed: [{ path: "a.txt", destination: null }],
    failures: [],
  });
  confirm.resolve(true);
  await request;
  expect(useFileViewerStore().tabs).toContain(replacement);
  expect(replacement.dirty).toBe(true);
  expect(replacement.deletedOnDisk).toBe(true);
});
