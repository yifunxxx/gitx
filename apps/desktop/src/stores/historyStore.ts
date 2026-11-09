import { defineStore } from "pinia";
import { ref, watch } from "vue";
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
  const workspace = useWorkspaceStore();
  watch(
    () => workspace.repoPath,
    () => {
      tabs.value = [];
      activeId.value = null;
    },
    { flush: "sync" },
  );
  const loads = new WeakMap<HistoryTab, number>();
  const selections = new WeakMap<HistoryTab, number>();
  let generation = 0;

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
    tab = tabs.value.find((t) => t.id === id)!;
    activeId.value = id;
    useLayoutStore().activeEditorKind = "history";
    await load(tab, true);
  }

  async function load(tab: HistoryTab, reset: boolean) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    if (!tabs.value.includes(tab)) return;
    const request = ++generation;
    loads.set(tab, request);
    const current = () => tabs.value.includes(tab) && loads.get(tab) === request;
    tab.loading = true;
    tab.error = null;
    if (reset) {
      selections.set(tab, ++generation);
      tab.selectedSha = null;
      tab.diff = null;
    }
    try {
      const page = await getBackend().fileHistory({
        repoId: workspace.repoId,
        path: workspace.repoPath,
        filePath: tab.filePath,
        offset: reset ? 0 : tab.nextOffset,
        limit: 100,
        allBranches: tab.allBranches,
      });
      if (!current()) return;
      tab.commits = reset ? page.commits : [...tab.commits, ...page.commits];
      tab.truncated = page.truncated;
      tab.nextOffset = page.nextOffset;
      if (!tab.selectedSha && page.commits[0]) {
        await select(tab, page.commits[0].sha);
      }
    } catch (e) {
      if (current()) tab.error = formatErrorMessage(e);
    } finally {
      if (current()) tab.loading = false;
    }
  }

  async function select(tab: HistoryTab, sha: string) {
    if (!tabs.value.includes(tab)) return;
    const request = ++generation;
    selections.set(tab, request);
    const current = () => tabs.value.includes(tab) && selections.get(tab) === request;
    tab.selectedSha = sha;
    tab.diff = null;
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    const commit = tab.commits.find((c) => c.sha === sha);
    const parent = commit ? (commit.parents[0] ?? "EMPTY") : `${sha}^`;
    const pathAt = commit?.pathAtCommit ?? tab.filePath;
    const leftPath = commit?.origPath ?? pathAt;
    try {
      const diff = await getBackend().diffFileAt({
        repoId: workspace.repoId,
        path: workspace.repoPath,
        filePath: pathAt,
        leftRev: parent,
        rightRev: sha,
        leftPath: typeof leftPath === "string" ? leftPath : pathAt,
      });
      if (current()) tab.diff = diff;
    } catch {
      if (current()) tab.diff = null;
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
