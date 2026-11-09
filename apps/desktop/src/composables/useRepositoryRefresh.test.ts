import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, nextTick, reactive } from "vue";
import { useRepositoryRefresh } from "./useRepositoryRefresh";

const mocks = vi.hoisted(() => ({
  ws: {} as { repoPath: string; repoId: string; isRepo: boolean; roots: unknown[] },
  jobs: { count: 0 },
  changes: { refresh: vi.fn() },
  branches: { refresh: vi.fn() },
  log: { load: vi.fn() },
  diffs: { tabs: [], reloadTab: vi.fn() },
  rewrite: { busy: false, refreshOpState: vi.fn() },
  conflicts: { refresh: vi.fn() },
  worktrees: { refresh: vi.fn() },
  stash: { refresh: vi.fn() },
  backend: { workspaceWatch: vi.fn() },
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
vi.mock("@/stores/consoleStore", () => ({ useConsoleStore: () => ({ append: mocks.append }) }));
const Host = defineComponent({
  setup() {
    useRepositoryRefresh();
    return () => null;
  },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const emit = (repoId: string, kinds = ["worktree"]) =>
  mocks.listen.mock.calls.at(-1)![1]({ payload: { repoId, kinds } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.ws = reactive({ repoPath: "A", repoId: "A", isRepo: true, roots: [{ id: "A" }] });
  mocks.jobs.count = 0;
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.backend.workspaceWatch.mockResolvedValue(null);
  mocks.changes.refresh.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

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
  expect(mocks.backend.workspaceWatch).toHaveBeenLastCalledWith([{ id: "B" }]);
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
