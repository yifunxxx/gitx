import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useBranchesStore } from "./branchesStore";
import type { RefEntry } from "@/lib/backend";

const mocks = vi.hoisted(() => ({
  ws: {} as any,
  backend: {
    refsList: vi.fn(),
    remoteList: vi.fn(),
    multiRootCheckout: vi.fn(),
    multiRootRollback: vi.fn(),
    branchCheckout: vi.fn(),
  },
  toast: vi.fn(),
  changes: { refresh: vi.fn() },
  log: { load: vi.fn() },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock("./changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("./logStore", () => ({ useLogStore: () => mocks.log }));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: async () => false }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
const entry = { name: "shared", fullName: "refs/heads/shared", kind: "localBranch" } as RefEntry;
const failed = () => ({
  ok: false,
  rolledBack: false,
  steps: [
    {
      path: "A",
      ok: true,
      error: null,
      rollbackError: "index locked",
      previousHead: { oid: "old" },
      checkoutHead: { oid: "new" },
    },
    { path: "B", ok: false, error: "dirty files", rollbackError: null },
  ],
});
const deferred = () => {
  let resolve!: (result?: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.ws = reactive({
    repoPath: "A",
    repoId: "A",
    gitDir: "A/.git",
    isRepo: true,
    multiRoot: true,
    roots: [{ worktreeRoot: "A" }, { worktreeRoot: "B" }],
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  });
  mocks.backend.refsList.mockResolvedValue({ local: [], remote: [], tags: [], current: "main" });
  mocks.backend.remoteList.mockResolvedValue([]);
});

it("reports all checkout and rollback errors and never returns success for a partial failure", async () => {
  mocks.backend.multiRootCheckout.mockResolvedValue(failed());
  const store = useBranchesStore();
  expect(await store.checkout(entry)).toBe(false);
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "branches.multiRootFailed",
      description: expect.stringContaining("A: branches.rollbackFailed — index locked"),
      persistent: true,
    }),
  );
  expect(mocks.toast.mock.calls[0]![0].description).toContain("B: dirty files");
  expect(mocks.changes.refresh).toHaveBeenCalledOnce();
  expect(mocks.log.load).toHaveBeenCalledOnce();
  expect(store.checkingOut).toBe(false);
});

it("checks an explicit recovery result and allows a later retry after another failure", async () => {
  mocks.backend.multiRootCheckout.mockResolvedValue(failed());
  mocks.backend.multiRootRollback
    .mockResolvedValueOnce(failed())
    .mockResolvedValueOnce({ ok: true, rolledBack: true, steps: [] });
  await useBranchesStore().checkout(entry);
  mocks.toast.mock.calls[0]![0].action.onClick();
  await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(useBranchesStore().checkingOut).toBe(false));
  expect(mocks.toast.mock.calls[1]![0].title).toBe("branches.multiRootFailed");
  mocks.toast.mock.calls[1]![0].action.onClick();
  await vi.waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith({ title: "branches.rootsRestored" }),
  );
});

it("does not offer recovery when automatic rollback already succeeded", async () => {
  mocks.backend.multiRootCheckout.mockResolvedValue({ ...failed(), rolledBack: true });
  expect(await useBranchesStore().checkout(entry)).toBe(false);
  const toast = mocks.toast.mock.calls[0]![0];
  expect(toast.description).toContain("branches.rootsRestored");
  expect(toast.action).toBeUndefined();
});

it("keeps recovery available when the backend rejects before returning its result", async () => {
  const original = failed();
  mocks.backend.multiRootCheckout.mockResolvedValue(original);
  mocks.backend.multiRootRollback
    .mockRejectedValueOnce(new Error("repository discovery temporarily failed"))
    .mockResolvedValueOnce({ ok: true, rolledBack: true, steps: [] });
  await useBranchesStore().checkout(entry);
  mocks.toast.mock.calls[0]![0].action.onClick();
  await vi.waitFor(() => expect(useBranchesStore().checkingOut).toBe(false));
  const retry = mocks.toast.mock.lastCall![0];
  expect(retry.description).toContain("repository discovery temporarily failed");
  expect(retry.action).toBeDefined();
  retry.action.onClick();
  await vi.waitFor(() => expect(mocks.backend.multiRootRollback).toHaveBeenCalledTimes(2));
  expect(mocks.backend.multiRootRollback.mock.lastCall![0]).toEqual({ steps: original.steps });
  await vi.waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith({ title: "branches.rootsRestored" }),
  );
});

it("rejects duplicate checkout and ignores an old result after A → B → A", async () => {
  const pending = deferred();
  mocks.backend.multiRootCheckout.mockReturnValue(pending.promise);
  const store = useBranchesStore();
  const first = store.checkout(entry);
  expect(await store.checkout(entry)).toBe(false);
  expect(mocks.backend.multiRootCheckout).toHaveBeenCalledOnce();
  mocks.ws.repoPath = "B";
  mocks.ws.generation++;
  mocks.ws.repoPath = "A";
  mocks.ws.generation++;
  pending.resolve(failed());
  expect(await first).toBe(false);
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(mocks.changes.refresh).not.toHaveBeenCalled();
  expect(store.checkingOut).toBe(false);
});

it("invalidates a recovery action after navigation and guards repeated recovery clicks", async () => {
  mocks.backend.multiRootCheckout.mockResolvedValue(failed());
  await useBranchesStore().checkout(entry);
  const action = mocks.toast.mock.calls[0]![0].action;
  const recovery = deferred();
  mocks.backend.multiRootRollback.mockReturnValue(recovery.promise);
  action.onClick();
  expect(action.onClick()).toBe(false);
  expect(mocks.backend.multiRootRollback).toHaveBeenCalledOnce();
  mocks.ws.generation++;
  expect(action.disabled()).toBe(true);
  recovery.resolve(failed());
  await vi.waitFor(() => expect(useBranchesStore().checkingOut).toBe(false));
  expect(mocks.toast).toHaveBeenCalledOnce();
  expect(action.onClick()).toBe(false);
});

it("does not return a current success if navigation happens during refresh", async () => {
  mocks.backend.multiRootCheckout.mockResolvedValue({ ok: true, rolledBack: false, steps: [] });
  const refresh = deferred();
  mocks.changes.refresh.mockReturnValue(refresh.promise);
  const result = useBranchesStore().checkout(entry);
  await vi.waitFor(() => expect(mocks.changes.refresh).toHaveBeenCalledOnce());
  mocks.ws.generation++;
  refresh.resolve();
  expect(await result).toBe(false);
  expect(mocks.log.load).not.toHaveBeenCalled();
});

it("reports a rejected single-root checkout and releases the busy guard", async () => {
  mocks.ws.multiRoot = false;
  mocks.backend.branchCheckout.mockRejectedValueOnce(new Error("local edits would be overwritten"));
  const store = useBranchesStore();
  expect(await store.checkout(entry)).toBe(false);
  expect(store.checkingOut).toBe(false);
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: "branches.checkoutFailed",
    description: "local edits would be overwritten",
    persistent: true,
  }));
  mocks.backend.branchCheckout.mockResolvedValueOnce(undefined);
  expect(await store.checkout(entry)).toBe(true);
  expect(mocks.backend.branchCheckout).toHaveBeenCalledTimes(2);
});

it.each([true, false])("warns about skipped roots and requires one checkout for success (all skipped: %s)", async (allSkipped) => {
  mocks.backend.multiRootCheckout.mockResolvedValue({
    ok: true,
    rolledBack: false,
    steps: [
      { path: "A", ok: true, skipped: true, error: "shared is absent" },
      { path: "B", ok: true, skipped: allSkipped, error: null },
    ],
  });
  expect(await useBranchesStore().checkout(entry)).toBe(!allSkipped);
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: "branches.multiRootSkipped",
    description: expect.stringContaining("A: shared is absent"),
    persistent: true,
  }));
});

it("ignores stale reference data when navigation changes during refresh", async () => {
  mocks.backend.multiRootCheckout.mockResolvedValue({ ok: true, rolledBack: false, steps: [] });
  const oldRefs = deferred();
  mocks.backend.refsList.mockReturnValueOnce(oldRefs.promise);
  const store = useBranchesStore();
  const result = store.checkout(entry);
  await vi.waitFor(() => expect(mocks.backend.refsList).toHaveBeenCalledOnce());
  mocks.ws.generation++;
  oldRefs.resolve({ local: [entry], remote: [], tags: [], current: "stale" });
  expect(await result).toBe(false);
  expect(store.refs).toBeNull();
  expect(store.loading).toBe(false);
  expect(mocks.changes.refresh).not.toHaveBeenCalled();
});

it("reports a refresh failure separately after a successful checkout", async () => {
  mocks.backend.multiRootCheckout.mockResolvedValue({ ok: true, rolledBack: false, steps: [] });
  mocks.backend.refsList.mockRejectedValue(new Error("cannot read references"));
  const store = useBranchesStore();
  expect(await store.checkout(entry)).toBe(true);
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: "branches.refreshFailed",
    description: "cannot read references",
    persistent: true,
  }));
  expect(store.checkingOut).toBe(false);
});
