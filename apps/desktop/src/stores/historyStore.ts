import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { DiffFileResult, HistoryCommit } from "@/lib/backend";
import { useLayoutStore } from "./layoutStore";
import { useDiffStore } from "./diffStore";
import { formatErrorMessage } from "@/lib/errors";
import { useRepositoryAction } from "@/composables/useRepositoryAction";

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
  diffLoading: boolean;
  diffError: string | null;
};

export const useHistoryStore = defineStore("history", () => {
  const tabs = ref<HistoryTab[]>([]);
  const activeId = ref<string | null>(null);
  const capture = useRepositoryAction(() => {
    tabs.value = [];
    activeId.value = null;
  });
  const requests = new WeakMap<HistoryTab, { load: number; selection: number }>();
  function live(tab: HistoryTab) {
    return tabs.value.includes(tab) && capture().current();
  }
  function stateFor(tab: HistoryTab) {
    let state = requests.get(tab);
    if (!state) {
      state = { load: 0, selection: 0 };
      requests.set(tab, state);
    }
    return state;
  }
  const tabId = (filePath: string, allBranches: boolean) =>
    `history:${JSON.stringify([filePath, allBranches])}`;

  async function openFileHistory(filePath: string, allBranches = false) {
    const source = capture();
    if (!source.current() || !source.repoId) return;
    const id = tabId(filePath, allBranches);
    let tab = tabs.value.find((t) => t.id === id);
    const existing = !!tab;
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
        loading: false,
        error: null,
        diff: null,
        diffLoading: false,
        diffError: null,
      };
      tabs.value = [...tabs.value, tab];
    }
    tab = tabs.value.find((t) => t.id === id)!;
    activeId.value = id;
    useLayoutStore().activeEditorKind = "history";
    if (!existing) await load(tab, true);
  }

  async function load(tab: HistoryTab, reset: boolean) {
    const source = capture();
    if (!source.current() || !source.path || !source.repoId || !live(tab)) return;
    if (!reset && (tab.loading || !tab.truncated)) return;
    const state = stateFor(tab);
    const generation = ++state.load;
    const current = () => source.current() && live(tab) && generation === state.load;
    tab.loading = true;
    tab.error = null;
    if (reset) {
      ++state.selection;
      tab.commits = [];
      tab.truncated = false;
      tab.nextOffset = 0;
      tab.selectedSha = null;
      tab.diff = null;
      tab.diffError = null;
      tab.diffLoading = false;
    }
    try {
      const page = await getBackend().fileHistory({
        repoId: source.repoId,
        path: source.path,
        filePath: tab.filePath,
        offset: reset ? 0 : tab.nextOffset,
        limit: 100,
        allBranches: tab.allBranches,
      });
      if (!current()) return;
      const seen = new Set(tab.commits.map((c) => c.sha));
      tab.commits = reset
        ? page.commits
        : [...tab.commits, ...page.commits.filter((c) => !seen.has(c.sha))];
      tab.truncated = page.truncated;
      tab.nextOffset = page.nextOffset;
      // Reading a diff does not keep the history page itself busy.
      tab.loading = false;
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
    const source = capture();
    if (!source.current() || !source.path || !source.repoId || !live(tab)) return;
    const commit = tab.commits.find((c) => c.sha === sha);
    if (!commit) return;
    if (tab.selectedSha === sha && (tab.diffLoading || tab.diff)) return;
    const state = stateFor(tab);
    const generation = ++state.selection;
    const current = () => source.current() && live(tab) && generation === state.selection;
    tab.selectedSha = sha;
    tab.diff = null;
    tab.diffError = null;
    tab.diffLoading = true;
    const parent = commit.parents[0] ?? "EMPTY";
    const pathAt = commit.pathAtCommit;
    const leftPath = commit.origPath ?? pathAt;
    try {
      const diff = await getBackend().diffFileAt({
        repoId: source.repoId,
        path: source.path,
        filePath: pathAt,
        leftRev: parent,
        rightRev: sha,
        leftPath: typeof leftPath === "string" ? leftPath : pathAt,
      });
      if (current()) tab.diff = diff;
    } catch (e) {
      if (current()) tab.diffError = formatErrorMessage(e);
    } finally {
      if (current()) tab.diffLoading = false;
    }
  }

  async function compareLocal(tab: HistoryTab) {
    if (!live(tab)) return;
    const commit = tab.commits.find((c) => c.sha === tab.selectedSha);
    if (!commit) return;
    await useDiffStore().openRevDiff(tab.filePath, commit.sha, "WORKTREE", commit.pathAtCommit);
  }

  function closeTab(id: string) {
    tabs.value = tabs.value.filter((t) => t.id !== id);
    if (activeId.value === id) {
      activeId.value = tabs.value[tabs.value.length - 1]?.id ?? null;
    }
  }

  async function toggleAllBranches(id: string) {
    const tab = tabs.value.find((t) => t.id === id);
    if (!tab || !live(tab)) return;
    const nextId = tabId(tab.filePath, !tab.allBranches);
    if (tabs.value.some((t) => t.id === nextId)) {
      activeId.value = nextId;
      return;
    }
    tab.id = nextId;
    if (activeId.value === id) activeId.value = nextId;
    tab.allBranches = !tab.allBranches;
    await load(tab, true);
  }

  return {
    tabs,
    activeId,
    openFileHistory,
    load,
    select,
    compareLocal,
    closeTab,
    toggleAllBranches,
  };
});
