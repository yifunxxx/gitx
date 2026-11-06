import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { ChangelistsState, FileChange } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useSettingsStore } from "./settingsStore";
import { formatErrorMessage } from "@/lib/errors";

export type ChangesSection =
  | "staged"
  | "unstaged"
  | "unversioned"
  | "ignored"
  | `changelist:${string}`;

function isIgnored(f: FileChange): boolean {
  return f.kind === "ignored" || f.indexStatus === "!";
}

function isStaged(f: FileChange): boolean {
  if (isIgnored(f)) return false;
  return f.indexStatus !== "." && f.indexStatus !== "?" && f.indexStatus !== "!";
}

function isUntracked(f: FileChange): boolean {
  if (isIgnored(f)) return false;
  return f.kind === "untracked" || f.indexStatus === "?";
}

function isUnstaged(f: FileChange): boolean {
  if (isUntracked(f) || isIgnored(f)) return false;
  return f.worktreeStatus !== "." && f.worktreeStatus !== "?" && f.worktreeStatus !== "!";
}

/** Tracked local changes (staged and/or unstaged), excluding unversioned/ignored. */
function isChanged(f: FileChange): boolean {
  return isStaged(f) || isUnstaged(f);
}

export const useChangesStore = defineStore("changes", () => {
  const snapshot = ref<import("@/lib/backend").StatusSnapshot | null>(null);
  const changelists = ref<ChangelistsState | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const selectedPaths = ref<string[]>([]);
  const selectedSection = ref<ChangesSection | null>(null);
  /** Paths checked for changelist-mode commit. */
  const checkedPaths = ref<string[]>([]);
  const localVersion = ref(0);

  const stagingMode = computed(() => useSettingsStore().settings?.stagingMode ?? false);
  const showIgnoredFiles = computed(
    () => useSettingsStore().settings?.showIgnoredFiles ?? false,
  );

  const staged = computed(() => snapshot.value?.files.filter(isStaged) ?? []);
  const unstaged = computed(() => snapshot.value?.files.filter(isUnstaged) ?? []);
  const unversioned = computed(() => snapshot.value?.files.filter(isUntracked) ?? []);
  const ignored = computed(() => snapshot.value?.files.filter(isIgnored) ?? []);
  const changed = computed(() => snapshot.value?.files.filter(isChanged) ?? []);

  const activeListId = computed(() => {
    const lists = changelists.value?.lists ?? [];
    return lists.find((l) => l.active)?.id ?? lists[0]?.id ?? "default";
  });

  function listIdForPath(path: string): string {
    const assignment = changelists.value?.assignments.find((a) => a.path === path);
    return assignment?.listId ?? activeListId.value;
  }

  function filesForChangelist(listId: string): FileChange[] {
    return changed.value.filter((f) => listIdForPath(f.path) === listId);
  }

  async function refreshChangelists() {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.isRepo || stagingMode.value) {
      changelists.value = null;
      return;
    }
    try {
      const backend = getBackend();
      changelists.value = await backend.changelistList({ path: workspace.repoPath });
    } catch (e) {
      error.value = formatErrorMessage(e);
    }
  }

  async function refresh() {
    const workspace = useWorkspaceStore();
    const settings = useSettingsStore();
    if (!settings.settings) {
      try {
        await settings.load();
      } catch {
        /* keep going with defaults */
      }
    }
    const path = workspace.repoPath;
    const id = workspace.repoId;
    if (!path || !id || !workspace.isRepo) {
      snapshot.value = null;
      changelists.value = null;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const backend = getBackend();
      const includeIgnored = showIgnoredFiles.value;
      const next = await backend.statusGet({ repoId: id, path, includeIgnored });
      if (next.version < localVersion.value) return;
      localVersion.value = next.version;
      snapshot.value = next;
      workspace.setBranch(next.branch);
      if (!stagingMode.value) {
        await refreshChangelists();
      } else {
        changelists.value = null;
      }
      // Drop checks that no longer exist
      const known = new Set(next.files.map((f) => f.path));
      checkedPaths.value = checkedPaths.value.filter((p) => known.has(p));
    } catch (e) {
      error.value = formatErrorMessage(e);
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

  function toggleChecked(path: string) {
    if (checkedPaths.value.includes(path)) {
      checkedPaths.value = checkedPaths.value.filter((p) => p !== path);
    } else {
      checkedPaths.value = [...checkedPaths.value, path];
    }
  }

  function setChecked(paths: string[]) {
    checkedPaths.value = [...paths];
  }

  function checkAllInList(listId: string) {
    const paths = filesForChangelist(listId).map((f) => f.path);
    const set = new Set(checkedPaths.value);
    for (const p of paths) set.add(p);
    checkedPaths.value = [...set];
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

  async function ignore(paths: string[], ignoreFile = ".gitignore") {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    const backend = getBackend();
    const patterns = await backend.ignoreSuggestPatterns({
      path: workspace.repoPath,
      files: paths,
    });
    await backend.ignoreAdd({
      path: workspace.repoPath,
      ignoreFile,
      patterns,
    });
    await refresh();
  }

  async function rmCached(paths: string[], addToGitignore = false) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    const backend = getBackend();
    await backend.rmCached({
      path: workspace.repoPath,
      paths,
      addToGitignore,
    });
    await refresh();
  }

  async function moveToChangelist(paths: string[], targetListId: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !paths.length) return;
    const backend = getBackend();
    changelists.value = await backend.changelistMove({
      path: workspace.repoPath,
      paths,
      targetListId,
    });
  }

  async function createChangelist(name: string, setActive = true) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !name.trim()) return null;
    const backend = getBackend();
    changelists.value = await backend.changelistCreate({
      path: workspace.repoPath,
      name: name.trim(),
      comment: "",
      setActive,
    });
    return changelists.value;
  }

  async function setActiveChangelist(id: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    const backend = getBackend();
    changelists.value = await backend.changelistSetActive({
      path: workspace.repoPath,
      id,
    });
  }

  async function toggleShowIgnored() {
    const settings = useSettingsStore();
    if (!settings.settings) await settings.load();
    if (!settings.settings) return;
    await settings.save({
      ...settings.settings,
      showIgnoredFiles: !settings.settings.showIgnoredFiles,
    });
    await refresh();
  }

  return {
    snapshot,
    changelists,
    loading,
    error,
    selectedPaths,
    selectedSection,
    checkedPaths,
    stagingMode,
    showIgnoredFiles,
    staged,
    unstaged,
    unversioned,
    ignored,
    changed,
    activeListId,
    listIdForPath,
    filesForChangelist,
    refresh,
    refreshChangelists,
    select,
    clearSelection,
    toggleChecked,
    setChecked,
    checkAllInList,
    stage,
    unstage,
    add,
    ignore,
    rmCached,
    moveToChangelist,
    createChangelist,
    setActiveChangelist,
    toggleShowIgnored,
  };
});
