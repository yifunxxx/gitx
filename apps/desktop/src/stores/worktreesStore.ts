import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { WorktreeInfo } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { toast } from "@/composables/useToast";
import { confirmDialog } from "@/composables/useConfirm";
import { formatErrorMessage } from "@/lib/errors";

export const useWorktreesStore = defineStore("worktrees", () => {
  const items = ref<WorktreeInfo[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const selectedPath = ref<string | null>(null);
  const createOpen = ref(false);
  const openRefOpen = ref(false);
  /** Once user opens Worktrees tab, keep it visible even for single-worktree repos. */
  const userOpened = ref(false);

  function workspace() {
    return useWorkspaceStore();
  }

  async function refresh() {
    const ws = workspace();
    if (!ws.repoPath || !ws.isRepo) {
      items.value = [];
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      items.value = await getBackend().worktreeList({ path: ws.repoPath });
    } catch (e) {
      error.value = formatErrorMessage(e);
    } finally {
      loading.value = false;
    }
  }

  async function create(opts: {
    worktreePath: string;
    startRef: string;
    newBranch?: string | null;
    track?: boolean;
    openAfter?: boolean;
  }) {
    const ws = workspace();
    if (!ws.repoPath) return;
    const res = await getBackend().worktreeAdd({
      path: ws.repoPath,
      worktreePath: opts.worktreePath,
      startRef: opts.startRef,
      newBranch: opts.newBranch,
      track: opts.track,
      openAfter: opts.openAfter,
    });
    toast({ title: "Worktree created", description: res.worktreePath });
    await refresh();
    if (res.openAfter) {
      await openWorktree(res.worktreePath, true);
    }
    return res;
  }

  async function openWorktree(path: string, _newWindow: boolean) {
    // Single main window: always switch the current workspace (no OS window spawn).
    await workspace().openFolder(path);
    toast({ title: "Worktree", description: path });
  }

  async function remove(path: string, force: boolean) {
    const ws = workspace();
    if (!ws.repoPath) return;
    await getBackend().worktreeRemove({
      path: ws.repoPath,
      worktreePath: path,
      force,
    });
    toast({ title: "Worktree removed", description: path });
    selectedPath.value = null;
    await refresh();
  }

  async function lock(path: string, reason?: string) {
    const ws = workspace();
    if (!ws.repoPath) return;
    await getBackend().worktreeLock({
      path: ws.repoPath,
      worktreePath: path,
      reason: reason ?? null,
    });
    await refresh();
  }

  async function unlock(path: string) {
    const ws = workspace();
    if (!ws.repoPath) return;
    await getBackend().worktreeUnlock({
      path: ws.repoPath,
      worktreePath: path,
    });
    await refresh();
  }

  async function prune() {
    const ws = workspace();
    if (!ws.repoPath) return;
    const preview = await getBackend().worktreePrunePreview({ path: ws.repoPath });
    if (preview.paths.length === 0 && !preview.dryRunOutput.trim()) {
      toast({ title: "Nothing to prune" });
      return;
    }
    const ok = await confirmDialog({
      title: "Prune Worktrees",
      message: `Prune ${preview.paths.length || "listed"} worktree(s)?\n\n${preview.dryRunOutput || preview.paths.join("\n")}`,
      destructive: true,
    });
    if (!ok) return;
    await getBackend().worktreePrune({ path: ws.repoPath });
    toast({ title: "Worktrees pruned" });
    await refresh();
  }

  async function openRef(opts: {
    worktreePath: string;
    remote: string;
    refspec: string;
    reviewName: string;
  }) {
    const ws = workspace();
    if (!ws.repoPath) return;
    const res = await getBackend().worktreeOpenRef({
      path: ws.repoPath,
      ...opts,
    });
    toast({ title: "Opened ref in worktree", description: res.worktreePath });
    await refresh();
    await openWorktree(res.worktreePath, true);
  }

  return {
    items,
    loading,
    error,
    selectedPath,
    createOpen,
    openRefOpen,
    userOpened,
    refresh,
    create,
    openWorktree,
    remove,
    lock,
    unlock,
    prune,
    openRef,
  };
});
