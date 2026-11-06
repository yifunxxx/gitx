import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { DiffFileResult, DiffSide, IgnoreWhitespace } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";

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
};

export const useDiffStore = defineStore("diff", () => {
  const tabs = ref<DiffTab[]>([]);
  const activeId = ref<string | null>(null);
  /** Per-tab load generation — stale responses are dropped. */
  const loadGen = new Map<string, number>();

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

    // Instant reactivation from cache; soft refresh keeps the previous paint.
    if (tab.result) {
      if (opts?.force) await reloadTab(tab, { soft: true });
      else void reloadTab(tab, { soft: true });
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
    if (tab.result) {
      void reloadTab(tab, { soft: true });
      return;
    }
    await reloadTab(tab, { leftPath });
  }

  async function reloadTab(
    tab: DiffTab,
    opts?: { soft?: boolean; leftPath?: string | null },
  ) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    const gen = bumpGen(tab.id);
    // Soft refresh keeps existing paint; only show skeleton when nothing to show.
    if (!opts?.soft || !tab.result) tab.loading = true;
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
        });
      } else {
        result = await backend.diffFile({
          repoId: workspace.repoId,
          path: workspace.repoPath,
          filePath: tab.path,
          left: tab.left,
          right: tab.right,
          ignoreWhitespace: tab.ignoreWhitespace,
        });
      }
      if (!isCurrent(tab.id, gen)) return;
      tab.result = result;
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
    await reloadTab(tab);
  }

  function setCollapseUnchanged(id: string, value: boolean) {
    const tab = tabs.value.find((t) => t.id === id);
    if (tab) tab.collapseUnchanged = value;
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
