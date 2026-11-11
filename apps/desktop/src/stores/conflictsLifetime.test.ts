import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useConflictsStore } from "./conflictsStore";
import type { ConflictEntry, Merge3Result } from "@/lib/backend";

const m = vi.hoisted(() => ({
  ws: {} as any,
  backend: {
    conflictsList: vi.fn(),
    conflictMerge3: vi.fn(),
    conflictAcceptSide: vi.fn(),
    conflictResolveSimple: vi.fn(),
    conflictSaveResult: vi.fn(),
  },
  changes: { refresh: vi.fn() },
  rewrite: { refreshOpState: vi.fn() },
  layout: { activeEditorKind: "welcome" },
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => m.ws }));
vi.mock("./changesStore", () => ({ useChangesStore: () => m.changes }));
vi.mock("./rewriteStore", () => ({ useRewriteStore: () => m.rewrite }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => m.layout }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
const entry: ConflictEntry = {
  path: "one.txt",
  kind: "content",
  yours: "modified",
  theirs: "modified",
};
const merge: Merge3Result = { blocks: [], conflictCount: 0 };
const list = { entries: [entry], yoursLabel: "original ours", theirsLabel: "original theirs" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let store: ReturnType<typeof useConflictsStore>;
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  m.ws = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    navigation: 0,
    navigationToken() {
      return this.navigation;
    },
  });
  m.layout.activeEditorKind = "welcome";
  m.backend.conflictsList.mockResolvedValue(list);
  m.backend.conflictMerge3.mockResolvedValue(merge);
  m.backend.conflictResolveSimple.mockResolvedValue(1);
  store = useConflictsStore();
});
afterEach(() => store.$dispose());

it.each(["navigation", "identity", "non-repository", "dispose"])(
  "rejects a merge load after %s invalidation",
  async (change) => {
    const pending = deferred<Merge3Result>();
    m.backend.conflictMerge3.mockReturnValueOnce(pending.promise);
    const opening = store.openMerge(entry);
    if (change === "navigation") m.ws.navigation++;
    if (change === "identity") m.ws.repoId = "replacement";
    if (change === "non-repository") m.ws.isRepo = false;
    if (change === "dispose") store.$dispose();
    pending.resolve(merge);
    await opening;
    expect(store.mergeTabs).toEqual([]);
    expect(m.layout.activeEditorKind).toBe("welcome");
  },
);

it("does not open an editor after its caller closes, and permits a new caller to retry", async () => {
  let caller = true;
  const old = deferred<Merge3Result>();
  m.backend.conflictMerge3.mockReturnValueOnce(old.promise);
  const opening = store.openMerge(entry, () => caller);
  caller = false;
  expect(await store.openMerge(entry)).toBe(true);
  const id = store.activeMergeId;
  old.resolve(merge);
  expect(await opening).toBe(false);
  expect(store.mergeTabs).toHaveLength(1);
  expect(store.activeMergeId).toBe(id);
});

it("deduplicates live loads and reports success only when an editor exists", async () => {
  const pending = deferred<Merge3Result>();
  m.backend.conflictMerge3.mockReturnValueOnce(pending.promise);
  const opening = store.openMerge(entry);
  expect(await store.openMerge(entry)).toBe(false);
  expect(m.backend.conflictMerge3).toHaveBeenCalledOnce();
  pending.resolve(merge);
  expect(await opening).toBe(true);
  expect(await store.openMerge(entry)).toBe(true);
  expect(store.mergeTabs).toHaveLength(1);
});

it("preserves the labels captured before a merge load and allows retry after failure", async () => {
  await store.refresh();
  m.backend.conflictMerge3.mockRejectedValueOnce(new Error("read failed"));
  await expect(store.openMerge(entry)).rejects.toThrow("read failed");
  const pending = deferred<Merge3Result>();
  m.backend.conflictMerge3.mockReturnValueOnce(pending.promise);
  const opening = store.openMerge(entry);
  store.list = { ...list, yoursLabel: "new branch", theirsLabel: "new peer" } as any;
  pending.resolve(merge);
  await opening;
  expect(store.mergeTabs[0]?.yoursLabel).toBe("original ours");
});

it.each(["binary", "submodule"] as const)("rejects %s text editors", async (kind) => {
  await store.openMerge({ ...entry, kind });
  expect(m.backend.conflictMerge3).not.toHaveBeenCalled();
});

it("keeps a repository write locked across A → B → A and suppresses stale UI work", async () => {
  const pending = deferred<void>();
  m.backend.conflictAcceptSide.mockReturnValueOnce(pending.promise);
  const paths = [entry.path];
  const accepting = store.acceptSide("ours", paths);
  paths.push("do-not-accept.txt");
  m.ws.repoPath = "B";
  m.ws.repoPath = "A";
  await store.acceptSide("theirs", [entry.path]);
  await store.resolveSimple();
  expect(m.backend.conflictAcceptSide).toHaveBeenCalledExactlyOnceWith({
    path: "A",
    paths: [entry.path],
    side: "ours",
  });
  expect(m.backend.conflictResolveSimple).not.toHaveBeenCalled();
  expect(store.busy).toBe(true);
  pending.resolve();
  await accepting;
  expect(store.busy).toBe(false);
  expect(m.backend.conflictsList).not.toHaveBeenCalled();
  expect(m.changes.refresh).not.toHaveBeenCalled();
  expect(m.toast).not.toHaveBeenCalled();
});

it("invalidates pending editor loads when a resolution writes the file", async () => {
  const pending = deferred<Merge3Result>();
  m.backend.conflictMerge3.mockReturnValueOnce(pending.promise);
  const opening = store.openMerge(entry);
  await store.acceptSide("ours", [entry.path]);
  pending.resolve(merge);
  await opening;
  expect(store.mergeTabs).toEqual([]);
});

it("does not treat a failed refresh as a failed write or allow another write until reload", async () => {
  m.backend.conflictsList.mockRejectedValueOnce(new Error("refresh failed"));
  await expect(store.acceptSide("ours", [entry.path])).resolves.toBe(true);
  expect(store.refreshError).toContain("refresh failed");
  await store.acceptSide("ours", [entry.path]);
  expect(m.backend.conflictAcceptSide).toHaveBeenCalledOnce();
  await store.refresh();
  expect(store.refreshError).toBeNull();
});

it("never refreshes the new repository after a resolution changes session during refresh", async () => {
  const refreshedSessions: number[] = [];
  m.changes.refresh.mockImplementation(() => refreshedSessions.push(m.ws.navigation));
  m.rewrite.refreshOpState.mockImplementation(() => refreshedSessions.push(m.ws.navigation));
  const pending = deferred<any>();
  m.backend.conflictsList.mockReturnValueOnce(pending.promise);
  const accepting = store.acceptSide("ours", [entry.path]);
  await Promise.resolve();
  m.ws.navigation++;
  pending.resolve(list);
  await accepting;
  expect(refreshedSessions).not.toContain(1);
  expect(store.list).toBeNull();
});

it("clears loading on invalidation and ignores old refresh errors", async () => {
  const pending = deferred<any>();
  m.backend.conflictsList.mockReturnValueOnce(pending.promise);
  const loading = store.refresh();
  m.ws.repoId = "replacement";
  expect(store.loading).toBe(false);
  pending.reject(new Error("old read failed"));
  await expect(loading).resolves.toBe(false);
  expect(store.refreshError).toBeNull();
});
