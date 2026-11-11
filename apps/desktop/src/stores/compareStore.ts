import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { ChangedFile, CombinedDiffResult, LogCommit } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useLayoutStore } from "./layoutStore";
import { useDiffStore } from "./diffStore";
import { formatErrorMessage } from "@/lib/errors";
import { useRepositoryAction } from "@/composables/useRepositoryAction";

export type CompareTab = {
  id: string;
  title: string;
  left: string;
  right: string;
  mode: "commits" | "refs" | "local";
  files: ChangedFile[];
  leftOnly: LogCommit[];
  rightOnly: LogCommit[];
  loading: boolean;
  error: string | null;
  combined: CombinedDiffResult | null;
};

export const useCompareStore = defineStore("compare", () => {
  const tabs = ref<CompareTab[]>([]);
  const activeId = ref<string | null>(null);
  const capture = useRepositoryAction(() => {
    tabs.value = [];
    activeId.value = null;
  });
  const requests = new WeakMap<CompareTab, { load: number; combined: number }>();
  function live(tab: CompareTab) {
    return tabs.value.includes(tab) && capture().current();
  }
  function begin(tab: CompareTab) {
    if (!live(tab)) return;
    const state = requests.get(tab) ?? { load: 0, combined: 0 };
    requests.set(tab, state);
    const generation = ++state.load;
    ++state.combined;
    const source = capture();
    return { ...source, current: () => source.current() && live(tab) && generation === state.load };
  }

  async function compareVersions(a: string, b: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId || !capture().current()) return;
    const id = `compare:${a}:${b}`;
    let tab = tabs.value.find((t) => t.id === id);
    if (!tab) {
      tab = {
        id,
        title: `Compare ${a.slice(0, 7)}…${b.slice(0, 7)}`,
        left: a,
        right: b,
        mode: "commits",
        files: [],
        leftOnly: [],
        rightOnly: [],
        loading: true,
        error: null,
        combined: null,
      };
      tabs.value = [...tabs.value, tab];
    }
    tab = tabs.value.find((t) => t.id === id)!;
    activeId.value = id;
    useLayoutStore().activeEditorKind = "compare";
    return await reload(tab);
  }

  async function compareWithLocal(rev: string) {
    const tab = await compareVersions(rev, "WORKTREE");
    if (tab) {
      tab.mode = "local";
      tab.title = `Compare ${rev.slice(0, 7)} with Local`;
    }
    return tab;
  }

  async function compareRefs(left: string, right: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId || !capture().current()) return;
    const id = `compare-refs:${left}:${right}`;
    let tab = tabs.value.find((t) => t.id === id);
    if (!tab) {
      tab = {
        id,
        title: `${left} ↔ ${right}`,
        left,
        right,
        mode: "refs",
        files: [],
        leftOnly: [],
        rightOnly: [],
        loading: true,
        error: null,
        combined: null,
      };
      tabs.value = [...tabs.value, tab];
    }
    tab = tabs.value.find((t) => t.id === id)!;
    activeId.value = id;
    useLayoutStore().activeEditorKind = "compare";
    return await reload(tab);
  }

  async function reload(tab: CompareTab) {
    const source = begin(tab);
    if (!source || !source.path || !source.repoId) return;
    const { left, right } = tab;
    tab.loading = true;
    tab.error = null;
    tab.combined = null;
    try {
      const backend = getBackend();
      const [leftPage, rightPage, files] = await Promise.all([
        tab.mode === "refs"
          ? backend.logQuery({
              repoId: source.repoId,
              path: source.path,
              limit: 200,
              filters: { revisions: [`${left}..${right}`] },
            })
          : undefined,
        tab.mode === "refs"
          ? backend.logQuery({
              repoId: source.repoId,
              path: source.path,
              limit: 200,
              filters: { revisions: [`${right}..${left}`] },
            })
          : undefined,
        backend.diffRefs({
          repoId: source.repoId,
          path: source.path,
          left,
          right,
        }),
      ]);
      if (!source.current()) return;
      tab.rightOnly = leftPage?.commits ?? []; // commits in right not in left
      tab.leftOnly = rightPage?.commits ?? [];
      tab.files = files.files;
      tab.left = files.left;
      tab.right = files.right;
      return tab;
    } catch (e) {
      if (source.current()) tab.error = formatErrorMessage(e);
    } finally {
      if (source.current()) tab.loading = false;
    }
  }

  async function swap(id: string) {
    const tab = tabs.value.find((t) => t.id === id);
    if (!tab || !live(tab)) return;
    const left = tab.left;
    tab.left = tab.right;
    tab.right = left;
    await reload(tab);
  }

  async function openFile(tab: CompareTab, filePath: string, origPath?: string | null) {
    if (!live(tab)) return;
    const diffs = useDiffStore();
    await diffs.openRevDiff(filePath, tab.left, tab.right, origPath ?? undefined);
  }

  async function showCombined(tab: CompareTab) {
    const source = capture();
    if (!source.current() || !source.path || !source.repoId || !live(tab) || tab.loading) return;
    const state = requests.get(tab);
    if (!state) return;
    const generation = ++state.combined;
    const { left, right } = tab;
    const current = () =>
      source.current() &&
      live(tab) &&
      generation === state.combined &&
      tab.left === left &&
      tab.right === right;
    tab.error = null;
    try {
      // The combined endpoint takes the destination first, including WORKTREE.
      const result = await getBackend().diffCombined({
        repoId: source.repoId,
        path: source.path,
        left: right,
        right: left,
        limit: 50,
      });
      if (current()) tab.combined = result;
    } catch (e) {
      if (current()) tab.error = formatErrorMessage(e);
    }
  }

  function closeTab(id: string) {
    tabs.value = tabs.value.filter((t) => t.id !== id);
    if (activeId.value === id) {
      activeId.value = tabs.value[tabs.value.length - 1]?.id ?? null;
    }
  }

  return {
    tabs,
    activeId,
    compareVersions,
    compareWithLocal,
    compareRefs,
    swap,
    openFile,
    showCombined,
    closeTab,
    reload,
  };
});
