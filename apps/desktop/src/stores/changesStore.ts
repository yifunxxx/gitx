import { defineStore } from "pinia";
import { computed, ref, shallowRef, watch } from "vue";
import { getBackend } from "@/lib/backend";
import type { ChangelistsState, FileChange, StatusSnapshot } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useSettingsStore } from "./settingsStore";
import { formatErrorMessage } from "@/lib/errors";

function sameBranch(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => left[key] === right[key]);
}

function sameStatusSnapshot(a: StatusSnapshot | null, b: StatusSnapshot): boolean {
  if (!a || a.repoId !== b.repoId || !sameBranch(a.branch, b.branch)) return false;
  if (a.files.length !== b.files.length) return false;
  for (let i = 0; i < a.files.length; i++) {
    const left = a.files[i]!;
    const right = b.files[i]!;
    if (
      left.path !== right.path ||
      left.origPath !== right.origPath ||
      left.indexStatus !== right.indexStatus ||
      left.worktreeStatus !== right.worktreeStatus ||
      left.kind !== right.kind
    ) {
      return false;
    }
  }
  return true;
}

function sameChangelists(a: ChangelistsState | null, b: ChangelistsState): boolean {
  if (a === b) return true;
  if (!a || a.lists.length !== b.lists.length || a.assignments.length !== b.assignments.length)
    return false;
  for (let i = 0; i < a.lists.length; i++) {
    const left = a.lists[i]!;
    const right = b.lists[i]!;
    if (
      left.id !== right.id ||
      left.name !== right.name ||
      left.comment !== right.comment ||
      left.active !== right.active
    ) {
      return false;
    }
  }
  for (let i = 0; i < a.assignments.length; i++) {
    const left = a.assignments[i]!;
    const right = b.assignments[i]!;
    if (left.path !== right.path || left.listId !== right.listId) return false;
    const leftHunks = left.hunkRanges ?? [];
    const rightHunks = right.hunkRanges ?? [];
    if (leftHunks.length !== rightHunks.length) return false;
    for (let h = 0; h < leftHunks.length; h++) {
      if (leftHunks[h] !== rightHunks[h]) return false;
    }
  }
  return true;
}

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
  // Shallow: large status/assignment payloads must not be deep-proxied or
  // trigger full tree rebuilds when background refreshes return identical data.
  const snapshot = shallowRef<StatusSnapshot | null>(null);
  const changelists = shallowRef<ChangelistsState | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const selectedPaths = ref<string[]>([]);
  const selectedSection = ref<ChangesSection | null>(null);
  /** Paths checked for changelist-mode commit. */
  const checkedPaths = ref<string[]>([]);
  const localVersion = ref(0);
  /** Monotonic generation — drop stale refresh results. */
  let refreshGen = 0;
  let repositoryGeneration = 0;
  let changelistRequest = 0;
  let changelistWrites = 0;
  let changelistQueue: Promise<unknown> = Promise.resolve();
  const workspace = useWorkspaceStore();
  function currentRepository() {
    const path = workspace.repoPath;
    const navigation = workspace.navigationToken();
    return () => workspace.repoPath === path && workspace.navigationToken() === navigation;
  }
  watch(
    () => workspace.repoPath,
    () => {
      ++refreshGen;
      ++repositoryGeneration;
      ++changelistRequest;
      changelistWrites = 0;
      changelistQueue = Promise.resolve();
      localVersion.value = 0;
      snapshot.value = null;
      changelists.value = null;
      selectedPaths.value = [];
      selectedSection.value = null;
      checkedPaths.value = [];
      loading.value = false;
      error.value = null;
    },
    { flush: "sync" },
  );

  const stagingMode = computed(() => useSettingsStore().settings?.stagingMode ?? false);
  const showIgnoredFiles = computed(() => useSettingsStore().settings?.showIgnoredFiles ?? false);

  const staged = computed(() => snapshot.value?.files.filter(isStaged) ?? []);
  const unstaged = computed(() => snapshot.value?.files.filter(isUnstaged) ?? []);
  const unversioned = computed(() => snapshot.value?.files.filter(isUntracked) ?? []);
  const ignored = computed(() => snapshot.value?.files.filter(isIgnored) ?? []);
  const changed = computed(() => snapshot.value?.files.filter(isChanged) ?? []);

  const activeListId = computed(() => {
    const lists = changelists.value?.lists ?? [];
    return lists.find((l) => l.active)?.id ?? lists[0]?.id ?? "default";
  });

  const assignmentByPath = computed(() => {
    const map = new Map<string, string>();
    for (const assignment of changelists.value?.assignments ?? []) {
      map.set(assignment.path, assignment.listId);
    }
    return map;
  });

  const checkedSet = computed(() => new Set(checkedPaths.value));

  function listIdForPath(path: string): string {
    return assignmentByPath.value.get(path) ?? activeListId.value;
  }

  function filesForChangelist(listId: string): FileChange[] {
    const active = activeListId.value;
    const map = assignmentByPath.value;
    return changed.value.filter((f) => (map.get(f.path) ?? active) === listId);
  }

  /** Paths that show checkboxes in a Changes section (changelist mode). */
  function pathsForSection(section: ChangesSection): string[] {
    if (section === "ignored") return [];
    if (section === "unversioned") return unversioned.value.map((f) => f.path);
    if (section === "staged") return staged.value.map((f) => f.path);
    if (section === "unstaged") return unstaged.value.map((f) => f.path);
    if (section.startsWith("changelist:")) {
      return filesForChangelist(section.slice("changelist:".length)).map((f) => f.path);
    }
    return [];
  }

  function checkStateForSection(section: ChangesSection): "none" | "all" | "partial" {
    const paths = pathsForSection(section);
    if (!paths.length) return "none";
    const set = checkedSet.value;
    let n = 0;
    for (const p of paths) if (set.has(p)) n += 1;
    if (n === 0) return "none";
    if (n === paths.length) return "all";
    return "partial";
  }

  function toggleCheckSection(section: ChangesSection) {
    const paths = pathsForSection(section);
    if (!paths.length) return;
    const state = checkStateForSection(section);
    const set = new Set(checkedPaths.value);
    if (state === "all") {
      for (const p of paths) set.delete(p);
    } else {
      for (const p of paths) set.add(p);
    }
    checkedPaths.value = [...set];
  }

  async function refreshChangelists() {
    const workspace = useWorkspaceStore();
    const request = ++changelistRequest;
    if (!workspace.repoPath || !workspace.isRepo || stagingMode.value) {
      changelists.value = null;
      return;
    }
    if (changelistWrites) return;
    const path = workspace.repoPath;
    const generation = repositoryGeneration;
    const isCurrentRepository = currentRepository();
    const current = () =>
      generation === repositoryGeneration &&
      request === changelistRequest &&
      !stagingMode.value &&
      isCurrentRepository();
    try {
      const backend = getBackend();
      const result = await backend.changelistList({ path });
      if (current() && !sameChangelists(changelists.value, result)) changelists.value = result;
    } catch (e) {
      if (current()) error.value = formatErrorMessage(e);
    }
  }

  function mutateChangelists(operation: (path: string) => Promise<ChangelistsState>) {
    const path = workspace.repoPath;
    if (!path) return Promise.resolve(null);
    const generation = repositoryGeneration;
    const isCurrentRepository = currentRepository();
    const current = () => generation === repositoryGeneration && isCurrentRepository();
    ++changelistRequest;
    ++changelistWrites;
    const task = changelistQueue.then(async () => {
      try {
        if (!current()) return null;
        const result = await operation(path);
        if (!current()) return null;
        ++changelistRequest;
        if (!stagingMode.value) changelists.value = result;
        error.value = null;
        return result;
      } catch (e) {
        if (current()) error.value = formatErrorMessage(e);
        return null;
      } finally {
        if (generation === repositoryGeneration) --changelistWrites;
      }
    });
    changelistQueue = task;
    return task;
  }

  async function refresh(background = false) {
    const settings = useSettingsStore();
    const path = workspace.repoPath;
    const id = workspace.repoId;
    const gen = ++refreshGen;
    const isCurrentRepository = currentRepository();
    const current = () => gen === refreshGen && isCurrentRepository();
    if (!path || !id || !workspace.isRepo) {
      loading.value = false;
      snapshot.value = null;
      changelists.value = null;
      return;
    }
    loading.value = !background || !snapshot.value;
    error.value = null;
    try {
      if (!settings.settings) {
        try {
          await settings.load();
        } catch {
          /* keep going with defaults */
        }
      }
      if (!current()) return;
      const backend = getBackend();
      const includeIgnored = showIgnoredFiles.value;
      const next = await backend.statusGet({ repoId: id, path, includeIgnored });
      if (!current()) return;
      if (next.version < localVersion.value) return;
      localVersion.value = next.version;
      if (!sameStatusSnapshot(snapshot.value, next)) {
        snapshot.value = next;
      }
      workspace.setBranch(next.branch);
      if (!stagingMode.value) {
        await refreshChangelists();
        if (!current()) return;
      } else if (changelists.value !== null) {
        changelists.value = null;
      }
      // Drop checks that no longer exist.
      if (checkedPaths.value.length) {
        const known = new Set(next.files.map((f) => f.path));
        const kept = checkedPaths.value.filter((p) => known.has(p));
        if (kept.length !== checkedPaths.value.length) checkedPaths.value = kept;
      }
    } catch (e) {
      if (current()) error.value = formatErrorMessage(e);
    } finally {
      if (gen === refreshGen) loading.value = false;
    }
  }

  function select(path: string, section: ChangesSection, multi = false) {
    // A selection has one section; paths from another section are different rows,
    // even when the same file has both staged and unstaged changes.
    const extend = multi && selectedSection.value === section;
    selectedSection.value = section;
    if (extend) {
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

  function uncheckAllInList(listId: string) {
    const drop = new Set(filesForChangelist(listId).map((f) => f.path));
    checkedPaths.value = checkedPaths.value.filter((p) => !drop.has(p));
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
    const path = workspace.repoPath;
    if (!path) return;
    const current = currentRepository();
    const backend = getBackend();
    const patterns = await backend.ignoreSuggestPatterns({ path, files: [...paths] });
    if (!current()) return;
    await backend.ignoreAdd({ path, ignoreFile, patterns });
    if (current()) await refresh();
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
    if (!paths.length) return null;
    const backend = getBackend();
    const selected = [...paths];
    return mutateChangelists((path) =>
      backend.changelistMove({
        path,
        paths: selected,
        targetListId,
      }),
    );
  }

  async function createChangelist(name: string, setActive = true) {
    if (!name.trim()) return null;
    const backend = getBackend();
    return mutateChangelists((path) =>
      backend.changelistCreate({
        path,
        name: name.trim(),
        comment: "",
        setActive,
      }),
    );
  }

  async function deleteChangelist(id: string, moveTo: string | null = null) {
    if (!id || id === "default") return null;
    const backend = getBackend();
    return mutateChangelists((path) =>
      backend.changelistDelete({
        path,
        id,
        moveTo,
      }),
    );
  }

  async function setActiveChangelist(id: string) {
    const backend = getBackend();
    return mutateChangelists((path) =>
      backend.changelistSetActive({
        path,
        id,
      }),
    );
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
    pathsForSection,
    checkStateForSection,
    toggleCheckSection,
    refresh,
    refreshChangelists,
    select,
    clearSelection,
    toggleChecked,
    setChecked,
    checkAllInList,
    uncheckAllInList,
    stage,
    unstage,
    add,
    ignore,
    rmCached,
    moveToChangelist,
    createChangelist,
    deleteChangelist,
    setActiveChangelist,
    toggleShowIgnored,
  };
});
