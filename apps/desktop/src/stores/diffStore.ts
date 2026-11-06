import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { DiffFileResult, DiffSide } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";

export type DiffTab = {
  id: string;
  path: string;
  left: DiffSide;
  right: DiffSide;
  title: string;
  result: DiffFileResult | null;
  loading: boolean;
  unified: boolean;
};

export const useDiffStore = defineStore("diff", () => {
  const tabs = ref<DiffTab[]>([]);
  const activeId = ref<string | null>(null);

  async function openFileDiff(
    filePath: string,
    left: DiffSide = "index",
    right: DiffSide = "worktree",
  ) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;

    // Default: unstaged → index vs worktree; staged-only → head vs index
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
      };
      tabs.value = [...tabs.value, tab];
    }
    activeId.value = id;
    tab.loading = true;
    try {
      const backend = getBackend();
      tab.result = await backend.diffFile({
        repoId: workspace.repoId,
        path: workspace.repoPath,
        filePath,
        left,
        right,
      });
    } finally {
      tab.loading = false;
    }
  }

  function closeTab(id: string) {
    tabs.value = tabs.value.filter((t) => t.id !== id);
    if (activeId.value === id) {
      activeId.value = tabs.value[tabs.value.length - 1]?.id ?? null;
    }
  }

  function setUnified(id: string, unified: boolean) {
    const tab = tabs.value.find((t) => t.id === id);
    if (tab) tab.unified = unified;
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
    closeTab,
    setUnified,
    stageHunks,
    unstageHunks,
  };
});
