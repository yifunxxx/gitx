import { defineStore } from "pinia";
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { getBackend } from "@/lib/backend";
import type { ShelfEntry, StashEntry } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useSettingsStore } from "./settingsStore";
import { toast } from "@/composables/useToast";
import { formatErrorMessage, invokeErrorCode } from "@/lib/errors";
import { useChangesStore } from "./changesStore";
import { openDialog } from "@/composables/useDialog";
import { confirmDialog, promptDialog } from "@/composables/useConfirm";
import { i18n } from "@/i18n";

const StashDialog = defineAsyncComponent(() => import("@/features/stash/CreateStashDialog.vue"));
const t = (key: string, args = {}) => i18n.global.t(key, args);

export const useStashShelfStore = defineStore("stashShelf", () => {
  const stashes = ref<StashEntry[]>([]);
  const shelves = ref<ShelfEntry[]>([]);
  const deletedShelves = ref<ShelfEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const selectedStashSha = ref<string | null>(null);
  const selectedShelfId = ref<string | null>(null);
  const showDeleted = ref(false);
  let refreshGeneration = 0;
  let repositoryGeneration = 0;
  const pendingPaths = ref(new Set<string>());
  const workspace = useWorkspaceStore();
  const busy = computed(() => pendingPaths.value.has(workspace.repoPath ?? ""));
  const selectedStash = computed(() => stashes.value.find((s) => s.sha === selectedStashSha.value));
  watch(
    () => workspace.repoPath,
    () => {
      ++refreshGeneration;
      ++repositoryGeneration;
      stashes.value = [];
      shelves.value = [];
      deletedShelves.value = [];
      selectedStashSha.value = null;
      selectedShelfId.value = null;
      loading.value = false;
      error.value = null;
    },
    { flush: "sync" },
  );

  const combineTab = computed(
    () => useSettingsStore().settings?.git?.combineStashesAndShelves !== false,
  );

  async function refresh() {
    const generation = ++refreshGeneration;
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.isRepo) {
      stashes.value = [];
      shelves.value = [];
      deletedShelves.value = [];
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const backend = getBackend();
      const path = workspace.repoPath;
      const [s, sh, deleted] = await Promise.all([
        backend.stashList({ path }),
        backend.shelfList({ path }),
        showDeleted.value ? backend.shelfListDeleted({ path }) : Promise.resolve([]),
      ]);
      if (generation !== refreshGeneration) return;
      stashes.value = s;
      shelves.value = sh;
      deletedShelves.value = deleted;
      if (!s.some((entry) => entry.sha === selectedStashSha.value)) selectedStashSha.value = null;
      if (!sh.some((entry) => entry.id === selectedShelfId.value)) selectedShelfId.value = null;
    } catch (e) {
      if (generation === refreshGeneration) error.value = formatErrorMessage(e);
    } finally {
      if (generation === refreshGeneration) loading.value = false;
    }
  }

  function stashRefOf(entry: StashEntry) {
    return `stash@{${entry.index}}`;
  }

  async function mutate(
    operation: (path: string) => Promise<unknown>,
    successKey?: string,
    emptyKey = "stash.noChanges",
  ) {
    const path = workspace.repoPath;
    if (!path || !workspace.isRepo || pendingPaths.value.has(path)) return false;
    const generation = repositoryGeneration;
    const current = () => generation === repositoryGeneration && path === workspace.repoPath;
    pendingPaths.value.add(path);
    error.value = null;
    try {
      await operation(path);
      if (!current()) return false;
      if (successKey) toast({ title: t(successKey) });
      await Promise.allSettled([refresh(), useChangesStore().refresh()]);
      return current();
    } catch (e) {
      if (current()) {
        const message =
          invokeErrorCode(e) === "nothingToCommit" ? t(emptyKey) : formatErrorMessage(e);
        error.value = message;
        toast({ title: message });
        // Failed apply may still have produced conflicts or partial changes.
        await useChangesStore()
          .refresh()
          .catch(() => {});
      }
      return false;
    } finally {
      pendingPaths.value.delete(path);
    }
  }

  async function promptStash(options: { paths?: string[]; includeUntracked?: boolean } = {}) {
    if (!workspace.repoPath || busy.value) return false;
    const generation = repositoryGeneration;
    const result = await openDialog<{
      message: string;
      includeUntracked: boolean;
      keepIndex: boolean;
    } | null>(StashDialog, { includeUntracked: options.includeUntracked ?? false });
    if (!result || generation !== repositoryGeneration) return false;
    return createStash(result.message, result.includeUntracked, result.keepIndex, options.paths);
  }

  async function createStash(
    message: string,
    includeUntracked = false,
    keepIndex = false,
    paths?: string[],
  ) {
    return mutate(
      (path) => getBackend().stashCreate({ path, message, includeUntracked, keepIndex, paths }),
      "stash.created",
    );
  }

  async function applyStash(stashRef: string, reinstateIndex = false) {
    return mutate(
      (path) => getBackend().stashApply({ path, stashRef, reinstateIndex }),
      "stash.applied",
    );
  }

  async function popStash(stashRef: string, reinstateIndex = false) {
    return mutate(
      (path) => getBackend().stashPop({ path, stashRef, reinstateIndex }),
      "stash.popped",
    );
  }

  async function dropStash(stashRef: string) {
    const generation = repositoryGeneration;
    if (
      !(await confirmDialog({
        title: t("stash.drop"),
        message: t("stash.dropConfirm"),
        destructive: true,
      }))
    )
      return false;
    if (generation !== repositoryGeneration) return false;
    return mutate((path) => getBackend().stashDrop({ path, stashRef }), "stash.dropped");
  }

  async function clearStashes() {
    const generation = repositoryGeneration;
    if (
      !(await confirmDialog({
        title: t("stash.clear"),
        message: t("stash.clearConfirm", { count: stashes.value.length }),
        destructive: true,
      }))
    )
      return false;
    if (generation !== repositoryGeneration) return false;
    return mutate((path) => getBackend().stashClear({ path }), "stash.cleared");
  }

  async function unshelve(id: string, removeApplied = true) {
    const generation = repositoryGeneration;
    return mutate(
      async (path) => {
        const result = await getBackend().shelfUnshelve({ path, id, removeApplied });
        if (generation === repositoryGeneration)
          toast({
            title: t("shelf.unshelved"),
            description: t("shelf.applyResult", {
              applied: result.applied.length,
              failed: result.failed.length,
            }),
          });
      },
      undefined,
      "shelf.noChanges",
    );
  }

  async function promptShelf(paths: string[]) {
    if (!workspace.repoPath || busy.value || !paths.length) return false;
    const generation = repositoryGeneration;
    const selectedPaths = [...paths];
    const message = await promptDialog({
      title: t("shelf.create"),
      defaultValue: t("shelf.defaultMessage"),
    });
    if (message == null || generation !== repositoryGeneration) return false;
    return mutate(
      (path) =>
        getBackend().shelfCreate({
          path,
          message: message || t("shelf.defaultMessage"),
          paths: selectedPaths,
          sourceChangelist: null,
        }),
      "shelf.created",
      "shelf.noChanges",
    );
  }

  async function deleteShelf(id: string) {
    const generation = repositoryGeneration;
    if (
      !(await confirmDialog({
        title: t("shelf.delete"),
        message: t("shelf.deleteConfirm"),
        destructive: true,
      }))
    )
      return false;
    if (generation !== repositoryGeneration) return false;
    return mutate((path) => getBackend().shelfDelete({ path, id }), "shelf.deleted");
  }

  async function renameShelf(id: string, message: string) {
    return mutate((path) => getBackend().shelfRename({ path, id, message }));
  }

  return {
    stashes,
    shelves,
    deletedShelves,
    loading,
    error,
    selectedStashSha,
    selectedStash,
    busy,
    repositoryToken: () => repositoryGeneration,
    selectedShelfId,
    showDeleted,
    combineTab,
    refresh,
    stashRefOf,
    promptStash,
    createStash,
    applyStash,
    popStash,
    dropStash,
    clearStashes,
    unshelve,
    promptShelf,
    deleteShelf,
    renameShelf,
  };
});
