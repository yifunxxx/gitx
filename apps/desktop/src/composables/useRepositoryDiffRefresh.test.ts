import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, reactive } from "vue";
import { useDiffStore } from "@/stores/diffStore";
import { useRepositoryRefresh } from "./useRepositoryRefresh";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  backend: {
    diffFile: vi.fn(),
    diffFileAt: vi.fn(),
    workspaceWatch: vi.fn(),
    workspaceUnwatch: vi.fn(),
  },
  listen: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/lib/utils", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({ activeEditorKind: "diff" }) }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: async () => {} }) }));
vi.mock("@/stores/branchesStore", () => ({
  useBranchesStore: () => ({ refresh: async () => {} }),
}));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => ({ load: async () => {} }) }));
vi.mock("@/stores/rewriteStore", () => ({
  useRewriteStore: () => ({ refreshOpState: async () => {} }),
}));
vi.mock("@/stores/conflictsStore", () => ({
  useConflictsStore: () => ({ refresh: async () => {} }),
}));
vi.mock("@/stores/worktreesStore", () => ({
  useWorktreesStore: () => ({ refresh: async () => {} }),
}));
vi.mock("@/stores/stashShelfStore", () => ({
  useStashShelfStore: () => ({ refresh: async () => {} }),
}));
vi.mock("@/stores/jobsStore", () => ({ useJobsStore: () => ({ count: 0 }) }));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => ({}) }));
vi.mock("@/stores/consoleStore", () => ({ useConsoleStore: () => ({ append: vi.fn() }) }));
const Host = defineComponent({
  setup() {
    useRepositoryRefresh();
    return () => null;
  },
});
enableAutoUnmount(afterEach);
const sha = "a".repeat(40);
let revision = "old";
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  setActivePinia(createPinia());
  mocks.workspace = reactive({
    repoPath: "fixture",
    repoId: "fixture",
    isRepo: true,
    roots: [{ id: "fixture" }],
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  });
  mocks.listen.mockResolvedValue(() => {});
  mocks.backend.workspaceWatch.mockResolvedValue(null);
  mocks.backend.workspaceUnwatch.mockResolvedValue(null);
  revision = "old";
  const result = async ({ filePath }: { filePath: string }) => ({
    path: filePath,
    leftLabel: "left",
    rightLabel: "right",
    leftText: "before",
    rightText: revision,
    binary: false,
    tooLarge: false,
    encoding: "utf-8",
    hunks: [],
  });
  mocks.backend.diffFile.mockImplementation(result);
  mocks.backend.diffFileAt.mockImplementation(result);
});
afterEach(() => {
  vi.useRealTimers();
});

it.each(["worktree", "index", "refs", "opState", "ignore", "focus"])(
  "refreshes visible and reactivated mutable comparisons on %s while keeping fixed revisions",
  async (event) => {
    const store = useDiffStore();
    await store.openRevDiff("local.txt", sha, "WORKTREE", "original.txt");
    await store.openRevDiff("staged.txt", "INDEX", sha);
    await store.openRevDiff("branch.txt", "main", sha);
    await store.openRevDiff("fixed.txt", sha, "b".repeat(40));
    await store.openRevDiff("root.txt", "EMPTY", sha);
    const host = mount(Host);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    store.activeId = store.tabs[0]!.id;
    await flushPromises();
    mocks.backend.diffFileAt.mockClear();
    revision = "new";
    if (event === "focus") window.dispatchEvent(new Event("focus"));
    else mocks.listen.mock.lastCall![1]({ payload: { repoId: "fixture", kinds: [event] } });
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.backend.diffFileAt.mock.calls.map(([request]) => request.filePath)).toEqual(["local.txt"]);
    expect(store.tabs.slice(1).map((tab) => tab.result?.rightText)).toEqual(["old", "old", "old", "old"]);
    // Hidden sources catch up on activation, including INDEX and symbolic refs.
    for (const tab of store.tabs.slice(1)) {
      store.activeId = tab.id;
      await flushPromises();
    }
    host.unmount();
    expect(mocks.backend.diffFileAt.mock.calls.map(([request]) => request.filePath)).toEqual([
      "local.txt",
      "staged.txt",
      "branch.txt",
    ]);
    expect(store.tabs.slice(0, 3).map((tab) => tab.result?.rightText)).toEqual([
      "new",
      "new",
      "new",
    ]);
    expect(store.tabs.slice(3).map((tab) => tab.result?.rightText)).toEqual(["old", "old"]);
    expect(mocks.backend.diffFileAt.mock.calls[0]?.[0]).toMatchObject({
      leftRev: sha,
      rightRev: "WORKTREE",
      leftPath: "original.txt",
    });
  },
);

it("does not refresh mutable comparisons for metadata-only changes", async () => {
  const store = useDiffStore();
  await store.openRevDiff("local.txt", sha, "WORKTREE");
  const host = mount(Host);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  mocks.backend.diffFileAt.mockClear();
  mocks.listen.mock.lastCall![1]({ payload: { repoId: "fixture", kinds: ["metadata"] } });
  await vi.advanceTimersByTimeAsync(200);
  host.unmount();
  expect(mocks.backend.diffFileAt).not.toHaveBeenCalled();
});
