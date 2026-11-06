import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { DiffFileResult, HistoryCommit } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useLayoutStore } from "./layoutStore";
import { formatErrorMessage } from "@/lib/errors";

export type HistoryTab = {
  id: string;
  filePath: string;
  title: string;
  allBranches: boolean;
  commits: HistoryCommit[];
  truncated: boolean;
  nextOffset: number;
  selectedSha: string | null;
  loading: boolean;
  error: string | null;
  diff: DiffFileResult | null;
};

export const useHistoryStore = defineStore("history", () => {
  const tabs = ref<HistoryTab[]>([]);
  const activeId = ref<string | null>(null);

  async function openFileHistory(filePath: string, allBranches = false) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    const id = `history:${filePath}:${allBranches ? "all" : "branch"}`;
    let tab = tabs.value.find((t) => t.id === id);
    if (!tab) {
      tab = {
        id,
        filePath,
        title: `History: ${filePath.split(/[\\/]/).pop() ?? filePath}`,
        allBranches,
        commits: [],
        truncated: false,
        nextOffset: 0,
        selectedSha: null,
        loading: true,
        error: null,
        diff: null,
      };
      tabs.value = [...tabs.value, tab];
    }
    activeId.value = id;
    useLayoutStore().activeEditorKind = "history";
    await load(tab, true);
  }

  async function load(tab: HistoryTab, reset: boolean) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    tab.loading = true;
    tab.error = null;
    try {
      const page = await getBackend().fileHistory({
        repoId: workspace.repoId,
        path: workspace.repoPath,
        filePath: tab.filePath,
        offset: reset ? 0 : tab.nextOffset,
        limit: 100,
        allBranches: tab.allBranches,
      });
      tab.commits = reset ? page.commits : [...tab.commits, ...page.commits];
      tab.truncated = page.truncated;
      tab.nextOffset = page.nextOffset;
      if (!tab.selectedSha && page.commits[0]) {
        await select(tab, page.commits[0].sha);
      }
    } catch (e) {
      tab.error = formatErrorMessage(e);
    } finally {
      tab.loading = false;
    }
  }

  async function select(tab: HistoryTab, sha: string) {
    tab.selectedSha = sha;
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    const commit = tab.commits.find((c) => c.sha === sha);
    const parent = commit?.parents[0] ?? `${sha}^`;
    const pathAt = commit?.pathAtCommit ?? tab.filePath;
    const leftPath = commit?.origPath ?? pathAt;
    try {
      tab.diff = await getBackend().diffFileAt({
        repoId: workspace.repoId,
        path: workspace.repoPath,
        filePath: pathAt,
        leftRev: parent,
        rightRev: sha,
        leftPath: typeof leftPath === "string" ? leftPath : pathAt,
      });
    } catch {
      tab.diff = null;
    }
  }

  function closeTab(id: string) {
    tabs.value = tabs.value.filter((t) => t.id !== id);
    if (activeId.value === id) {
      activeId.value = tabs.value[tabs.value.length - 1]?.id ?? null;
    }
  }

  async function toggleAllBranches(id: string) {
    const tab = tabs.value.find((t) => t.id === id);
    if (!tab) return;
    tab.allBranches = !tab.allBranches;
    await load(tab, true);
  }

  return {
    tabs,
    activeId,
    openFileHistory,
    load,
    select,
    closeTab,
    toggleAllBranches,
  };
});
