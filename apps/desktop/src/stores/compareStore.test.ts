import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useCompareStore } from "./compareStore";
const m = vi.hoisted(() => ({
  ws: {} as any,
  diffRefs: vi.fn(),
  diffCombined: vi.fn(),
  logQuery: vi.fn(),
  openRevDiff: vi.fn(),
  layout: { activeEditorKind: "compare" },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => m.ws }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => m.layout }));
vi.mock("./diffStore", () => ({ useDiffStore: () => ({ openRevDiff: m.openRevDiff }) }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const result = (left = "parent", right = "sha", file = "file") => ({
  left,
  right,
  files: [{ path: file, origPath: null, status: "M" }],
});
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  m.ws = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    generation: 0,
    navigationToken() {
      return this.generation;
    },
  });
  m.diffRefs.mockImplementation(async ({ left, right }) => result(left, right));
});
afterEach(() => disposePinia(pinia));

it("returns the exact reactive tab and shows loaded contents on first open", async () => {
  const store = useCompareStore();
  const tab = await store.compareVersions("parent", "sha");
  expect(tab).toBe(store.tabs[0]);
  expect(tab?.files[0]?.path).toBe("file");
  expect(tab?.loading).toBe(false);
});

it.each(["navigation", "identity", "reopen", "dispose"])(
  "invalidates requests and stale tab commands on %s",
  async (change) => {
    const store = useCompareStore();
    const response = deferred<any>();
    m.diffRefs.mockReturnValueOnce(response.promise);
    const pending = store.compareVersions("parent", "sha");
    const old = store.tabs[0]!;
    if (change === "navigation") {
      m.ws.repoPath = "B";
      m.ws.repoPath = "A";
    } else if (change === "identity") m.ws.repoId = "other-A";
    else if (change === "reopen") ++m.ws.generation;
    else store.$dispose();
    response.resolve(result());
    expect(await pending).toBeUndefined();
    expect(old.files).toEqual([]);
    await store.showCombined(old);
    await store.openFile(old, "old-file");
    expect(m.diffCombined).not.toHaveBeenCalled();
    expect(m.openRevDiff).not.toHaveBeenCalled();
  },
);

it("does not mutate a replacement tab when an old local comparison finishes", async () => {
  const store = useCompareStore();
  const response = deferred<any>();
  m.diffRefs.mockReturnValueOnce(response.promise);
  const pending = store.compareWithLocal("sha");
  const old = store.tabs[0]!;
  store.closeTab(old.id);
  await store.compareVersions("sha", "WORKTREE");
  response.resolve(result("wrong", "old"));
  await pending;
  expect(store.tabs[0]?.mode).toBe("commits");
  expect(store.tabs[0]?.left).toBe("sha");
});

it("keeps the latest reload and ignores older errors and loading state", async () => {
  const store = useCompareStore();
  await store.compareVersions("a", "b");
  const tab = store.tabs[0]!;
  const old = deferred<any>();
  const recent = deferred<any>();
  m.diffRefs.mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
  const p1 = store.reload(tab);
  const p2 = store.reload(tab);
  old.reject(new Error("stale"));
  await p1;
  expect(tab.loading).toBe(true);
  expect(tab.error).toBeNull();
  recent.resolve(result("a", "b", "latest"));
  await p2;
  expect(tab.files[0]?.path).toBe("latest");
  expect(tab.loading).toBe(false);
});

it("keeps combined output aligned with comparison direction including Local", async () => {
  const store = useCompareStore();
  await store.compareWithLocal("sha");
  const tab = store.tabs[0]!;
  m.diffCombined.mockResolvedValue({ left: "WORKTREE", right: "sha", files: [] });
  await store.showCombined(tab);
  expect(m.diffCombined).toHaveBeenCalledExactlyOnceWith({
    path: "A",
    repoId: "A",
    left: "WORKTREE",
    right: "sha",
    limit: 50,
  });
  expect(tab.combined).toEqual({ left: "WORKTREE", right: "sha", files: [] });
});

it("ignores combined results after swap or close/reopen", async () => {
  const store = useCompareStore();
  await store.compareVersions("parent", "sha");
  const tab = store.tabs[0]!;
  const old = deferred<any>();
  m.diffCombined.mockReturnValueOnce(old.promise);
  const pending = store.showCombined(tab);
  await store.swap(tab.id);
  old.resolve({ files: ["wrong direction"] });
  await pending;
  expect(tab.combined).toBeNull();
  const late = deferred<any>();
  m.diffCombined.mockReturnValueOnce(late.promise);
  const p2 = store.showCombined(tab);
  store.closeTab(tab.id);
  await store.compareVersions("parent", "sha");
  late.resolve({ files: ["closed"] });
  await p2;
  expect(store.tabs[0]?.combined).toBeNull();
});

it("records current combined failures on the tab without rejecting the UI event", async () => {
  const store = useCompareStore();
  await store.compareVersions("a", "b");
  const tab = store.tabs[0]!;
  m.diffCombined.mockRejectedValue(new Error("combined failed"));
  await expect(store.showCombined(tab)).resolves.toBeUndefined();
  expect(tab.error).toBe("combined failed");
});

it("does not switch editors after a delayed file diff completes", async () => {
  const store = useCompareStore();
  await store.compareVersions("a", "b");
  const response = deferred<void>();
  m.openRevDiff.mockReturnValueOnce(response.promise);
  const pending = store.openFile(store.tabs[0]!, "file", "old-file");
  m.layout.activeEditorKind = "history";
  response.resolve();
  await pending;
  expect(m.layout.activeEditorKind).toBe("history");
  expect(m.openRevDiff).toHaveBeenCalledWith("file", "a", "b", "old-file");
});

it("drops old branch comparison pages after reopening the same repository", async () => {
  const store = useCompareStore();
  const page = deferred<any>();
  m.logQuery.mockReturnValue(page.promise);
  const pending = store.compareRefs("main", "topic");
  const old = store.tabs[0]!;
  ++m.ws.generation;
  page.resolve({ commits: [{ sha: "stale" }] });
  await pending;
  expect(old.leftOnly).toEqual([]);
  expect(old.rightOnly).toEqual([]);
  expect(store.tabs).toEqual([]);
});
