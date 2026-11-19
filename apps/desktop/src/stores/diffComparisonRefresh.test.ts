import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import type { DiffFileResult } from "@/lib/backend";
import { useDiffStore } from "./diffStore";

const mocks = vi.hoisted(() => ({
  backend: { diffFile: vi.fn(), diffFileAt: vi.fn() },
  workspace: {} as any,
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => ({ activeEditorKind: "diff" }) }));

const sha = "a".repeat(40);
const otherSha = "b".repeat(64);
const result = (text: string): DiffFileResult => ({
  path: "new.txt",
  leftLabel: "before",
  rightLabel: "after",
  leftText: "before",
  rightText: text,
  binary: false,
  tooLarge: false,
  encoding: "utf-8",
  hunks: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.workspace = reactive({
    repoPath: "fixture",
    repoId: "fixture",
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  });
  mocks.backend.diffFileAt.mockResolvedValue(result("old"));
});

it.each([
  [sha, "WORKTREE"],
  ["worktree", sha],
  [sha, "INDEX"],
  ["index", sha],
  [sha, ":0"],
  [sha, "HEAD"],
  ["main", sha],
  [sha, "HEAD~1"],
  ["MERGE_HEAD", sha],
  [sha, "empty"],
  ["a".repeat(7), sha],
  [sha, "b".repeat(39)],
])("reloads cached mutable comparison %s → %s with its rename path", async (left, right) => {
  const store = useDiffStore();
  await store.openRevDiff("new.txt", left, right, "original.txt");
  const id = store.activeId;
  mocks.backend.diffFileAt.mockResolvedValue(result("new"));
  await store.openRevDiff("new.txt", left, right, "original.txt");
  expect(store.activeId).toBe(id);
  expect(store.tabs).toHaveLength(1);
  expect(mocks.backend.diffFileAt).toHaveBeenCalledTimes(2);
  expect(mocks.backend.diffFileAt).toHaveBeenLastCalledWith(
    expect.objectContaining({
      filePath: "new.txt",
      leftRev: left,
      rightRev: right,
      leftPath: "original.txt",
    }),
  );
  expect(store.tabs[0]?.result?.rightText).toBe("new");
});

it.each([
  [sha, otherSha],
  ["EMPTY", sha],
  [otherSha.toUpperCase(), "EMPTY"],
])("retains the cache for fixed comparison %s → %s", async (left, right) => {
  const store = useDiffStore();
  await store.openRevDiff("new.txt", left, right, "original.txt");
  const initial = store.tabs[0]?.result;
  mocks.backend.diffFileAt.mockResolvedValue(result("different"));
  await store.openRevDiff("new.txt", left, right, "original.txt");
  expect(mocks.backend.diffFileAt).toHaveBeenCalledOnce();
  expect(store.tabs[0]?.result).toBe(initial);
});

it("keeps cached paint while a mutable comparison reopens, then exposes failure and retries", async () => {
  const store = useDiffStore();
  await store.openRevDiff("new.txt", sha, "WORKTREE");
  const initial = store.tabs[0]?.result;
  const request = deferred<DiffFileResult>();
  mocks.backend.diffFileAt.mockReturnValueOnce(request.promise);
  const pending = store.openRevDiff("new.txt", sha, "WORKTREE");
  expect(store.tabs[0]?.loading).toBe(true);
  expect(store.tabs[0]?.result).toBe(initial);
  request.reject(new Error("temporary read failure"));
  await pending;
  expect(store.tabs[0]?.loading).toBe(false);
  expect(store.tabs[0]?.result).toBe(initial);
  expect(store.tabs[0]?.error).toContain("temporary read failure");
  mocks.backend.diffFileAt.mockResolvedValue(result("latest"));
  await store.openRevDiff("new.txt", sha, "WORKTREE");
  expect(store.tabs[0]?.error).toBeNull();
  expect(store.tabs[0]?.result?.rightText).toBe("latest");
});

it("rejects a background comparison result after close and same-id reopen", async () => {
  const store = useDiffStore();
  await store.openRevDiff("new.txt", sha, "WORKTREE", "original.txt");
  const id = store.activeId!;
  const previous = deferred<DiffFileResult>();
  mocks.backend.diffFileAt.mockReturnValueOnce(previous.promise);
  const pending = store.reloadTab(id, { soft: true });
  store.closeTab(id);
  mocks.backend.diffFileAt.mockResolvedValue(result("latest"));
  await store.openRevDiff("new.txt", sha, "WORKTREE", "original.txt");
  previous.resolve(result("stale"));
  await pending;
  expect(store.tabs[0]?.result?.rightText).toBe("latest");
});

it.each([
  ["", sha],
  [sha, ""],
])("sends explicit empty local revision %s → %s to diffFileAt", async (left, right) => {
  const store = useDiffStore();
  await store.openRevDiff("new.txt", left, right);
  expect(mocks.backend.diffFile).not.toHaveBeenCalled();
  expect(mocks.backend.diffFileAt).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      leftRev: left,
      rightRev: right,
      leftPath: null,
    }),
  );
  expect(store.tabs[0]?.result?.rightText).toBe("old");
});

it("discards cached comparisons and pending responses after same-path navigation", async () => {
  const store = useDiffStore();
  await store.openRevDiff("new.txt", sha, "WORKTREE");
  const oldId = store.activeId!;
  const request = deferred<DiffFileResult>();
  mocks.backend.diffFileAt.mockReturnValueOnce(request.promise);
  const pending = store.reloadTab(oldId, { soft: true });
  mocks.workspace.generation++;
  const cacheAfterNavigation = [...store.tabs];
  request.resolve(result("stale"));
  await pending;
  expect(cacheAfterNavigation).toEqual([]);
  expect(store.tabs).toEqual([]);
  expect(store.activeId).toBeNull();
  expect(store.lastPerf).toBeNull();
  mocks.backend.diffFileAt.mockResolvedValue(result("current"));
  await store.openRevDiff("new.txt", sha, "WORKTREE");
  expect(store.tabs[0]?.result?.rightText).toBe("current");
});

it("does not reuse another repository identity at the same path", async () => {
  const store = useDiffStore();
  await store.openRevDiff("new.txt", sha, "b".repeat(40));
  mocks.workspace.repoId = "replacement";
  expect(store.tabs).toEqual([]);
});
