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

  async function openFileDiff(
    filePath: string,
    left: DiffSide = "index",
    right: DiffSide = "worktree",
    opts?: { force?: boolean },
  ) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;

    const id = `${left}:${right}:${filePath}`;
    let tab = tabs.value.find((t) => t.id === id);
    if (!tab) {
      tab = {
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
      };
      tabs.value = [...tabs.value, tab];
    }
    activeId.value = id;
    useLayoutStore().activeEditorKind = "diff";

    // Instant reactivation from cache. Soft refresh only when forced (e.g. after stage).
    if (tab.result) {
      if (opts?.force) await reloadTab(tab, { soft: true });
      return;
    }
    await reloadTab(tab);
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
    let tab = tabs.value.find((t) => t.id === id);
    if (!tab) {
      tab = {
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
      };
      tabs.value = [...tabs.value, tab];
    }
    activeId.value = id;
    useLayoutStore().activeEditorKind = "diff";
    if (tab.result) return;
    await reloadTab(tab, { leftPath });
  }

  async function reloadTab(
    tab: DiffTab,
    opts?: { soft?: boolean; leftPath?: string | null; includeTexts?: boolean },
  ) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    const gen = bumpGen(tab.id);
    // Soft refresh keeps existing paint; only show skeleton when nothing to show.
    if (!opts?.soft || !tab.result) tab.loading = true;
    // Collapsed default: skip full texts on the wire until Expand asks for them.
    const includeTexts =
      opts?.includeTexts ?? (!tab.collapseUnchanged || tab.unified);
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const backend = getBackend();
      let result: DiffFileResult;
      if (tab.leftRev && tab.rightRev) {
        result = await backend.diffFileAt({
          repoId: workspace.repoId,
          path: workspace.repoPath,
          filePath: tab.path,
          leftRev: tab.leftRev,
          rightRev: tab.rightRev,
          leftPath: opts?.leftPath ?? null,
          ignoreWhitespace: tab.ignoreWhitespace,
          includeTexts,
        });
      } else {
        result = await backend.diffFile({
          repoId: workspace.repoId,
          path: workspace.repoPath,
          filePath: tab.path,
          left: tab.left,
          right: tab.right,
          ignoreWhitespace: tab.ignoreWhitespace,
          includeTexts,
        });
      }
      if (!isCurrent(tab.id, gen)) return;
      // Preserve previously loaded texts when a hunks-only refresh returns none.
      if (
        !includeTexts &&
        tab.result &&
        (result.leftText == null || result.rightText == null)
      ) {
        result = {
          ...result,
          leftText: result.leftText ?? tab.result.leftText,
          rightText: result.rightText ?? tab.result.rightText,
        };
      }
      const key = resultContentKey(result);
      if (opts?.soft && tab.contentKey === key && tab.result) {
        // Unchanged content — keep paint, skip assign thrash.
        return;
      }
      tab.result = result;
      tab.contentKey = key;
      const t1 =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      lastPerf.value = {
        id: tab.id,
        invokeMs: Math.round(t1 - t0),
        includeTexts,
        hunkCount: result.hunks.length,
      };
      if (typeof window !== "undefined") {
        (window as Window & { __gitxDiffPerf?: typeof lastPerf.value }).__gitxDiffPerf =
          lastPerf.value;
      }
    } finally {
      if (isCurrent(tab.id, gen)) tab.loading = false;
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
    const tab = tabs.value.find((t) => t.id === id);
    if (tab) tab.unified = unified;
  }

  async function setIgnoreWhitespace(id: string, mode: IgnoreWhitespace) {
    const tab = tabs.value.find((t) => t.id === id);
    if (!tab) return;
    tab.ignoreWhitespace = mode;
    await reloadTab(tab, { includeTexts: !tab.collapseUnchanged || tab.unified });
  }

  async function setCollapseUnchanged(id: string, value: boolean) {
    const tab = tabs.value.find((t) => t.id === id);
    if (!tab) return;
    tab.collapseUnchanged = value;
    // Expanding needs full texts; fetch lazily if missing.
    if (
      !value &&
      tab.result &&
      (tab.result.leftText == null || tab.result.rightText == null) &&
      !tab.result.binary &&
      !tab.result.tooLarge
    ) {
      await reloadTab(tab, { soft: true, includeTexts: true });
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
