import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useConflictsStore } from "./conflictsStore";

const mocks = vi.hoisted(() => ({ workspace: {} as any, layout: {} as any, merge: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ conflictMerge3: mocks.merge }) }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({}) }));

beforeEach(() => {
  setActivePinia(createPinia());
  mocks.workspace = reactive({
    repoPath: "fixture",
    repoId: "fixture",
    isRepo: true,
    navigationToken: () => 0,
  });
  mocks.layout = reactive({ activeEditorKind: "welcome" });
  mocks.merge.mockResolvedValue({ blocks: [], conflictCount: 0 });
});

it("tracks edited merge results and recognizes undo to the initial content", async () => {
  const store = useConflictsStore();
  await store.openMerge({ path: "a.txt" } as any);
  const tab = store.mergeTabs[0]!;
  const initial = tab.resultText;
  expect(store.hasUnsavedMergeResult(tab.id)).toBe(false);
  tab.resultText = "manually edited result";
  expect(store.hasUnsavedMergeResult(tab.id)).toBe(true);
  tab.resultText = initial;
  expect(store.hasUnsavedMergeResult(tab.id)).toBe(false);
});

it("keeps per-tab baselines and clears them on close or repository navigation", async () => {
  const store = useConflictsStore();
  await store.openMerge({ path: "a.txt" } as any);
  const first = store.mergeTabs[0]!;
  first.resultText = "edited";
  await store.openMerge({ path: "b.txt" } as any);
  expect(store.hasUnsavedMergeResult(first.id)).toBe(true);
  expect(store.hasUnsavedMergeResult(store.activeMergeId!)).toBe(false);
  store.closeMergeTab(first.id);
  expect(store.hasUnsavedMergeResult(first.id)).toBe(false);
  mocks.workspace.repoPath = "other";
  expect(store.mergeTabs).toHaveLength(0);
  await store.openMerge({ path: "a.txt" } as any);
  expect(store.hasUnsavedMergeResult(store.activeMergeId!)).toBe(false);
});
