import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { topLevelPaths, useFileOperationsStore } from "./fileOperationsStore";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  tabs: [] as any[],
  fsMutate: vi.fn(),
  refreshTree: vi.fn(),
  refreshChanges: vi.fn(),
  prompt: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  apply: vi.fn(),
  open: vi.fn(),
  snapshot: null as any,
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./fileTreeStore", () => ({
  useFileTreeStore: () => ({ refreshExpanded: mocks.refreshTree }),
}));
vi.mock("./changesStore", () => ({
  useChangesStore: () => ({ refresh: mocks.refreshChanges, snapshot: mocks.snapshot }),
}));
vi.mock("./fileViewerStore", () => ({
  useFileViewerStore: () => ({
    affectedByFiles: () => mocks.tabs,
    applyFileMutation: mocks.apply,
    open: mocks.open,
  }),
}));
vi.mock("@/composables/useConfirm", () => ({
  promptDialog: mocks.prompt,
  confirmDialog: mocks.confirm,
}));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.workspace = reactive({
    folderPath: "C:/project",
    isRepo: true,
    token: 1,
    navigationToken() {
      return this.token;
    },
    appliedOpenToken() {
      return this.token;
    },
  });
  mocks.tabs = [];
  mocks.snapshot = null;
  mocks.confirm.mockResolvedValue(true);
  mocks.fsMutate.mockResolvedValue({ completed: [], failures: [] });
});

it("creates a file in the selected directory and opens only a successful result", async () => {
  mocks.prompt.mockResolvedValue("中文.txt");
  mocks.fsMutate.mockResolvedValue({
    completed: [{ path: "src/中文.txt", destination: null }],
    failures: [],
  });
  await useFileOperationsStore().run("createFile", ["src"]);
  expect(mocks.fsMutate).toHaveBeenCalledExactlyOnceWith({
    folderPath: "C:/project",
    operation: "createFile",
    items: [{ path: "src/中文.txt", destination: null }],
  });
  expect(mocks.refreshTree).toHaveBeenCalledTimes(1);
  expect(mocks.refreshChanges).toHaveBeenCalledWith(true);
  expect(mocks.open).toHaveBeenCalledWith("src/中文.txt", { folderPath: "C:/project" });
});

it("cancels prompts and abandons accepted prompts from another workspace", async () => {
  mocks.prompt.mockResolvedValueOnce(null);
  await useFileOperationsStore().run("rename", ["a"]);
  const prompt = deferred<string>();
  mocks.prompt.mockReturnValueOnce(prompt.promise);
  const task = useFileOperationsStore().run("rename", ["a"]);
  mocks.workspace.token++;
  prompt.resolve("b");
  await task;
  expect(mocks.fsMutate).not.toHaveBeenCalled();
});

it("prevents duplicate commands and saves while mutation is pending", async () => {
  const pending = deferred<any>();
  mocks.prompt.mockResolvedValue("b");
  mocks.tabs = [{ dirty: true, loading: false, saving: false }];
  mocks.fsMutate.mockReturnValueOnce(pending.promise);
  const store = useFileOperationsStore();
  const task = store.run("rename", ["a"]);
  await vi.waitFor(() => expect(mocks.fsMutate).toHaveBeenCalledTimes(1));
  expect(mocks.tabs[0].fileOperationPending).toBe(true);
  await store.run("rename", ["a"]);
  pending.resolve({ completed: [{ path: "a", destination: "b" }], failures: [] });
  await task;
  expect(mocks.tabs[0].fileOperationPending).toBe(false);
  expect(mocks.apply).toHaveBeenCalledWith("C:/project", "rename", [
    { path: "a", destination: "b" },
  ]);
  expect(mocks.fsMutate).toHaveBeenCalledTimes(1);
  expect(store.busy).toBe(false);
});

it("reports conflicts and refreshes partial success without retrying the disk operation", async () => {
  mocks.prompt.mockResolvedValue("target");
  const completed = [{ path: "a", destination: "target/a" }];
  mocks.fsMutate.mockResolvedValue({
    completed,
    failures: [{ path: "b", message: "destination exists" }],
  });
  await useFileOperationsStore().run("move", ["a", "b"]);
  expect(mocks.apply).toHaveBeenCalledWith("C:/project", "move", completed);
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ description: "b: destination exists" }),
  );
  expect(mocks.refreshTree).toHaveBeenCalledTimes(1);
});

it("requires confirmation for copying saved content when a selected file has a draft", async () => {
  mocks.tabs = [{ dirty: true }];
  mocks.prompt.mockResolvedValue("copy");
  mocks.confirm.mockResolvedValue(false);
  await useFileOperationsStore().run("copy", ["a"]);
  expect(mocks.fsMutate).not.toHaveBeenCalled();
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
});

it("does not apply an old mutation to a new workspace and still releases busy state", async () => {
  mocks.prompt.mockResolvedValue("b");
  const pending = deferred<any>();
  mocks.fsMutate.mockReturnValue(pending.promise);
  const store = useFileOperationsStore();
  const task = store.run("move", ["a"]);
  await vi.waitFor(() => expect(mocks.fsMutate).toHaveBeenCalledTimes(1));
  mocks.workspace.token++;
  pending.resolve({ completed: [{ path: "a", destination: "b" }], failures: [] });
  await task;
  expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.refreshTree).not.toHaveBeenCalled();
  expect(store.busy).toBe(false);
});

it("normalizes a parent/child multiselection without scheduling the same subtree twice", () => {
  expect(topLevelPaths(["src/a", "b", "src", "b", "src-other"])).toEqual(["b", "src", "src-other"]);
});

it("protects discovered repository roots and unresolved conflict files", async () => {
  mocks.workspace.roots = [{ worktreeRoot: "C:/project/parent/repo" }];
  mocks.prompt.mockResolvedValue("renamed");
  await useFileOperationsStore().run("move", ["PARENT"]);
  expect(mocks.fsMutate).not.toHaveBeenCalled();
  mocks.workspace.repoId = "repo";
  mocks.workspace.repoPath = "C:/project";
  mocks.snapshot = { repoId: "repo", files: [{ path: "src/conflict.txt", kind: "unmerged" }] };
  await useFileOperationsStore().run("rename", ["src"]);
  expect(mocks.fsMutate).not.toHaveBeenCalled();
});
it("rechecks saving after the copy confirmation resolves", async () => {
  const confirm = deferred<boolean>();
  mocks.tabs = [{ dirty: true, saving: false }];
  mocks.prompt.mockResolvedValue("copy");
  mocks.confirm.mockReturnValue(confirm.promise);
  const task = useFileOperationsStore().run("copy", ["a"]);
  await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
  mocks.tabs[0].saving = true;
  confirm.resolve(true);
  await task;
  expect(mocks.fsMutate).not.toHaveBeenCalled();
});
it("confirms recycle operations and blocks unsaved drafts", async () => {
  mocks.confirm.mockResolvedValueOnce(false);
  await useFileOperationsStore().run("delete", ["a"]);
  expect(mocks.fsMutate).not.toHaveBeenCalled();
  mocks.tabs = [{ dirty: true }];
  await useFileOperationsStore().run("delete", ["a"]);
  expect(mocks.fsMutate).not.toHaveBeenCalled();
  mocks.tabs = [];
  await useFileOperationsStore().run("delete", ["a"]);
  expect(mocks.fsMutate).toHaveBeenCalledWith({
    folderPath: "C:/project",
    operation: "delete",
    items: [{ path: "a", destination: null }],
  });
});
