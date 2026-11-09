import { defineStore } from "pinia";
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { getBackend } from "@/lib/backend";
import type { ShelfEntry, StashEntry } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useSettingsStore } from "./settingsStore";
import { toast } from "@/composables/useToast";
import { formatErrorMessage, invokeErrorCode } from "@/lib/errors";
import { useChangesStore } from "./changesStore";
import { useConflictsStore } from "./conflictsStore";
import { useRewriteStore } from "./rewriteStore";
import { openDialog } from "@/composables/useDialog";
import { confirmDialog, promptDialog } from "@/composables/useConfirm";
import { i18n } from "@/i18n";
import { isTauri } from "@/lib/utils";

const StashDialog = defineAsyncComponent(() => import("@/features/stash/CreateStashDialog.vue"));
const ShelfDialog = defineAsyncComponent(() => import("@/features/stash/CreateShelfDialog.vue"));
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
    const ws = useWorkspaceStore();
    const generation = ++refreshGeneration;
    const path = ws.repoPath;
    const navigation = ws.navigationToken();
    const current = () =>
      generation === refreshGeneration &&
      path === ws.repoPath &&
      navigation === ws.navigationToken();
    if (!ws.repoPath || !ws.isRepo) {
      stashes.value = [];
      shelves.value = [];
      deletedShelves.value = [];
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const backend = getBackend();
      const [s, sh, deleted] = await Promise.all([
        backend.stashList({ path: path! }),
        backend.shelfList({ path: path! }),
        showDeleted.value ? backend.shelfListDeleted({ path: path! }) : Promise.resolve([]),
      ]);
      if (!current()) return;
      stashes.value = s;
      shelves.value = sh;
      deletedShelves.value = deleted;
      if (!s.some((entry) => entry.sha === selectedStashSha.value)) selectedStashSha.value = null;
      if (!sh.some((entry) => entry.id === selectedShelfId.value)) selectedShelfId.value = null;
    } catch (e) {
      if (current()) error.value = formatErrorMessage(e);
    } finally {
      if (generation === refreshGeneration) loading.value = false;
    }
  }

  function stashRefOf(entry: StashEntry) {
    return `stash@{${entry.index}}`;
  }

  async function mutate(
    operation: (path: string, current: () => boolean) => Promise<unknown>,
    successKey?: string,
    emptyKey = "stash.noChanges",
  ) {
    const path = workspace.repoPath;
    if (!path || !workspace.isRepo || pendingPaths.value.has(path)) return false;
    const generation = repositoryGeneration;
    const navigation = workspace.navigationToken();
    const current = () =>
      generation === repositoryGeneration &&
      path === workspace.repoPath &&
      navigation === workspace.navigationToken();
    pendingPaths.value.add(path);
    error.value = null;
    try {
      if ((await operation(path, current)) === false) return false;
      if (!current()) return false;
      await refreshRelated();
      if (current() && successKey) toast({ title: t(successKey) });
      return current();
    } catch (e) {
      if (current()) {
        const message =
          invokeErrorCode(e) === "nothingToCommit" ? t(emptyKey) : formatErrorMessage(e);
        // Failed apply may still have produced conflicts or partial changes.
        await refreshRelated();
        if (current()) {
          error.value = message;
          toast({ title: message });
        }
      }
      return false;
    } finally {
      pendingPaths.value.delete(path);
    }
  }

  async function refreshRelated() {
    await Promise.allSettled([
      refresh(),
      useChangesStore().refresh(),
      useConflictsStore().refresh(),
      useRewriteStore().refreshOpState(),
    ]);
  }

  async function promptStash(options: { paths?: string[]; includeUntracked?: boolean } = {}) {
    const paths = options.paths ? [...options.paths] : undefined;
    const includeUntracked = options.includeUntracked ?? false;
    return mutate(async (path, current) => {
      const result = await openDialog<{
        message: string;
        includeUntracked: boolean;
        keepIndex: boolean;
      } | null>(StashDialog, { includeUntracked });
      if (!result || !current()) return false;
      await getBackend().stashCreate({ path, ...result, paths });
    }, "stash.created");
  }

  async function createStash(
    message: string,
    includeUntracked = false,
    keepIndex = false,
    paths?: string[],
  ) {
    const selectedPaths = paths ? [...paths] : undefined;
    return mutate(
      (path) =>
        getBackend().stashCreate({
          path,
          message,
          includeUntracked,
          keepIndex,
          paths: selectedPaths,
        }),
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
    return mutate(async (path, current) => {
      if (
        !(await confirmDialog({
          title: t("stash.drop"),
          message: t("stash.dropConfirm"),
          destructive: true,
        })) ||
        !current()
      )
        return false;
      await getBackend().stashDrop({ path, stashRef });
    }, "stash.dropped");
  }

  async function clearStashes() {
    const snapshot = stashes.value.map((entry) => entry.sha);
    if (!snapshot.length) return false;
    return mutate(async (path, current) => {
      if (
        !(await confirmDialog({
          title: t("stash.clear"),
          message: t("stash.clearConfirm", { count: snapshot.length }),
          destructive: true,
        })) ||
        !current()
      )
        return false;
      const latest = await getBackend().stashList({ path });
      if (!current()) return false;
      if (latest.length !== snapshot.length || latest.some((entry, i) => entry.sha !== snapshot[i]))
        throw new Error(t("stash.listChanged"));
      await getBackend().stashClear({ path });
    }, "stash.cleared");
  }

  async function unshelve(id: string, removeApplied = false) {
    return mutate(
      async (path) => {
        const result = await getBackend().shelfUnshelve({ path, id, removeApplied });
        if (result.failed.length)
          throw new Error(
            result.applied.length
              ? t("shelf.applyPartial", {
                  applied: result.applied.length,
                  failed: result.failed.length,
                })
              : t("shelf.applyFailed", { count: result.failed.length }),
          );
      },
      "shelf.unshelved",
      "shelf.noChanges",
    );
  }

  async function promptShelf(paths: string[]) {
    const selectedPaths = [...paths];
    if (!selectedPaths.length) return false;
    return mutate(
      async (path, current) => {
        const result = await openDialog<{ message: string; keepChanges: boolean } | null>(
          ShelfDialog,
          { count: selectedPaths.length },
        );
        if (!result || !current()) return false;
        await getBackend().shelfCreate({
          path,
          message: result.message.trim() || t("shelf.defaultMessage"),
          keepChanges: result.keepChanges,
          paths: selectedPaths,
          sourceChangelist: null,
        });
      },
      "shelf.created",
      "shelf.noChangesToSave",
    );
  }

  async function deleteShelf(id: string) {
    return mutate(async (path, current) => {
      if (
        !(await confirmDialog({
          title: t("shelf.delete"),
          message: t("shelf.deleteConfirm"),
          destructive: true,
        })) ||
        !current()
      )
        return false;
      await getBackend().shelfDelete({ path, id });
    }, "shelf.deleted");
  }

  async function promptImportShelf() {
    return mutate(
      async (path, current) => {
        let patchFile: string | null;
        if (isTauri()) {
          const { open } = await import("@tauri-apps/plugin-dialog");
          if (!current()) return false;
          const selected = await open({
            title: t("shelf.importPatch"),
            directory: false,
            multiple: false,
            filters: [{ name: t("shelf.patchFiles"), extensions: ["patch", "diff"] }],
          });
          patchFile = typeof selected === "string" ? selected : null;
        } else {
          patchFile = await promptDialog({
            title: t("shelf.importPatch"),
            placeholder: t("shelf.patchPath"),
            allowEmpty: false,
          });
        }
        if (!patchFile || !current()) return false;
        const name = patchFile.split(/[\\/]/).pop()?.replace(/\.(patch|diff)$/i, "");
        const entry = await getBackend().shelfImport({
          path,
          patchFile,
          message: name || t("shelf.defaultMessage"),
        });
        if (!current()) return false;
        selectedShelfId.value = entry.id;
      },
      "shelf.imported",
      "shelf.noPatchChanges",
    );
  }

  async function promptRenameShelf(id: string) {
    const shelf = shelves.value.find((entry) => entry.id === id);
    if (!shelf) return false;
    const message = shelf.message;
    return mutate(async (path, current) => {
      const result = await promptDialog({
        title: t("shelf.rename"),
        defaultValue: message,
        placeholder: t("shelf.renamePrompt"),
        allowEmpty: false,
      });
      if (!result?.trim() || !current() || !shelves.value.some((entry) => entry.id === id))
        return false;
      await getBackend().shelfRename({ path, id, message: result.trim() });
    });
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
    promptImportShelf,
    promptRenameShelf,
    deleteShelf,
    renameShelf,
  };
});
