import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { getBackend } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";
import type { DiffFileResult, DiffSide, IgnoreWhitespace } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useLayoutStore } from "./layoutStore";
import { sameDiffResult } from "@/features/diff/sameDiffResult";
import { diffViewKey, type DiffPaneSide, type DiffPaneSnapshot, type DiffPaneViewState } from "@/features/diff/diffViewState";

export type DiffTab = {
  id: string;
  path: string;
  left: DiffSide;
  right: DiffSide;
  leftRev?: string;
  rightRev?: string;
  leftPath?: string;
  title: string;
  result: DiffFileResult | null;
  loading: boolean;
  /** Distinguishes omitted full texts from an intentionally absent file side. */
  textsLoaded?: boolean;
  error?: string | null;
  unified: boolean;
  ignoreWhitespace: IgnoreWhitespace;
  collapseUnchanged: boolean;
  kind: "file" | "combined" | "compare";
  /** Changes only when this tab receives different content. */
  contentVersion?: number;
};

export const useDiffStore = defineStore("diff", () => {
  const tabs = ref<DiffTab[]>([]);
  const activeId = ref<string | null>(null);
  let nextContentVersion = 0;
  const paneStates = new Map<string, {
    key: string;
    panes: Partial<Record<DiffPaneSide, DiffPaneViewState>>;
  }>();
  /** Per-tab load generation — stale responses are dropped. */
  const loadGen = new Map<string, number>();
  let nextGeneration = 0;
  const workspace = useWorkspaceStore();
  watch(
    () => workspace.repoPath,
    () => {
      loadGen.clear();
      paneStates.clear();
      tabs.value = [];
      activeId.value = null;
      lastPerf.value = null;
    },
    { flush: "sync" },
  );
  /** Optional perf marks for __gitxDiffPerf. */
  const lastPerf = ref<{
    id: string;
    invokeMs: number;
    includeTexts: boolean;
    hunkCount: number;
  } | null>(null);

  function bumpGen(id: string): number {
    const g = ++nextGeneration;
    loadGen.set(id, g);
    return g;
  }

  function isCurrent(id: string, gen: number) {
    return loadGen.get(id) === gen;
  }

  /** Always read the reactive proxy from `tabs` — never keep a raw insert object. */
  function liveTab(id: string): DiffTab | undefined {
    return tabs.value.find((t) => t.id === id);
  }

  function savePaneViewState(id: string, snapshot: DiffPaneSnapshot) {
    const tab = liveTab(id);
    // An outgoing pane may finish unmounting after a close, refresh or navigation.
    if (!tab || diffViewKey(tab) !== snapshot.key) return;
    let saved = paneStates.get(id);
    if (!saved || saved.key !== snapshot.key) {
      saved = { key: snapshot.key, panes: {} };
      paneStates.set(id, saved);
    }
    saved.panes[snapshot.side] = snapshot.state;
  }

  function getPaneViewState(id: string, side: DiffPaneSide) {
    const tab = liveTab(id);
    const saved = paneStates.get(id);
    return tab && saved?.key === diffViewKey(tab) ? saved.panes[side] : undefined;
  }

  /**
   * Patch through the array proxy (or replace the slot). Mutating a *raw*
   * object that was pushed into `tabs` bypasses Vue setters and leaves Diff
   * stuck until an unrelated parent re-render (tool-window tab flip).
   */
  function patchTab(id: string, patch: Partial<DiffTab>) {
    const i = tabs.value.findIndex((t) => t.id === id);
    if (i < 0) return;
    // Immutable slot replace — never mutate a raw insert object (bypasses Vue).
    const next: DiffTab = { ...tabs.value[i]!, ...patch };
    tabs.value = [...tabs.value.slice(0, i), next, ...tabs.value.slice(i + 1)];
  }

  function ensureTab(init: DiffTab): DiffTab {
    const existing = liveTab(init.id);
    if (existing) return existing;
    tabs.value = [...tabs.value, init];
    return liveTab(init.id)!;
  }

  async function openFileDiff(
    filePath: string,
    left: DiffSide = "index",
    right: DiffSide = "worktree",
    opts?: { force?: boolean; leftPath?: string },
  ) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;

    const leftPath = opts?.leftPath && opts.leftPath !== filePath ? opts.leftPath : undefined;
    const id = leftPath
      ? `file:${JSON.stringify([left, right, filePath, leftPath])}`
      : `${left}:${right}:${filePath}`;
    const tab = ensureTab({
      id,
      path: filePath,
      left,
      right,
      leftPath,
      title: filePath.split(/[\\/]/).pop() ?? filePath,
      result: null,
      loading: true,
      unified: false,
      ignoreWhitespace: "none",
      collapseUnchanged: true,
      kind: "file",
    });
    activeId.value = id;
    useLayoutStore().activeEditorKind = "diff";

    // Instant reactivation from cache. Soft refresh only when forced (e.g. after stage).
    if (tab.result) {
      if (opts?.force) await reloadTab(id, { soft: true });
      return;
    }
    await reloadTab(id);
  }

  async function openRevDiff(
    filePath: string,
    leftRev: string,
    rightRev: string,
    leftPath?: string,
  ) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    const originalPath = leftPath && leftPath !== filePath ? leftPath : undefined;
    const id = `rev:${JSON.stringify([leftRev, rightRev, filePath, originalPath ?? null])}`;
    const tab = ensureTab({
      id,
      path: filePath,
      left: "head",
      right: "worktree",
      leftRev,
      rightRev,
      leftPath: originalPath,
      title: `${filePath.split(/[\\/]/).pop() ?? filePath} (${leftRev.slice(0, 7)}…${rightRev.slice(0, 7)})`,
      result: null,
      loading: true,
      unified: false,
      ignoreWhitespace: "none",
      collapseUnchanged: true,
      kind: "compare",
    });
    activeId.value = id;
    useLayoutStore().activeEditorKind = "diff";
    if (tab.result) return;
    await reloadTab(id);
  }

  async function reloadTab(
    tabOrId: DiffTab | string,
    opts?: { soft?: boolean; leftPath?: string | null; includeTexts?: boolean },
  ) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    const id = typeof tabOrId === "string" ? tabOrId : tabOrId.id;
    const tab = liveTab(id);
    if (!tab) return;

    const gen = bumpGen(id);
    // Keep existing paint during refresh, but always expose the pending state.
    patchTab(id, { loading: true, error: null });
    // Collapsed default: skip full texts on the wire until Expand asks for them.
    const includeTexts =
      opts?.includeTexts ??
      (!tab.collapseUnchanged ||
        tab.textsLoaded ||
        tab.result?.leftText != null ||
        tab.result?.rightText != null);
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const backend = getBackend();
      let result: DiffFileResult;
      // Re-read live fields after possible concurrent patches.
      const live = liveTab(id)!;
      if ((live.leftRev && live.rightRev) || live.leftPath) {
        result = await backend.diffFileAt({
          repoId: workspace.repoId,
          path: workspace.repoPath,
          filePath: live.path,
          leftRev: live.leftRev ?? live.left.toUpperCase(),
          rightRev: live.rightRev ?? live.right.toUpperCase(),
          leftPath: opts?.leftPath ?? live.leftPath ?? null,
          ignoreWhitespace: live.ignoreWhitespace,
          includeTexts,
        });
      } else {
        result = await backend.diffFile({
          repoId: workspace.repoId,
          path: workspace.repoPath,
          filePath: live.path,
          left: live.left,
          right: live.right,
          ignoreWhitespace: live.ignoreWhitespace,
          includeTexts,
        });
      }
      if (!isCurrent(id, gen)) return;
      const prev = liveTab(id)?.result;
      if (prev && sameDiffResult(prev, result)) {
        patchTab(id, { textsLoaded: includeTexts });
        // Unchanged content — keep paint, skip assign thrash.
        return;
      }
      paneStates.delete(id);
      patchTab(id, { result, contentVersion: ++nextContentVersion, textsLoaded: includeTexts });
      const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      lastPerf.value = {
        id,
        invokeMs: Math.round(t1 - t0),
        includeTexts,
        hunkCount: result.hunks.length,
      };
      if (typeof window !== "undefined") {
        (window as Window & { __gitxDiffPerf?: typeof lastPerf.value }).__gitxDiffPerf =
          lastPerf.value;
      }
    } catch (error) {
      if (isCurrent(id, gen)) patchTab(id, { error: formatErrorMessage(error) });
    } finally {
      if (isCurrent(id, gen)) patchTab(id, { loading: false });
    }
  }

  function closeTab(id: string) {
    bumpGen(id);
    paneStates.delete(id);
    tabs.value = tabs.value.filter((t) => t.id !== id);
    loadGen.delete(id);
    if (activeId.value === id) {
      activeId.value = tabs.value[tabs.value.length - 1]?.id ?? null;
    }
  }

  function setUnified(id: string, unified: boolean) {
    if (liveTab(id)?.unified !== unified) paneStates.delete(id);
    patchTab(id, { unified });
  }

  async function setIgnoreWhitespace(id: string, mode: IgnoreWhitespace) {
    const tab = liveTab(id);
    if (!tab) return;
    patchTab(id, { ignoreWhitespace: mode });
    await reloadTab(id, {
      includeTexts: !tab.collapseUnchanged || !!tab.textsLoaded,
    });
  }

  async function setCollapseUnchanged(id: string, value: boolean) {
    const tab = liveTab(id);
    if (!tab) return;
    if (tab.collapseUnchanged !== value) paneStates.delete(id);
    patchTab(id, { collapseUnchanged: value });
    // Expanding needs full texts; fetch lazily if missing.
    const live = liveTab(id);
    if (
      !value &&
      live?.result &&
      !live.textsLoaded &&
      !live.result.binary &&
      !live.result.tooLarge
    ) {
      await reloadTab(id, { soft: true, includeTexts: true });
    }
  }

  async function stageHunks(filePath: string, hunkIndexes: number[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    const backend = getBackend();
    await backend.stageHunks({
      repoId: workspace.repoId,
      path: workspace.repoPath,
      filePath,
      hunkIndexes,
    });
  }

  async function unstageHunks(filePath: string, hunkIndexes: number[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    const backend = getBackend();
    await backend.unstageHunks({
      repoId: workspace.repoId,
      path: workspace.repoPath,
      filePath,
      hunkIndexes,
    });
  }

  return {
    tabs,
    activeId,
    lastPerf,
    savePaneViewState,
    getPaneViewState,
    openFileDiff,
    openRevDiff,
    closeTab,
    setUnified,
    setIgnoreWhitespace,
    setCollapseUnchanged,
    stageHunks,
    unstageHunks,
    reloadTab,
  };
});
