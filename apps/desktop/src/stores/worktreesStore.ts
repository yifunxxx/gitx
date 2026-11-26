import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { getBackend } from "@/lib/backend";
import type { WorktreeInfo } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { toast } from "@/composables/useToast";
import { confirmDialog } from "@/composables/useConfirm";
import { createWorkspaceOpen } from "@/composables/useWorkspaceOpen";
import { workspaceOpenState } from "@/composables/workspaceOpenState";
import { formatErrorMessage } from "@/lib/errors";
import { i18n } from "@/i18n";

const t = (key: string) => i18n.global.t(key);

export const useWorktreesStore = defineStore("worktrees", () => {
  const items = ref<WorktreeInfo[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const selectedPath = ref<string | null>(null);
  const createOpen = ref(false);
  const openRefOpen = ref(false);
  /** Once user opens Worktrees tab, keep it visible even for single-worktree repos. */
  const userOpened = ref(false);
  let refreshGeneration = 0;
  let repositoryGeneration = 0;
  const pendingPaths = ref(new Map<string, "mutation" | "prune">());
  const busy = computed(() => pendingPaths.value.has(workspace().repoPath ?? ""));
  const pruning = computed(() => pendingPaths.value.get(workspace().repoPath ?? "") === "prune");
  const { operation: openOperation } = workspaceOpenState(workspace());
  const opening = computed(() => openOperation.value?.navigation === workspace().navigationToken());
  watch(
    () => workspace().repoPath,
    () => {
      ++refreshGeneration;
      ++repositoryGeneration;
      items.value = [];
      selectedPath.value = null;
      loading.value = false;
      error.value = null;
    },
    { flush: "sync" },
  );

  function workspace() {
    return useWorkspaceStore();
  }

  async function refresh() {
    const generation = ++refreshGeneration;
    const ws = workspace();
    if (!ws.repoPath || !ws.isRepo) {
      items.value = [];
      return;
    }
    const path = ws.repoPath;
    const navigation = ws.navigationToken();
    const current = () =>
      generation === refreshGeneration &&
      path === ws.repoPath &&
      navigation === ws.navigationToken();
    loading.value = true;
    error.value = null;
    try {
      const result = await getBackend().worktreeList({ path });
      if (current()) {
        items.value = result;
        if (!result.some((item) => item.path === selectedPath.value)) selectedPath.value = null;
      }
    } catch (e) {
      if (current()) error.value = formatErrorMessage(e);
    } finally {
      if (generation === refreshGeneration) loading.value = false;
    }
  }

  async function mutate<T>(
    operation: (path: string) => Promise<T>,
    successKey?: string,
    after?: (result: T) => Promise<void>,
    propagateError = false,
  ) {
    const ws = workspace();
    const path = ws.repoPath;
    if (!path || !ws.isRepo || pendingPaths.value.has(path)) return;
    const generation = repositoryGeneration;
    const navigation = ws.navigationToken();
    const current = () =>
      generation === repositoryGeneration &&
      path === ws.repoPath &&
      navigation === ws.navigationToken();
    pendingPaths.value.set(path, "mutation");
    error.value = null;
    try {
      const result = await operation(path);
      if (!current()) return;
      if (successKey) toast({ title: t(successKey) });
      await refresh();
      if (!current()) return;
      await after?.(result);
      return result;
    } catch (e) {
      if (current()) {
        error.value = formatErrorMessage(e);
        if (!propagateError) toast({ title: error.value });
      }
      if (propagateError) throw e;
    } finally {
      pendingPaths.value.delete(path);
    }
  }

  async function create(opts: {
    worktreePath: string;
    startRef: string;
    newBranch?: string | null;
    track?: boolean;
    openAfter?: boolean;
  }) {
    return mutate(
      (path) =>
        getBackend().worktreeAdd({
          path,
          worktreePath: opts.worktreePath,
          startRef: opts.startRef,
          newBranch: opts.newBranch ?? null,
          track: opts.track,
          openAfter: opts.openAfter,
        }),
      "worktrees.created",
      async (res) => {
        if (res.openAfter) await openWorktree(res.worktreePath, false);
      },
      true,
    );
  }

  async function openWorktree(path: string, preferNewWindow: boolean) {
    await createWorkspaceOpen(t).openWorktree(path, preferNewWindow);
  }

  async function remove(path: string, force: boolean) {
    return mutate(async (repoPath) => {
      await getBackend().worktreeRemove({
        path: repoPath,
        worktreePath: path,
        force,
      });
      // Recent repositories are shared across workspaces. Refresh them even
      // if navigation happened while this removal was running, without delaying
      // the worktree list or completion feedback for this successful removal.
      void workspace().loadRecent();
    }, "worktrees.removed");
  }

  async function lock(path: string, reason?: string) {
    return mutate((repoPath) =>
      getBackend().worktreeLock({
        path: repoPath,
        worktreePath: path,
        reason: reason ?? null,
      }),
    );
  }

  async function unlock(path: string) {
    return mutate((repoPath) =>
      getBackend().worktreeUnlock({
        path: repoPath,
        worktreePath: path,
      }),
    );
  }

  async function prune() {
    const ws = workspace();
    const path = ws.repoPath;
    const generation = repositoryGeneration;
    if (!path || !ws.isRepo || pendingPaths.value.has(path)) return;
    const navigation = ws.navigationToken();
    const current = () =>
      generation === repositoryGeneration &&
      path === ws.repoPath &&
      navigation === ws.navigationToken();
    // Own the whole preview/confirmation/write lifecycle, including the time
    // spent waiting for the user's confirmation. Other mutations must wait too.
    pendingPaths.value.set(path, "prune");
    error.value = null;
    try {
      const preview = await getBackend().worktreePrunePreview({ path });
      if (!current()) return;
      if (preview.paths.length === 0 && !preview.dryRunOutput.trim()) {
        toast({ title: t("worktrees.nothingToPrune") });
        return;
      }
      const ok = await confirmDialog({
        title: t("worktrees.prune"),
        message: `${t("worktrees.pruneConfirm")}\n\n${preview.dryRunOutput || preview.paths.join("\n")}`,
        destructive: true,
      });
      if (!ok || !current()) return;
      await getBackend().worktreePrune({ path });
      if (!current()) return;
      toast({ title: t("worktrees.pruned") });
      await refresh();
    } catch (e) {
      if (current()) error.value = formatErrorMessage(e);
    } finally {
      pendingPaths.value.delete(path);
    }
  }

  async function openRef(opts: {
    worktreePath: string;
    remote: string;
    refspec: string;
    reviewName: string;
  }) {
    return mutate(
      (path) =>
        getBackend().worktreeOpenRef({
          path,
          ...opts,
        }),
      "worktrees.created",
      async (res) => {
        if (res.openAfter) await openWorktree(res.worktreePath, false);
      },
      true,
    );
  }

  return {
    items,
    loading,
    busy,
    pruning,
    opening,
    repositoryToken: () => `${repositoryGeneration}:${workspace().navigationToken()}`,
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
