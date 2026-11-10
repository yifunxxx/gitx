import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useConflictsStore } from "./conflictsStore";
import type { ConflictEntry, Merge3Result } from "@/lib/backend";
import {
  syncMergeText,
  confirmManualRange,
  mergeRanges,
  pendingMergeCount,
} from "@/features/merge/mergeDocument";

const mocks = vi.hoisted(() => ({
  ws: {} as { repoPath: string; repoId: string; isRepo: boolean; navigationToken: () => number },
  backend: { conflictMerge3: vi.fn(), conflictSaveResult: vi.fn(), conflictsList: vi.fn() },
  changes: { refresh: vi.fn() },
  rewrite: { refreshOpState: vi.fn() },
  layout: { activeEditorKind: "welcome" },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("./changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("./rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
const entry: ConflictEntry = {
  path: "conflict.txt",
  kind: "content",
  yours: "modified",
  theirs: "modified",
};
const conflict = {
  kind: "conflict" as const,
  baseLines: ["base\n"],
  oursLines: ["ours\n"],
  theirsLines: ["theirs\n"],
  resultLines: [],
  isSimple: false,
};
const merge: Merge3Result = {
  blocks: [
    {
      kind: "equal",
      baseLines: ["prefix\n\n"],
      oursLines: ["prefix\n\n"],
      theirsLines: ["prefix\n\n"],
      resultLines: ["prefix\n\n"],
      isSimple: true,
    },
    conflict,
    { ...conflict },
    {
      kind: "equal",
      baseLines: ["tail"],
      oursLines: ["tail"],
      theirsLines: ["tail"],
      resultLines: ["tail"],
      isSimple: true,
    },
  ],
  conflictCount: 2,
};
function keepManual(store: ReturnType<typeof useConflictsStore>, id: string, text: string) {
  const tab = store.mergeTabs.find((t) => t.id === id)!;
  let state = syncMergeText(tab.mergeState, text);
  for (const range of state.field(mergeRanges)) {
    const spec = confirmManualRange(state, range.index);
    if (spec) state = state.update(spec).state;
  }
  store.updateMergeState(id, state);
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.ws = reactive({ repoPath: "A", repoId: "A", isRepo: true, navigationToken: () => 0 });
  mocks.backend.conflictMerge3.mockImplementation(async () => structuredClone(merge));
  mocks.backend.conflictsList.mockResolvedValue({ entries: [] });
});

it("accepts individual identical conflicts without discarding hand edits, blank lines or EOF", async () => {
  const store = useConflictsStore();
  await store.openMerge(entry);
  const tab = store.mergeTabs[0]!;
  tab.resultText = tab.resultText.replace("prefix", "hand-edited");
  store.acceptBlock(tab.id, 2, "theirs");
  expect(tab.resultText).toContain("base\ntheirs\n");
  expect(pendingMergeCount(tab.mergeState)).toBe(1);
  store.acceptBlock(tab.id, 1, "ours");
  expect(tab.resultText).toBe("hand-edited\n\nours\ntheirs\ntail");
  await store.applyMergeResult(tab.id);
  expect(mocks.backend.conflictSaveResult).toHaveBeenCalledWith({
    path: "A",
    filePath: "conflict.txt",
    content: "hand-edited\n\nours\ntheirs\ntail",
  });
  expect(store.mergeTabs).toEqual([]);
});

it("does not overwrite a manually resolved block when its old accept button is clicked", async () => {
  const store = useConflictsStore();
  await store.openMerge(entry);
  const tab = store.mergeTabs[0]!;
  tab.resultText = "entirely manual\n\n";
  store.acceptBlock(tab.id, 1, "ours");
  expect(tab.resultText).toBe("entirely manual\n\n");
  expect(tab.error).toBe("merge.manuallyEdited");
});

it("blocks pending decisions and deduplicates saving after explicit manual resolution", async () => {
  const store = useConflictsStore();
  await store.openMerge(entry);
  const tab = store.mergeTabs[0]!;
  expect(await store.applyMergeResult(tab.id)).toBe(false);
  expect(mocks.backend.conflictSaveResult).not.toHaveBeenCalled();
  keepManual(store, tab.id, "manual result");
  const pending = deferred<null>();
  mocks.backend.conflictSaveResult.mockReturnValueOnce(pending.promise);
  const saved = store.applyMergeResult(tab.id);
  expect(tab.saving).toBe(true);
  expect(await store.applyMergeResult(tab.id)).toBe(false);
  pending.resolve(null);
  expect(await saved).toBe(true);
  expect(mocks.backend.conflictSaveResult).toHaveBeenCalledOnce();
});

it("keeps the edited result available when saving fails", async () => {
  const store = useConflictsStore();
  await store.openMerge(entry);
  const tab = store.mergeTabs[0]!;
  keepManual(store, tab.id, "keep this draft");
  mocks.backend.conflictSaveResult.mockRejectedValueOnce(new Error("disk failure"));
  expect(await store.applyMergeResult(tab.id)).toBe(false);
  expect(store.mergeTabs[0]?.resultText).toBe("keep this draft");
  expect(tab.error).toContain("disk failure");
  expect(tab.saving).toBe(false);
});

it("ignores a completed save from an earlier A → B → A repository session", async () => {
  const store = useConflictsStore();
  await store.openMerge(entry);
  const tab = store.mergeTabs[0]!;
  keepManual(store, tab.id, "old result");
  const pending = deferred<null>();
  mocks.backend.conflictSaveResult.mockReturnValueOnce(pending.promise);
  const saved = store.applyMergeResult(tab.id);
  mocks.ws.repoPath = "B";
  mocks.ws.repoPath = "A";
  expect(store.busy).toBe(true);
  expect(await store.openMerge(entry)).toBe(false);
  mocks.backend.conflictsList.mockResolvedValueOnce({ entries: [entry] });
  await store.refresh();
  const currentList = store.list;
  store.selected = [entry.path];
  pending.resolve(null);
  expect(await saved).toBe(false);
  expect(store.list).toBe(currentList);
  expect(store.selected).toEqual([entry.path]);
  expect(store.busy).toBe(false);
  expect(mocks.backend.conflictsList).toHaveBeenCalledOnce();
  await store.openMerge(entry);
  expect(store.mergeTabs).toHaveLength(1);
  expect(store.mergeTabs[0]?.saving).toBe(false);
});

it("deduplicates opening and rejects stale merge results after A to B to A navigation", async () => {
  const store = useConflictsStore();
  const old = deferred<Merge3Result>();
  mocks.backend.conflictMerge3.mockReturnValueOnce(old.promise);
  const pending = store.openMerge(entry);
  await store.openMerge(entry);
  expect(mocks.backend.conflictMerge3).toHaveBeenCalledTimes(1);
  mocks.ws.repoPath = "B";
  mocks.ws.repoPath = "A";
  await store.openMerge(entry);
  const current = store.activeMergeId;
  old.resolve(structuredClone(merge));
  await pending;
  expect(store.mergeTabs).toHaveLength(1);
  expect(store.activeMergeId).toBe(current);
});
