import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { DiffFileResult, DiffSide, IgnoreWhitespace } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useLayoutStore } from "./layoutStore";

export type DiffTab = {
  id: string;
  path: string;
  left: DiffSide;
  right: DiffSide;
  leftRev?: string;
  rightRev?: string;
  title: string;
  result: DiffFileResult | null;
  loading: boolean;
  unified: boolean;
  ignoreWhitespace: IgnoreWhitespace;
  collapseUnchanged: boolean;
  kind: "file" | "combined" | "compare";
  /** Content fingerprint of last successful load (path+oids/size proxy). */
  contentKey?: string;
};

function resultContentKey(result: DiffFileResult): string {
  const hunkSig = result.hunks
    .map((h) => `${h.header}:${h.lines.length}`)
    .join("|");
  const lt = result.leftText?.length ?? -1;
  const rt = result.rightText?.length ?? -1;
  return `${result.path}:${result.binary}:${result.tooLarge}:${lt}:${rt}:${hunkSig}`;
}

export const useDiffStore = defineStore("diff", () => {
  const tabs = ref<DiffTab[]>([]);
  const activeId = ref<string | null>(null);
  /**
   * Bumped on every successful result assign. DiffViewer keys off this so Vue
   * always tears down CodeMirror when IPC finishes — even if a caller held a
   * raw (non-proxy) tab object (GIT-34: tab-flip-only refresh).
   */
  const paintEpoch = ref(0);
  /** Per-tab load generation — stale responses are dropped. */
  const loadGen = new Map<string, number>();
  /** Optional perf marks for __gitxDiffPerf. */
  const lastPerf = ref<{
    id: string;
    invokeMs: number;
    includeTexts: boolean;
    hunkCount: number;
  } | null>(null);

  function bumpGen(id: string): number {
    const g = (loadGen.get(id) ?? 0) + 1;
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
    if ("result" in patch || "contentKey" in patch) {
      paintEpoch.value += 1;
    }
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
    opts?: { force?: boolean },
  ) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;

    const id = `${left}:${right}:${filePath}`;
    const tab = ensureTab({
      id,
      path: filePath,
      left,
      right,
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
      else paintEpoch.value += 1; // force CM remount when switching back to cached tab
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
    const id = `rev:${leftRev}:${rightRev}:${filePath}`;
    const tab = ensureTab({
      id,
      path: filePath,
      left: "head",
      right: "worktree",
      leftRev,
      rightRev,
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
    if (tab.result) {
      paintEpoch.value += 1;
      return;
    }
    await reloadTab(id, { leftPath });
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
    // Soft refresh keeps existing paint; only show skeleton when nothing to show.
    if (!opts?.soft || !tab.result) {
      patchTab(id, { loading: true });
    }
    // Collapsed default: skip full texts on the wire until Expand asks for them.
    const includeTexts =
      opts?.includeTexts ?? (!tab.collapseUnchanged || tab.unified);
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const backend = getBackend();
      let result: DiffFileResult;
      // Re-read live fields after possible concurrent patches.
      const live = liveTab(id)!;
      if (live.leftRev && live.rightRev) {
        result = await backend.diffFileAt({
          repoId: workspace.repoId,
          path: workspace.repoPath,
          filePath: live.path,
          leftRev: live.leftRev,
          rightRev: live.rightRev,
          leftPath: opts?.leftPath ?? null,
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
      // Preserve previously loaded texts when a hunks-only refresh returns none.
      const prev = liveTab(id)?.result;
      if (
        !includeTexts &&
        prev &&
        (result.leftText == null || result.rightText == null)
      ) {
        result = {
          ...result,
          leftText: result.leftText ?? prev.leftText,
          rightText: result.rightText ?? prev.rightText,
        };
      }
      const key = resultContentKey(result);
      if (opts?.soft && liveTab(id)?.contentKey === key && prev) {
        // Unchanged content — keep paint, skip assign thrash.
        return;
      }
      patchTab(id, { result, contentKey: key });
      const t1 =
        typeof performance !== "undefined" ? performance.now() : Date.now();
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
    } finally {
      if (isCurrent(id, gen)) patchTab(id, { loading: false });
    }
  }

  function closeTab(id: string) {
    bumpGen(id);
    tabs.value = tabs.value.filter((t) => t.id !== id);
    loadGen.delete(id);
    if (activeId.value === id) {
      activeId.value = tabs.value[tabs.value.length - 1]?.id ?? null;
    }
  }

  function setUnified(id: string, unified: boolean) {
    patchTab(id, { unified });
  }

  async function setIgnoreWhitespace(id: string, mode: IgnoreWhitespace) {
    const tab = liveTab(id);
    if (!tab) return;
    patchTab(id, { ignoreWhitespace: mode });
    await reloadTab(id, {
      includeTexts: !tab.collapseUnchanged || tab.unified,
    });
  }

  async function setCollapseUnchanged(id: string, value: boolean) {
    const tab = liveTab(id);
    if (!tab) return;
    patchTab(id, { collapseUnchanged: value });
    // Expanding needs full texts; fetch lazily if missing.
    const live = liveTab(id);
    if (
      !value &&
      live?.result &&
      (live.result.leftText == null || live.result.rightText == null) &&
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
    paintEpoch,
    lastPerf,
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
