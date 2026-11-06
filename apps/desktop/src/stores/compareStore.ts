import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { ChangedFile, CombinedDiffResult, LogCommit } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useLayoutStore } from "./layoutStore";
import { useDiffStore } from "./diffStore";
import { formatErrorMessage } from "@/lib/errors";

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

  async function compareVersions(a: string, b: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
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
    activeId.value = id;
    useLayoutStore().activeEditorKind = "compare";
    await reload(tab);
  }

  async function compareWithLocal(rev: string) {
    await compareVersions(rev, "WORKTREE");
    const tab = tabs.value.find((t) => t.id === `compare:${rev}:WORKTREE`);
    if (tab) {
      tab.mode = "local";
      tab.title = `Compare ${rev.slice(0, 7)} with Local`;
    }
  }

  async function compareRefs(left: string, right: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
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
    activeId.value = id;
    useLayoutStore().activeEditorKind = "compare";
    tab.loading = true;
    try {
      const backend = getBackend();
      const [leftPage, rightPage, files] = await Promise.all([
        backend.logQuery({
          repoId: workspace.repoId,
          path: workspace.repoPath,
          limit: 200,
          filters: { revisions: [`${left}..${right}`] },
        }),
        backend.logQuery({
          repoId: workspace.repoId,
          path: workspace.repoPath,
          limit: 200,
          filters: { revisions: [`${right}..${left}`] },
        }),
        backend.diffRefs({
          repoId: workspace.repoId,
          path: workspace.repoPath,
          left,
          right,
        }),
      ]);
      tab.rightOnly = leftPage.commits; // commits in right not in left
      tab.leftOnly = rightPage.commits;
      tab.files = files.files;
      tab.left = files.left;
      tab.right = files.right;
    } catch (e) {
      tab.error = formatErrorMessage(e);
    } finally {
      tab.loading = false;
    }
  }

  async function reload(tab: CompareTab) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    tab.loading = true;
    tab.error = null;
    try {
      const backend = getBackend();
      const result = await backend.diffRefs({
        repoId: workspace.repoId,
        path: workspace.repoPath,
        left: tab.left,
        right: tab.right,
      });
      tab.left = result.left;
      tab.right = result.right;
      tab.files = result.files;
    } catch (e) {
      tab.error = formatErrorMessage(e);
    } finally {
      tab.loading = false;
    }
  }

  async function swap(id: string) {
    const tab = tabs.value.find((t) => t.id === id);
    if (!tab) return;
    const left = tab.left;
    tab.left = tab.right;
    tab.right = left;
    if (tab.mode === "refs") {
      await compareRefs(tab.left, tab.right);
    } else {
      await reload(tab);
    }
  }

  async function openFile(tab: CompareTab, filePath: string, origPath?: string | null) {
    const diffs = useDiffStore();
    await diffs.openRevDiff(filePath, tab.left, tab.right, origPath ?? undefined);
    useLayoutStore().activeEditorKind = "diff";
  }

  async function showCombined(tab: CompareTab) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    tab.combined = await getBackend().diffCombined({
      repoId: workspace.repoId,
      path: workspace.repoPath,
      left: tab.right === "WORKTREE" ? tab.left : tab.right,
      right: tab.right === "WORKTREE" ? undefined : tab.left,
      limit: 50,
    });
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
