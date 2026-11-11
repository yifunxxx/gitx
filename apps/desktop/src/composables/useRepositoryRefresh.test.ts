import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, nextTick, reactive } from "vue";
import { useRepositoryRefresh } from "./useRepositoryRefresh";
enableAutoUnmount(afterEach);

const mocks = vi.hoisted(() => ({
  ws: {} as { repoPath: string; repoId: string; isRepo: boolean; roots: unknown[] },
  jobs: { count: 0 },
  sync: { updating: false, pulling: false, pushing: false },
  changes: { refresh: vi.fn() },
  branches: { refresh: vi.fn() },
  log: {
    load: vi.fn(),
    loading: false,
    locating: false,
    loadingMore: false,
    loadingPrevious: false,
  },
  diffs: { tabs: [], reloadTab: vi.fn() },
  rewrite: { busy: false, refreshOpState: vi.fn() },
  conflicts: { refresh: vi.fn() },
  worktrees: { refresh: vi.fn() },
  stash: { refresh: vi.fn() },
  backend: { workspaceWatch: vi.fn(), workspaceUnwatch: vi.fn() },
  listen: vi.fn(),
  unlisten: vi.fn(),
  append: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/lib/utils", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => mocks.branches }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => mocks.log }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => mocks.diffs }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("@/stores/conflictsStore", () => ({ useConflictsStore: () => mocks.conflicts }));
vi.mock("@/stores/worktreesStore", () => ({ useWorktreesStore: () => mocks.worktrees }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => mocks.stash }));
vi.mock("@/stores/jobsStore", () => ({ useJobsStore: () => mocks.jobs }));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => mocks.sync }));
vi.mock("@/stores/consoleStore", () => ({ useConsoleStore: () => ({ append: mocks.append }) }));
const Host = defineComponent({
  setup() {
    useRepositoryRefresh();
    return () => null;
  },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((r, fail) => {
    resolve = r;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const emit = (repoId: string, kinds = ["worktree"]) =>
  mocks.listen.mock.calls.at(-1)![1]({ payload: { repoId, kinds } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.ws = reactive({ repoPath: "A", repoId: "A", isRepo: true, roots: [{ id: "A" }] });
  mocks.jobs.count = 0;
  mocks.sync.updating = mocks.sync.pulling = mocks.sync.pushing = false;
  mocks.log.loading =
    mocks.log.locating =
    mocks.log.loadingMore =
    mocks.log.loadingPrevious =
      false;
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.backend.workspaceWatch.mockResolvedValue(null);
  mocks.backend.workspaceUnwatch.mockResolvedValue(null);
  mocks.changes.refresh.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("coalesces bursts, ignores other repositories and never overlaps refresh passes", async () => {
  const host = mount(Host);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  mocks.changes.refresh.mockClear();
  emit("other");
  await vi.advanceTimersByTimeAsync(250);
  expect(mocks.changes.refresh).not.toHaveBeenCalled();
  const pending = deferred<void>();
  mocks.changes.refresh.mockReturnValueOnce(pending.promise);
  for (let i = 0; i < 30; i++) emit("A");
  await vi.advanceTimersByTimeAsync(200);
  expect(mocks.changes.refresh).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 30; i++) emit("A");
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.changes.refresh).toHaveBeenCalledTimes(1);
  pending.resolve();
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  expect(mocks.changes.refresh).toHaveBeenCalledTimes(2);
  host.unmount();
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(10000);
  expect(mocks.changes.refresh).toHaveBeenCalledTimes(2);
  expect(mocks.unlisten).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("releases its native watch on unmount without clearing a later mount", async () => {
  const host = mount(Host);
  await flushPromises();
  const first = mocks.backend.workspaceWatch.mock.lastCall?.[1];
  host.unmount();
  const other = mount(Host);
  await flushPromises();
  const second = mocks.backend.workspaceWatch.mock.lastCall?.[1];
  expect(mocks.backend.workspaceUnwatch).toHaveBeenCalledWith(first);
  expect(second).toBeGreaterThan(first);
  other.unmount();
  expect(mocks.backend.workspaceUnwatch).toHaveBeenLastCalledWith(second);
});

it("retains refresh work while the window is hidden", async () => {
  const host = mount(Host);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  mocks.changes.refresh.mockClear();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  emit("A");
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.changes.refresh).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(200);
  expect(mocks.changes.refresh).toHaveBeenCalledOnce();
  host.unmount();
});

it("retries a refs refresh after explicit Log navigation finishes", async () => {
  const host = mount(Host);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  mocks.log.load.mockClear();
  mocks.log.locating = true;
  emit("A", ["refs"]);
  await vi.advanceTimersByTimeAsync(200);
  expect(mocks.log.load).not.toHaveBeenCalled();
  mocks.log.locating = false;
  await vi.advanceTimersByTimeAsync(300);
  expect(mocks.log.load).toHaveBeenCalledWith(true, true);
  host.unmount();
});

it("starts fallback refresh immediately when event subscription fails", async () => {
  mocks.listen.mockRejectedValueOnce(new Error("event bridge unavailable"));
  const host = mount(Host);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  expect(mocks.changes.refresh).toHaveBeenCalledOnce();
  host.unmount();
});

it("discards an old refresh error after switching repositories", async () => {
  const pending = deferred<void>();
  mocks.changes.refresh.mockReturnValueOnce(pending.promise);
  const host = mount(Host);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  mocks.ws.repoPath = mocks.ws.repoId = "B";
  mocks.ws.roots = [{ id: "B" }];
  await nextTick();
  pending.reject(new Error("old read failed"));
  await flushPromises();
  expect(mocks.append).not.toHaveBeenCalled();
  host.unmount();
});

it("does not block a new repository behind a pending old refresh", async () => {
  const pending = deferred<void>();
  mocks.changes.refresh.mockReturnValueOnce(pending.promise);
  const host = mount(Host);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  mocks.ws.repoPath = mocks.ws.repoId = "B";
  mocks.ws.roots = [{ id: "B" }];
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  expect(mocks.changes.refresh).toHaveBeenCalledTimes(2);
  pending.resolve();
  await flushPromises();
  host.unmount();
});

it("rejects old native sessions and falls back after a current runtime watch error", async () => {
  const host = mount(Host);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  const generation = mocks.backend.workspaceWatch.mock.lastCall![1];
  mocks.changes.refresh.mockClear();
  const callback = mocks.listen.mock.lastCall![1];
  callback({
    payload: { repoId: "A", kinds: ["refs"], watchGeneration: generation - 1, degraded: true },
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.changes.refresh).not.toHaveBeenCalled();
  callback({
    payload: { repoId: "A", kinds: ["refs"], watchGeneration: generation, degraded: true },
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.changes.refresh).toHaveBeenCalledTimes(2);
  host.unmount();
});

it("serializes watch changes and cleans a listener that resolves after unmount", async () => {
  const pending = deferred<null>();
  mocks.backend.workspaceWatch.mockReturnValueOnce(pending.promise);
  const host = mount(Host);
  await flushPromises();
  mocks.ws.repoPath = "B";
  mocks.ws.repoId = "B";
  mocks.ws.roots = [{ id: "B" }];
  await nextTick();
  expect(mocks.backend.workspaceWatch).toHaveBeenCalledTimes(1);
  pending.resolve(null);
  await flushPromises();
  expect(mocks.backend.workspaceWatch).toHaveBeenLastCalledWith([{ id: "B" }], expect.any(Number));
  host.unmount();
  const listener = deferred<() => void>();
  mocks.listen.mockReturnValueOnce(listener.promise);
  const other = mount(Host);
  await flushPromises();
  other.unmount();
  listener.resolve(mocks.unlisten);
  await flushPromises();
  expect(mocks.unlisten).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps fallback when a runtime error arrives before registration acknowledgement", async () => {
  const registration = deferred<null>();
  mocks.backend.workspaceWatch.mockReturnValueOnce(registration.promise);
  const host = mount(Host);
  await flushPromises();
  const generation = mocks.backend.workspaceWatch.mock.lastCall![1];
  mocks.listen.mock.lastCall![1]({
    payload: { repoId: "A", kinds: ["refs"], watchGeneration: generation, degraded: true },
  });
  registration.resolve(null);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  mocks.changes.refresh.mockClear();
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.changes.refresh).toHaveBeenCalledOnce();
  host.unmount();
});

it("defers while a write is active and uses bounded fallback polling on watch failure", async () => {
  mocks.backend.workspaceWatch.mockRejectedValueOnce(new Error("unavailable"));
  mocks.jobs.count = 1;
  const host = mount(Host);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.changes.refresh).not.toHaveBeenCalled();
  mocks.jobs.count = 0;
  await vi.advanceTimersByTimeAsync(300);
  expect(mocks.changes.refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(4000);
  expect(mocks.changes.refresh).toHaveBeenCalledTimes(2);
  host.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
