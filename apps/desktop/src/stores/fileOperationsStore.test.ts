import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { reactive } from "vue";
import { topLevelPaths, useFileOperationsStore } from "./fileOperationsStore";
import { useJobsStore } from "./jobsStore";
import { i18n } from "@/i18n";

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
  jobList: vi.fn(),
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
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let pinia: Pinia;
afterEach(() => disposePinia(pinia));
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
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
  mocks.jobList.mockResolvedValue([]);
});

it.each(["createFile", "createDirectory", "rename", "copy", "move", "delete"] as const)(
  "keeps %s visible through mutation and refresh, starting only after confirmation",
  async (operation) => {
    const answer = deferred<any>(),
      mutation = deferred<any>(),
      refresh = deferred<void>();
    mocks.prompt.mockReturnValue(answer.promise);
    mocks.confirm.mockReturnValue(answer.promise);
    mocks.fsMutate.mockReturnValue(mutation.promise);
    mocks.refreshTree.mockReturnValue(refresh.promise);
    const jobs = useJobsStore(),
      store = useFileOperationsStore();
    const request = store.run(operation, ["a"]);
    expect(store.busy).toBe(true);
    expect(jobs.count).toBe(0);
    answer.resolve(operation === "delete" ? true : "b");
    await vi.waitFor(() => expect(mocks.fsMutate).toHaveBeenCalledOnce());
    const title = i18n.global.t(`fileOps.running.${operation}`);
    expect(jobs.running).toEqual([
      expect.objectContaining({ title, message: "C:/project", cancellable: false }),
    ]);
    expect(store.activityTitle).toBe(title);
    await jobs.refresh();
    expect(jobs.count).toBe(1);
    await store.run(operation, ["duplicate"]);
    expect(mocks.fsMutate).toHaveBeenCalledOnce();
    mutation.resolve({ completed: [], failures: [] });
    await vi.waitFor(() => expect(mocks.refreshTree).toHaveBeenCalledOnce());
    expect(jobs.count).toBe(1);
    refresh.resolve();
    await request;
    expect(jobs.count).toBe(0);
    expect(store.busy).toBe(false);
    expect(store.activityTitle).toBe("");
  },
);

it("does not create tasks for cancelled or rejected file operations", async () => {
  const jobs = useJobsStore(),
    store = useFileOperationsStore();
  mocks.prompt.mockResolvedValue(null);
  await store.run("rename", ["a"]);
  mocks.confirm.mockResolvedValue(false);
  await store.run("delete", ["a"]);
  mocks.prompt.mockResolvedValue("b");
  mocks.tabs = [{ saving: true }];
  await store.run("move", ["a"]);
  expect(mocks.fsMutate).not.toHaveBeenCalled();
  expect(jobs.count).toBe(0);
  expect(store.busy).toBe(false);
});

it("finishes a failed task and allows a successful retry", async () => {
  const jobs = useJobsStore(),
    store = useFileOperationsStore();
  mocks.prompt.mockResolvedValue("b");
  mocks.fsMutate.mockRejectedValueOnce(new Error("disk unavailable"));
  await store.run("copy", ["a"]);
  expect(jobs.count).toBe(0);
  expect(store.busy).toBe(false);
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ description: "disk unavailable" }),
  );
  await store.run("copy", ["a"]);
  expect(mocks.fsMutate).toHaveBeenCalledTimes(2);
  expect(jobs.count).toBe(0);
});

it.each(["success", "failure"])(
  "keeps a late %s task attributed to its source workspace",
  async (outcome) => {
    mocks.prompt.mockResolvedValue("b");
    const mutation = deferred<any>();
    mocks.fsMutate.mockReturnValue(mutation.promise);
    const jobs = useJobsStore(),
      store = useFileOperationsStore();
    const request = store.run("move", ["a"]);
    await vi.waitFor(() => expect(mocks.fsMutate).toHaveBeenCalledOnce());
    mocks.workspace.folderPath = "C:/other";
    mocks.workspace.token++;
    expect(store.activityTitle).toBe("");
    expect(jobs.running.map((job) => job.message)).toEqual(["C:/project"]);
    const other = jobs.begin("new workspace task", "C:/other");
    if (outcome === "success")
      mutation.resolve({ completed: [{ path: "a", destination: "b" }], failures: [] });
    else mutation.reject(new Error("old failure"));
    await request;
    expect(jobs.running.map((job) => job.id)).toEqual([other]);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.refreshTree).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(store.busy).toBe(false);
  },
);

it("finishes partial results and a rejected refresh without leaving a task or repeating disk work", async () => {
  const jobs = useJobsStore(),
    store = useFileOperationsStore();
  mocks.prompt.mockResolvedValue("target");
  mocks.fsMutate.mockResolvedValue({
    completed: [{ path: "a", destination: "target/a" }],
    failures: [{ path: "b", message: "exists" }],
  });
  await store.run("copy", ["a", "b"]);
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "b: exists" }));
  expect(jobs.count).toBe(0);
  mocks.refreshTree.mockRejectedValueOnce(new Error("refresh unavailable"));
  await store.run("copy", ["a", "b"]);
  expect(mocks.fsMutate).toHaveBeenCalledTimes(2);
  expect(jobs.count).toBe(0);
  expect(store.activityTitle).toBe("");
  expect(store.busy).toBe(false);
});

it("does not publish disposed work or finish a replacement store's task", async () => {
  mocks.prompt.mockResolvedValue("b");
  const mutation = deferred<any>();
  mocks.fsMutate.mockReturnValue(mutation.promise);
  const jobs = useJobsStore(),
    store = useFileOperationsStore();
  const request = store.run("move", ["a"]);
  await vi.waitFor(() => expect(mocks.fsMutate).toHaveBeenCalledOnce());
  store.$dispose();
  jobs.$dispose();
  pinia.state.value.jobs = undefined as any;
  const replacement = useJobsStore();
  const next = replacement.begin("new task");
  mutation.resolve({ completed: [{ path: "a", destination: "b" }], failures: [] });
  await request;
  expect(replacement.running.map((job) => job.id)).toEqual([next]);
  expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.refreshTree).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
  await store.run("move", ["ignored after disposal"]);
  expect(mocks.fsMutate).toHaveBeenCalledOnce();
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
  expect(mocks.apply).toHaveBeenCalledWith(
    "C:/project",
    "rename",
    [{ path: "a", destination: "b" }],
    undefined,
  );
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
  expect(mocks.apply).toHaveBeenCalledWith("C:/project", "move", completed, undefined);
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

it("does not compare every selected path with every other path before prompting", () => {
  const paths = Array.from({ length: 512 }, (_, index) => `src/file-${index}.txt`);
  const original = String.prototype.startsWith;
  let comparisons = 0;
  let result: string[];
  // Count only synchronous path comparisons; avoid wall-time thresholds and
  // restore the intrinsic before assertions or any asynchronous work runs.
  try {
    String.prototype.startsWith = function (search, position) {
      comparisons++;
      return original.call(this, search, position);
    };
    result = topLevelPaths(paths);
  } finally {
    String.prototype.startsWith = original;
  }
  expect(result!).toEqual(paths);
  expect(comparisons).toBeLessThan(paths.length * 20);
});

it("preserves selection order, directory boundaries and literal path spelling", () => {
  const paths = [
    "src/nested/file",
    "src-other/file",
    "中文 空格/😀/file",
    "src/nested",
    "SRC/file",
    "src",
    "src-other",
    "中文 空格/😀",
    "src",
    "src2/file",
    "src2",
    "leaf",
  ];
  const snapshot = [...paths];
  expect(topLevelPaths(paths)).toEqual([
    "SRC/file",
    "src",
    "src-other",
    "中文 空格/😀",
    "src2",
    "leaf",
  ]);
  expect(paths).toEqual(snapshot);
  // This helper does not canonicalize input or replace backend validation.
  expect(topLevelPaths(["", "/a", "folder/", "folder//a", "folder/a", "a\\b", "a"])).toEqual([
    "",
    "folder/",
    "folder/a",
    "a\\b",
    "a",
  ]);
  expect(topLevelPaths([])).toEqual([]);
});

it("matches subtree selection semantics across varied order and duplicates", () => {
  const pool = [
    "",
    "a",
    "a/b",
    "a/b/c",
    "ab",
    "ab/c",
    "A",
    "A/b",
    "中文/空 格",
    "中文",
    "file.txt",
    "nested/leaf",
  ];
  let seed = 107;
  for (let round = 0; round < 160; round++) {
    const selection = Array.from({ length: 1 + (round % 40) }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return pool[seed % pool.length]!;
    });
    const distinct = [...new Set(selection)];
    const expected = distinct.filter(
      (path) => !distinct.some((parent) => parent !== path && path.startsWith(`${parent}/`)),
    );
    expect(topLevelPaths(selection)).toEqual(expected);
  }
});

it.each(["copy", "move", "delete"] as const)(
  "dispatches only top-level %s entries in their original order",
  async (operation) => {
    mocks.prompt.mockResolvedValue("destination");
    const paths = ["b/child", "first.txt", "a/child", "a", "b", "first.txt"];
    await useFileOperationsStore().run(operation, paths);
    expect(mocks.fsMutate).toHaveBeenCalledExactlyOnceWith({
      folderPath: "C:/project",
      operation,
      items: ["first.txt", "a", "b"].map((path) => ({
        path,
        destination: operation === "delete" ? null : `destination/${path}`,
      })),
    });
    if (operation === "delete")
      expect(mocks.confirm.mock.calls[0]![0].message).toContain("first.txt\na\nb");
    expect(paths).toEqual(["b/child", "first.txt", "a/child", "a", "b", "first.txt"]);
  },
);

it.runIf(process.env.GITX_QA_PATH_SELECTION_COST === "1")(
  "measures path normalization and real-store prompt preparation at scale",
  async () => {
    const samples = [];
    mocks.prompt.mockResolvedValue(null);
    for (const count of [1000, 5000, 20000]) {
      const flat = Array.from({ length: count }, (_, index) => `src/file-${index}.txt`);
      const nested = Array.from(
        { length: count },
        (_, index) => `dir-${index % 20}/file-${index}.txt`,
      );
      const parents = Array.from({ length: 20 }, (_, index) => `dir-${index}`);
      for (let round = 0; round < 3; round++) {
        const startFlat = performance.now();
        const result = topLevelPaths(flat);
        const flatMs = performance.now() - startFlat;
        expect(result).toEqual(flat);
        const startNested = performance.now();
        const reduced = topLevelPaths([...nested, ...parents]);
        const nestedMs = performance.now() - startNested;
        expect(reduced).toEqual(parents);
        const startPrompt = performance.now();
        const pending = useFileOperationsStore().run("copy", flat);
        const promptMs = performance.now() - startPrompt;
        expect(mocks.prompt).toHaveBeenCalled();
        await pending;
        expect(mocks.fsMutate).not.toHaveBeenCalled();
        samples.push({ count, round, flatMs, nestedMs, promptMs });
      }
    }
    console.log("QA107_PATH_SELECTION_COST", JSON.stringify(samples));
  },
  120000,
);

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
it("confirms recycle operations and asks before discarding unsaved drafts", async () => {
  mocks.confirm.mockResolvedValueOnce(false);
  await useFileOperationsStore().run("delete", ["a"]);
  expect(mocks.fsMutate).not.toHaveBeenCalled();
  mocks.tabs = [{ dirty: true }];
  mocks.confirm
    .mockResolvedValueOnce(true) // recycle confirm
    .mockResolvedValueOnce(false); // discard drafts declined
  await useFileOperationsStore().run("delete", ["a"]);
  expect(mocks.fsMutate).not.toHaveBeenCalled();
  mocks.tabs = [{ dirty: true }];
  mocks.confirm.mockResolvedValue(true);
  await useFileOperationsStore().run("delete", ["a"]);
  // This mocked result has no completed deletions; no draft may be discarded.
  expect(mocks.tabs[0].dirty).toBe(true);
  expect(mocks.fsMutate).toHaveBeenCalledWith({
    folderPath: "C:/project",
    operation: "delete",
    items: [{ path: "a", destination: null }],
  });
  mocks.fsMutate.mockClear();
  mocks.tabs = [];
  mocks.confirm.mockResolvedValueOnce(true);
  await useFileOperationsStore().run("delete", ["a"]);
  expect(mocks.fsMutate).toHaveBeenCalledWith({
    folderPath: "C:/project",
    operation: "delete",
    items: [{ path: "a", destination: null }],
  });
});
