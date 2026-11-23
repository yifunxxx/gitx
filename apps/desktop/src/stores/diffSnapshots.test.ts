import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { computed, effectScope, nextTick, reactive, watchEffect } from "vue";
import { useDiffStore } from "./diffStore";
import { buildCollapsedSides } from "@/features/diff/collapsedDiff";
import type { DiffFileResult } from "@/lib/backend";

const mocks = vi.hoisted(() => ({
  backend: { diffFile: vi.fn() },
  workspace: {} as any,
  layout: {} as any,
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => mocks.layout }));

let pinia: ReturnType<typeof createPinia>;
const scopes: ReturnType<typeof effectScope>[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.workspace = reactive({ repoPath: "fixture", repoId: "fixture", navigationToken: () => 1 });
  mocks.layout = reactive({ activeEditorKind: "diff" });
});
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  disposePinia(pinia);
});

function result(lineCount: number, revision = 0): DiffFileResult {
  return {
    path: "large.txt", leftLabel: "Staged", rightLabel: "Local",
    leftText: null, rightText: null, binary: false, tooLarge: false,
    encoding: "utf-8", eolMismatch: false,
    hunks: [{ index: 0, header: "@@ -1 +1 @@", oldStart: 1, oldLines: 1,
      newStart: 1, newLines: lineCount,
      lines: ["-base", ...Array.from({ length: lineCount }, (_,i) => `+line ${i} revision ${revision}`)] }],
  };
}

it.each([100, 10_000])("bounds display dependency tracking for %i lines while publishing new results", async (lines) => {
  const store = useDiffStore();
  mocks.backend.diffFile.mockResolvedValue(result(lines));
  await store.openFileDiff("large.txt");
  const scope = effectScope();
  scopes.push(scope);
  let tracks = 0;
  let paints = 0;
  let displayed = "";
  scope.run(() => {
    const active = computed(() => store.tabs.find(tab => tab.id === store.activeId));
    const hunks = computed(() => active.value?.result?.hunks ?? []);
    const display = computed(() => buildCollapsedSides(hunks.value), {
      onTrack: () => { tracks++; },
    });
    watchEffect(() => { displayed = display.value.right.text; paints++; });
  });
  expect(displayed).toContain(`line ${lines - 1} revision 0`);
  // The read-only payload is a snapshot, so tracking must stay independent
  // of its line count. Do not use noisy wall-clock timing as a test gate.
  expect(tracks).toBeLessThan(10);
  const initial = store.tabs[0]!.result;
  mocks.backend.diffFile.mockResolvedValue(result(lines));
  await store.reloadTab(store.activeId!);
  await nextTick();
  expect(store.tabs[0]!.result).toBe(initial);
  expect(paints).toBe(1);
  mocks.backend.diffFile.mockResolvedValue(result(lines, 1));
  await store.reloadTab(store.activeId!);
  await nextTick();
  expect(displayed).toContain(`line ${lines - 1} revision 1`);
  expect(paints).toBe(2);
  expect(tracks).toBeLessThan(20);
});

it("publishes loading, errors and display controls without mutating older tab snapshots", async () => {
  const store = useDiffStore();
  mocks.backend.diffFile.mockResolvedValue(result(2));
  await store.openFileDiff("large.txt");
  const id = store.activeId!;
  const first = store.tabs[0]!;
  const scope = effectScope();
  scopes.push(scope);
  let display: unknown;
  scope.run(() => watchEffect(() => {
    const tab = store.tabs.find(tab => tab.id === id);
    display = tab && [tab.loading, tab.error, tab.unified, tab.collapseUnchanged,
      tab.ignoreWhitespace, tab.textsLoaded, tab.result?.rightText];
  }, { flush: "sync" }));
  store.setUnified(id, true);
  expect(first.unified).toBe(false);
  mocks.backend.diffFile.mockResolvedValue({ ...result(2), leftText: "base", rightText: "full text" });
  await store.setCollapseUnchanged(id, false);
  expect(mocks.backend.diffFile).toHaveBeenLastCalledWith(expect.objectContaining({ includeTexts: true }));
  expect(display).toEqual([false, null, true, false, "none", true, "full text"]);
  mocks.backend.diffFile.mockRejectedValueOnce(new Error("locked"));
  await store.setIgnoreWhitespace(id, "all");
  expect(display).toEqual([false, "locked", true, false, "all", true, "full text"]);
  let finish!: (value: DiffFileResult) => void;
  mocks.backend.diffFile.mockReturnValueOnce(new Promise<DiffFileResult>(resolve => { finish = resolve; }));
  const loading = store.reloadTab(id);
  expect(display).toEqual([true, null, true, false, "all", true, "full text"]);
  finish({ ...result(2, 1), leftText: "base", rightText: "updated full text" });
  await loading;
  expect(display).toEqual([false, null, true, false, "all", true, "updated full text"]);
  expect(first.result?.rightText).toBeNull();
});
