import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useRewriteStore } from "./rewriteStore";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  backend: {
    mergeRun: vi.fn(),
    rebaseRun: vi.fn(),
    cherryPickRun: vi.fn(),
    rebaseInteractiveStart: vi.fn(),
    rebaseInteractivePlan: vi.fn(),
    rewordCommit: vi.fn(),
    repoOpStateGet: vi.fn(),
    undoRewrite: vi.fn(),
  },
  changes: { refresh: vi.fn() },
  log: { load: vi.fn() },
  branches: { refresh: vi.fn() },
  conflicts: { refresh: vi.fn() },
  dialog: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("./logStore", () => ({ useLogStore: () => mocks.log }));
vi.mock("./branchesStore", () => ({ useBranchesStore: () => mocks.branches }));
vi.mock("./conflictsStore", () => ({ useConflictsStore: () => mocks.conflicts }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/composables/useDialog", () => ({
  openDialog: mocks.dialog,
  useDialogStack: () => ({ value: [] }),
}));
vi.mock("@/features/merge/DirtyWorktreeDialog.vue", () => ({ default: {} }));
vi.mock("@/features/merge/ConflictsDialog.vue", () => ({ default: {} }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const success = {
  outcome: "success",
  conflictFiles: [],
  backupRef: "backup",
  message: "done",
  undoHead: { oid: "head", symbolicRef: "refs/heads/main" },
};
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.workspace = reactive({
    repoPath: "A",
    repoId: "root-A",
    isRepo: true,
    navigation: 1,
    navigationToken() {
      return this.navigation;
    },
  });
  mocks.backend.repoOpStateGet.mockResolvedValue({ kind: "normal" });
  mocks.backend.rewordCommit.mockResolvedValue(success);
});
afterEach(() => disposePinia(pinia));

const invalidations = [
  ["navigation begins", () => ++mocks.workspace.navigation],
  [
    "A to B to A",
    () => {
      mocks.workspace.repoPath = "B";
      mocks.workspace.repoPath = "A";
    },
  ],
  [
    "same-path identity changes",
    () => {
      mocks.workspace.repoId = "other-root";
    },
  ],
  ["store is disposed", () => useRewriteStore().$dispose()],
] as const;
it.each(invalidations)("does not smart-retry after %s", async (_label, invalidate) => {
  const answer = deferred<string>();
  mocks.dialog.mockReturnValue(answer.promise);
  mocks.backend.mergeRun.mockRejectedValueOnce({ code: "dirtyWorktreeWouldBeOverwritten" });
  const pending = useRewriteStore().merge({ branches: ["original"] });
  await flushPromises();
  expect(mocks.dialog).toHaveBeenCalledOnce();
  invalidate();
  answer.resolve("smart");
  await pending;
  expect(mocks.backend.mergeRun).toHaveBeenCalledOnce();
  expect(mocks.toast).not.toHaveBeenCalled();
});

it.each(invalidations)(
  "does not publish a late conflict result after %s",
  async (_label, invalidate) => {
    const result = deferred<any>();
    mocks.backend.rewordCommit.mockReturnValueOnce(result.promise);
    const store = useRewriteStore();
    const pending = store.reword("sha", "message");
    invalidate();
    result.resolve({ ...success, outcome: "conflicts" });
    await pending;
    expect(store.lastBackupRef).toBeNull();
    expect(store.busy).toBe(false);
    expect(mocks.backend.repoOpStateGet).not.toHaveBeenCalled();
    expect(mocks.conflicts.refresh).not.toHaveBeenCalled();
    expect(mocks.dialog).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  },
);

it("keeps the write lock through refresh and ignores duplicate writes", async () => {
  const refresh = deferred<void>();
  mocks.changes.refresh.mockReturnValueOnce(refresh.promise);
  const store = useRewriteStore();
  const pending = store.reword("sha", "message");
  await flushPromises();
  expect(store.busy).toBe(true);
  expect(await store.reword("sha", "duplicate")).toBeNull();
  expect(mocks.backend.rewordCommit).toHaveBeenCalledOnce();
  refresh.resolve();
  await pending;
  expect(store.busy).toBe(false);
});

it("does not report a successful write as failed when refresh fails", async () => {
  mocks.changes.refresh.mockRejectedValueOnce(new Error("refresh unavailable"));
  await expect(useRewriteStore().reword("sha", "message")).resolves.toEqual(success);
  expect(mocks.backend.rewordCommit).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "rewrite.refreshFailed",
      description: "refresh unavailable",
      persistent: true,
    }),
  );
});

it("stops the refresh chain if navigation starts during a refresh", async () => {
  const refresh = deferred<void>();
  mocks.changes.refresh.mockReturnValueOnce(refresh.promise);
  const store = useRewriteStore();
  const pending = store.reword("sha", "message");
  await flushPromises();
  ++mocks.workspace.navigation;
  refresh.resolve();
  await pending;
  expect(mocks.log.load).not.toHaveBeenCalled();
  expect(mocks.branches.refresh).not.toHaveBeenCalled();
  expect(store.lastBackupRef).toBeNull();
});

it("does not show a dirty prompt for an error from a previous repository", async () => {
  const result = deferred<any>();
  mocks.backend.mergeRun.mockReturnValueOnce(result.promise);
  const pending = useRewriteStore().merge({ branches: ["feature"] });
  const caught = pending.catch(() => null);
  ++mocks.workspace.navigation;
  result.reject({ code: "dirtyWorktreeWouldBeOverwritten" });
  await caught;
  expect(mocks.dialog).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("makes old Undo actions inert when the repository is reopened", async () => {
  const store = useRewriteStore();
  await store.reword("sha", "message");
  const action = mocks.toast.mock.calls.find(([t]) => t.action)?.[0].action;
  expect(action).toBeDefined();
  ++mocks.workspace.navigation;
  expect(store.lastBackupRef).toBeNull();
  action.onClick();
  expect(mocks.backend.undoRewrite).not.toHaveBeenCalled();
});

const retryOperations = [
  {
    method: "mergeRun",
    input: () => ({ branches: ["original"], message: "message" }),
    run: (s: any, o: any) => s.merge(o),
    mutate: (o: any) => {
      o.branches[0] = "changed";
      o.message = "changed";
    },
  },
  {
    method: "rebaseRun",
    input: () => ({ upstream: "original" }),
    run: (s: any, o: any) => s.rebase(o),
    mutate: (o: any) => {
      o.upstream = "changed";
    },
  },
  {
    method: "cherryPickRun",
    input: () => ({ shas: ["original"] }),
    run: (s: any, o: any) => s.cherryPick(o),
    mutate: (o: any) => {
      o.shas[0] = "changed";
    },
  },
  {
    method: "rebaseInteractiveStart",
    input: () => ({
      base: "base",
      onto: null,
      rebaseMerges: false,
      autosquash: false,
      items: [{ sha: "original", action: "pick", message: null }],
    }),
    run: (s: any, o: any) => s.startInteractive(o),
    mutate: (o: any) => {
      o.items[0].sha = "changed";
      o.items[0].action = "drop";
    },
  },
] as const;
it.each(retryOperations)(
  "freezes $method arguments across the dirty prompt",
  async ({ method, input, run, mutate }) => {
    const answer = deferred<string>();
    mocks.dialog.mockReturnValueOnce(answer.promise);
    const backend = mocks.backend[method];
    backend
      .mockRejectedValueOnce({ code: "dirtyWorktreeWouldBeOverwritten" })
      .mockResolvedValueOnce(success);
    const opts = input();
    const pending = run(useRewriteStore(), opts);
    await flushPromises();
    const initial = JSON.parse(JSON.stringify(backend.mock.calls[0][0]));
    mutate(opts);
    answer.resolve("smart");
    await pending;
    expect(backend).toHaveBeenCalledTimes(2);
    expect(backend.mock.calls[1][0]).toEqual({ ...initial, smart: true });
  },
);

it("does not open duplicate conflict dialogs", async () => {
  mocks.backend.rewordCommit.mockResolvedValueOnce({ ...success, outcome: "conflicts" });
  mocks.backend.repoOpStateGet.mockResolvedValueOnce({ kind: "rebase", conflictCount: 1 });
  await useRewriteStore().reword("sha", "message");
  expect(mocks.dialog).toHaveBeenCalledOnce();
});
