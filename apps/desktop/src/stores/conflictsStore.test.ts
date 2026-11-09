import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useConflictsStore } from "./conflictsStore";
import type { ConflictEntry, Merge3Result } from "@/lib/backend";
import { renderMergeResult } from "@/features/merge/mergeResult";

const mocks = vi.hoisted(() => ({
  ws: {} as { repoPath: string },
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
  mocks.ws = reactive({ repoPath: "A" });
  mocks.backend.conflictMerge3.mockImplementation(async () => structuredClone(merge));
  mocks.backend.conflictsList.mockResolvedValue({ entries: [] });
});

it("accepts individual identical conflicts without discarding hand edits, blank lines or EOF", async () => {
  const store = useConflictsStore();
  await store.openMerge(entry);
  const tab = store.mergeTabs[0]!;
  tab.resultText = tab.resultText.replace("prefix", "hand-edited");
  store.acceptBlock(tab.id, 2, "theirs");
  expect(tab.resultText).toContain("<<<<<<< Yours (2)");
  expect(tab.resultText).not.toContain("<<<<<<< Yours (3)");
  store.acceptBlock(tab.id, 1, "ours");
  expect(tab.resultText).toBe("hand-edited\n\nours\ntheirs\ntail");
  await store.applyMergeResult(tab.id);
  expect(mocks.backend.conflictSaveResult).toHaveBeenCalledWith({
    path: "A",
    filePath: "conflict.txt",
    content: "hand-edited\n\nours\ntheirs\ntail",
  });
  expect(mocks.rewrite.refreshOpState).toHaveBeenCalledOnce();
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

it("blocks unresolved markers and deduplicates saving after manual resolution", async () => {
  const store = useConflictsStore();
  await store.openMerge(entry);
  const tab = store.mergeTabs[0]!;
  expect(await store.applyMergeResult(tab.id)).toBe(false);
  expect(mocks.backend.conflictSaveResult).not.toHaveBeenCalled();
  tab.resultText = "manual result";
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
  tab.resultText = "keep this draft";
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
  tab.resultText = "old result";
  const pending = deferred<null>();
  mocks.backend.conflictSaveResult.mockReturnValueOnce(pending.promise);
  const saved = store.applyMergeResult(tab.id);
  mocks.ws.repoPath = "B";
  mocks.ws.repoPath = "A";
  await store.openMerge(entry);
  store.mergeTabs[0]!.resultText = "new draft";
  pending.resolve(null);
  await saved;
  expect(store.mergeTabs[0]?.resultText).toBe("new draft");
  expect(mocks.backend.conflictsList).not.toHaveBeenCalled();
});

it("renders complete non-conflicting tokens without changing CRLF, blanks or an empty result", () => {
  expect(
    renderMergeResult({
      blocks: [{ ...conflict, kind: "onlyOurs", resultLines: ["one\r\n", "\r\n", "last"] }],
      conflictCount: 0,
    }),
  ).toBe("one\r\n\r\nlast");
  expect(
    renderMergeResult({
      blocks: [{ ...conflict, kind: "onlyTheirs", resultLines: [] }],
      conflictCount: 0,
    }),
  ).toBe("");
});
