import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { FileChange, StatusSnapshot } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";

export type ChangesSection = "staged" | "unstaged" | "unversioned";

function isStaged(f: FileChange): boolean {
  return f.indexStatus !== "." && f.indexStatus !== "?" && f.indexStatus !== "!";
}

function isUntracked(f: FileChange): boolean {
  return f.kind === "untracked" || f.indexStatus === "?";
}

function isUnstaged(f: FileChange): boolean {
  if (isUntracked(f)) return false;
  return f.worktreeStatus !== "." && f.worktreeStatus !== "?" && f.worktreeStatus !== "!";
}

export const useChangesStore = defineStore("changes", () => {
  const snapshot = ref<StatusSnapshot | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const selectedPaths = ref<string[]>([]);
  const selectedSection = ref<ChangesSection | null>(null);
  const localVersion = ref(0);

  const staged = computed(() => snapshot.value?.files.filter(isStaged) ?? []);
  const unstaged = computed(() => snapshot.value?.files.filter(isUnstaged) ?? []);
  const unversioned = computed(() => snapshot.value?.files.filter(isUntracked) ?? []);

  async function refresh() {
    const workspace = useWorkspaceStore();
    const path = workspace.repoPath;
    const id = workspace.repoId;
    if (!path || !id || !workspace.isRepo) {
      snapshot.value = null;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const backend = getBackend();
      const next = await backend.statusGet({ repoId: id, path });
      if (next.version < localVersion.value) return;
      localVersion.value = next.version;
      snapshot.value = next;
      workspace.setBranch(next.branch);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  function select(path: string, section: ChangesSection, multi = false) {
    selectedSection.value = section;
    if (multi) {
      if (selectedPaths.value.includes(path)) {
        selectedPaths.value = selectedPaths.value.filter((p) => p !== path);
      } else {
        selectedPaths.value = [...selectedPaths.value, path];
      }
    } else {
      selectedPaths.value = [path];
    }
  }

  function clearSelection() {
    selectedPaths.value = [];
    selectedSection.value = null;
  }

  async function stage(paths: string[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    const backend = getBackend();
    await backend.stagePaths({
      repoId: workspace.repoId,
      path: workspace.repoPath,
      paths,
    });
    await refresh();
  }

  async function unstage(paths: string[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    const backend = getBackend();
    await backend.unstagePaths({
      repoId: workspace.repoId,
      path: workspace.repoPath,
      paths,
    });
    await refresh();
  }

  async function add(paths: string[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId) return;
    const backend = getBackend();
    await backend.addPaths({
      repoId: workspace.repoId,
      path: workspace.repoPath,
      paths,
      force: false,
    });
    await refresh();
  }

  return {
    snapshot,
    loading,
    error,
    selectedPaths,
    selectedSection,
    staged,
    unstaged,
    unversioned,
    refresh,
    select,
    clearSelection,
    stage,
    unstage,
    add,
  };
});
