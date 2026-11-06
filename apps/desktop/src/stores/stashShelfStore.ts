import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { ShelfEntry, StashEntry } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useSettingsStore } from "./settingsStore";
import { toast } from "@/composables/useToast";

export const useStashShelfStore = defineStore("stashShelf", () => {
  const stashes = ref<StashEntry[]>([]);
  const shelves = ref<ShelfEntry[]>([]);
  const deletedShelves = ref<ShelfEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const selectedStashRef = ref<string | null>(null);
  const selectedShelfId = ref<string | null>(null);
  const showDeleted = ref(false);

  const combineTab = computed(
    () => useSettingsStore().settings?.git?.combineStashesAndShelves !== false,
  );

  async function refresh() {
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
      const [s, sh] = await Promise.all([
        backend.stashList({ path }),
        backend.shelfList({ path }),
      ]);
      stashes.value = s;
      shelves.value = sh;
      if (showDeleted.value) {
        deletedShelves.value = await backend.shelfListDeleted({ path });
      } else {
        deletedShelves.value = [];
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  function stashRefOf(entry: StashEntry) {
    return `stash@{${entry.index}}`;
  }

  async function createStash(message: string, includeUntracked = false) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    await getBackend().stashCreate({
      path: workspace.repoPath,
      message,
      includeUntracked,
    });
    toast({ title: "Stash created" });
    await refresh();
  }

  async function applyStash(stashRef: string, reinstateIndex = false) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    await getBackend().stashApply({
      path: workspace.repoPath,
      stashRef,
      reinstateIndex,
    });
    toast({ title: "Stash applied", description: stashRef });
    await refresh();
  }

  async function popStash(stashRef: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    await getBackend().stashPop({ path: workspace.repoPath, stashRef });
    toast({ title: "Stash popped", description: stashRef });
    await refresh();
  }

  async function dropStash(stashRef: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    await getBackend().stashDrop({ path: workspace.repoPath, stashRef });
    toast({ title: "Stash dropped", description: stashRef });
    await refresh();
  }

  async function clearStashes() {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    await getBackend().stashClear({ path: workspace.repoPath });
    toast({ title: "Stashes cleared" });
    await refresh();
  }

  async function unshelve(id: string, removeApplied = true) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    const result = await getBackend().shelfUnshelve({
      path: workspace.repoPath,
      id,
      removeApplied,
    });
    toast({
      title: "Unshelved",
      description: `${result.applied.length} applied, ${result.failed.length} failed`,
    });
    await refresh();
  }

  async function deleteShelf(id: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    await getBackend().shelfDelete({ path: workspace.repoPath, id });
    toast({ title: "Shelf deleted" });
    await refresh();
  }

  async function renameShelf(id: string, message: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    await getBackend().shelfRename({ path: workspace.repoPath, id, message });
    await refresh();
  }

  return {
    stashes,
    shelves,
    deletedShelves,
    loading,
    error,
    selectedStashRef,
    selectedShelfId,
    showDeleted,
    combineTab,
    refresh,
    stashRefOf,
    createStash,
    applyStash,
    popStash,
    dropStash,
    clearStashes,
    unshelve,
    deleteShelf,
    renameShelf,
  };
});
