import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useDiffStore } from "./diffStore";
import { useRepositoryRefresh } from "@/composables/useRepositoryRefresh";
import type { DiffFileResult } from "@/lib/backend";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  layout: {} as any,
  backend: { diffFile: vi.fn(), diffFileAt: vi.fn(), workspaceWatch: vi.fn(), workspaceUnwatch: vi.fn() },
  listen: vi.fn(),
  refresh: vi.fn(),
  revision: 0,
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/lib/utils", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("./changesStore", () => ({ useChangesStore: () => ({ refresh: mocks.refresh }) }));
vi.mock("./branchesStore", () => ({ useBranchesStore: () => ({ refresh: mocks.refresh }) }));
vi.mock("./logStore", () => ({ useLogStore: () => ({ load: mocks.refresh }) }));
vi.mock("./rewriteStore", () => ({ useRewriteStore: () => ({ refreshOpState: mocks.refresh }) }));
vi.mock("./conflictsStore", () => ({ useConflictsStore: () => ({ refresh: mocks.refresh }) }));
vi.mock("./worktreesStore", () => ({ useWorktreesStore: () => ({ refresh: mocks.refresh }) }));
vi.mock("./stashShelfStore", () => ({ useStashShelfStore: () => ({ refresh: mocks.refresh }) }));
vi.mock("./jobsStore", () => ({ useJobsStore: () => ({ count: 0 }) }));
vi.mock("./syncStore", () => ({ useSyncStore: () => ({}) }));
vi.mock("./consoleStore", () => ({ useConsoleStore: () => ({ append: vi.fn() }) }));

const Host = defineComponent({ setup() { useRepositoryRefresh(); return () => null; } });
function result(path: string, revision = mocks.revision): DiffFileResult {
  return {
    path, leftLabel: "Staged", rightLabel: "Local", leftText: null, rightText: null,
    binary: false, tooLarge: false, encoding: "utf-8", eolMismatch: false,
    hunks: [{ index: 0, header: "@@ -1 +1 @@", oldStart: 1, oldLines: 1,
      newStart: 1, newLines: 1, lines: ["-base", `+revision ${revision}`] }],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const hosts: ReturnType<typeof mount>[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  setActivePinia(createPinia());
  mocks.revision = 0;
  mocks.workspace = reactive({ repoId: "repo", repoPath: "repo", isRepo: true,
    roots: [{ id: "repo" }], generation: 0, navigationToken() { return this.generation; } });
  mocks.layout = reactive({ activeEditorKind: "diff", bottomOpen: true, bottomMaximized: false });
  mocks.backend.diffFile.mockImplementation(async ({ filePath }) => result(filePath));
  mocks.backend.diffFileAt.mockImplementation(async ({ filePath }) => result(filePath));
  mocks.backend.workspaceWatch.mockResolvedValue(null);
  mocks.backend.workspaceUnwatch.mockResolvedValue(null);
  mocks.listen.mockResolvedValue(() => {});
});
afterEach(() => {
  for (const host of hosts.splice(0)) host.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup() {
  const store = useDiffStore();
  await store.openFileDiff("A.txt");
  await store.openFileDiff("B.txt");
  await store.openFileDiff("C.txt");
  const host = mount(Host);
  hosts.push(host);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  mocks.backend.diffFile.mockClear();
  mocks.backend.diffFileAt.mockClear();
  return { store, host };
}
async function changed(kinds = ["worktree"]) {
  mocks.revision++;
  mocks.listen.mock.lastCall![1]({ payload: { repoId: "repo", kinds } });
  await vi.advanceTimersByTimeAsync(200);
  await flushPromises();
}
const tab = (store: ReturnType<typeof useDiffStore>, name = "A.txt") => store.tabs.find(t => t.path === name)!;

it("refreshes only the visible diff and coalesces hidden changes until activation", async () => {
  const { store } = await setup();
  const hidden = tab(store).result;
  for (let i = 0; i < 3; i++) await changed();
  expect(mocks.backend.diffFile.mock.calls.map(([req]) => req.filePath)).toEqual(["C.txt", "C.txt", "C.txt"]);
  expect(tab(store).result).toBe(hidden);
  store.activeId = tab(store).id;
  expect(tab(store).loading).toBe(true);
  await flushPromises();
  expect(mocks.backend.diffFile.mock.calls.map(([req]) => req.filePath)).toEqual(["C.txt", "C.txt", "C.txt", "A.txt"]);
  expect(tab(store).result?.hunks[0]?.lines).toContain("+revision 3");
  store.activeId = tab(store, "C.txt").id;
  store.activeId = tab(store).id;
  await flushPromises();
  expect(mocks.backend.diffFile).toHaveBeenCalledTimes(4);
});

it.each(["file", "merge", "welcome", "maximized"])(
  "defers all diffs while the editor is hidden by %s and refreshes when restored",
  async (kind) => {
    const { store } = await setup();
    if (kind === "maximized") mocks.layout.bottomMaximized = true;
    else mocks.layout.activeEditorKind = kind;
    await changed();
    expect(mocks.backend.diffFile).not.toHaveBeenCalled();
    mocks.layout.activeEditorKind = "diff";
    mocks.layout.bottomMaximized = false;
    expect(tab(store, "C.txt").loading).toBe(true);
    await flushPromises();
    expect(mocks.backend.diffFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ filePath: "C.txt" }));
    expect(tab(store, "C.txt").result?.hunks[0]?.lines).toContain("+revision 1");
  },
);

it("keeps hidden navigation dirty if an older in-flight read completes later", async () => {
  const { store } = await setup();
  const old = deferred<DiffFileResult>();
  mocks.backend.diffFile.mockReturnValueOnce(old.promise);
  const refreshing = store.reloadTab(tab(store).id);
  await changed();
  old.resolve(result("A.txt", -1));
  await refreshing;
  mocks.backend.diffFile.mockClear();
  store.activeId = tab(store).id;
  await flushPromises();
  expect(mocks.backend.diffFile).toHaveBeenCalledOnce();
  expect(tab(store).result?.hunks[0]?.lines).toContain("+revision 1");
});

it.each([false, true])("reopens a dirty file once through the normal entry point (force=%s)", async (force) => {
  const { store } = await setup();
  await changed();
  mocks.backend.diffFile.mockClear();
  await store.openFileDiff("A.txt", "index", "worktree", { force });
  await flushPromises();
  expect(mocks.backend.diffFile).toHaveBeenCalledOnce();
  expect(tab(store).result?.hunks[0]?.lines).toContain("+revision 1");
});

it("refreshes hidden mutable comparisons with rename paths but retains fixed SHA snapshots", async () => {
  const { store } = await setup();
  const sha = "a".repeat(40);
  await store.openRevDiff("renamed.txt", sha, "WORKTREE", "original.txt");
  const liveId = store.activeId!;
  await store.openRevDiff("fixed.txt", sha, "b".repeat(40));
  const fixed = tab(store, "fixed.txt").result;
  mocks.backend.diffFileAt.mockClear();
  await changed(["refs", "index"]);
  expect(mocks.backend.diffFileAt).not.toHaveBeenCalled();
  store.activeId = liveId;
  await flushPromises();
  expect(mocks.backend.diffFileAt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    filePath: "renamed.txt", leftRev: sha, rightRev: "WORKTREE", leftPath: "original.txt",
  }));
  expect(tab(store, "renamed.txt").result?.hunks[0]?.lines).toContain("+revision 1");
  store.activeId = tab(store, "fixed.txt").id;
  await flushPromises();
  expect(tab(store, "fixed.txt").result).toBe(fixed);
  expect(mocks.backend.diffFileAt).toHaveBeenCalledOnce();
});

it("surfaces an activation failure once and keeps explicit retry available", async () => {
  const { store } = await setup();
  await changed();
  mocks.backend.diffFile.mockClear();
  mocks.backend.diffFile.mockRejectedValueOnce(new Error("read locked"));
  store.activeId = tab(store).id;
  await flushPromises();
  expect(tab(store).error).toContain("read locked");
  expect(tab(store).loading).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.backend.diffFile).toHaveBeenCalledOnce();
  await store.reloadTab(tab(store).id);
  expect(tab(store).error).toBeNull();
  expect(tab(store).result?.hunks[0]?.lines).toContain("+revision 1");
});

it("does not invalidate fresh caches for metadata alone but does so on focus", async () => {
  const { store } = await setup();
  for (const name of ["A.txt", "B.txt", "C.txt"]) {
    store.activeId = tab(store, name).id;
    await flushPromises();
  }
  mocks.backend.diffFile.mockClear();
  await changed(["metadata"]);
  store.activeId = tab(store).id;
  await flushPromises();
  expect(mocks.backend.diffFile).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(200);
  expect(mocks.backend.diffFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ filePath: "A.txt" }));
  store.activeId = tab(store, "B.txt").id;
  await flushPromises();
  expect(mocks.backend.diffFile).toHaveBeenCalledTimes(2);
});

it("drops stale markers on close and same-path repository navigation", async () => {
  const { store } = await setup();
  await changed();
  store.closeTab(tab(store).id);
  mocks.backend.diffFile.mockClear();
  await store.openFileDiff("A.txt");
  expect(mocks.backend.diffFile).toHaveBeenCalledOnce();
  mocks.workspace.generation++;
  expect(store.tabs).toEqual([]);
  mocks.backend.diffFile.mockClear();
  await store.openFileDiff("A.txt");
  await flushPromises();
  expect(mocks.backend.diffFile).toHaveBeenCalledOnce();
  expect(store.tabs).toHaveLength(1);
});

it("does not duplicate an activation read when switching away and back while it runs", async () => {
  const { store } = await setup();
  await changed();
  const pending = deferred<DiffFileResult>();
  mocks.backend.diffFile.mockClear();
  mocks.backend.diffFile.mockReturnValueOnce(pending.promise);
  store.activeId = tab(store).id;
  store.activeId = tab(store, "C.txt").id;
  store.activeId = tab(store).id;
  await flushPromises();
  expect(mocks.backend.diffFile).toHaveBeenCalledOnce();
  pending.resolve(result("A.txt"));
  await flushPromises();
  expect(tab(store).loading).toBe(false);
});

it("reveals the dirty current diff when the maximized bottom panel is hidden", async () => {
  const { store } = await setup();
  mocks.layout.bottomMaximized = true;
  await changed();
  expect(mocks.backend.diffFile).not.toHaveBeenCalled();
  mocks.layout.bottomOpen = false;
  await flushPromises();
  expect(mocks.backend.diffFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ filePath: "C.txt" }));
  expect(tab(store, "C.txt").result?.hunks[0]?.lines).toContain("+revision 1");
});

it("does not duplicate a mutable comparison read when reopened from its source", async () => {
  const { store } = await setup();
  const sha = "a".repeat(40);
  await store.openRevDiff("renamed.txt", sha, "WORKTREE", "original.txt");
  store.activeId = tab(store, "C.txt").id;
  await changed();
  mocks.backend.diffFileAt.mockClear();
  await store.openRevDiff("renamed.txt", sha, "WORKTREE", "original.txt");
  await flushPromises();
  expect(mocks.backend.diffFileAt).toHaveBeenCalledOnce();
  expect(tab(store, "renamed.txt").result?.hunks[0]?.lines).toContain("+revision 1");
});
