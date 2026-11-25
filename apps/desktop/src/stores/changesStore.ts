import { defineStore } from "pinia";
import { computed, ref, shallowRef, watch } from "vue";
import { getBackend } from "@/lib/backend";
import type {
  ChangelistCommitFile,
  ChangelistFileState,
  ChangelistsState,
  FileChange,
  StatusSnapshot,
} from "@/lib/backend";
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

function sameStatusFiles(a: StatusSnapshot, b: StatusSnapshot): boolean {
  if (a.repoId !== b.repoId) return false;
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
  const leftFiles = a.partialFiles ?? [];
  const rightFiles = b.partialFiles ?? [];
  if (
    leftFiles.length !== rightFiles.length ||
    leftFiles.some(
      (file, i) =>
        file.path !== rightFiles[i]!.path ||
        file.contentToken !== rightFiles[i]!.contentToken ||
        file.problem !== rightFiles[i]!.problem,
    ) ||
    JSON.stringify(a.warnings ?? []) !== JSON.stringify(b.warnings ?? [])
  )
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
      if (JSON.stringify(leftHunks[h]) !== JSON.stringify(rightHunks[h])) return false;
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
  const checkedSelections = shallowRef<Record<string, ChangelistCommitFile>>({});
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
      checkedSelections.value = {};
      loading.value = false;
      error.value = null;
    },
    { flush: "sync" },
  );

  const stagingMode = computed(() => useSettingsStore().settings?.stagingMode ?? false);
  const showIgnoredFiles = computed(() => useSettingsStore().settings?.showIgnoredFiles ?? false);

  // A refs-only refresh can update branch metadata while sharing the same files.
  // Depend on that stable array so classification and expanded trees stay cached.
  const files = computed(() => snapshot.value?.files ?? []);
  const staged = computed(() => files.value.filter(isStaged));
  const unstaged = computed(() => files.value.filter(isUnstaged));
  const unversioned = computed(() =>
    files.value.filter(
      (file) =>
        isUntracked(file) && (stagingMode.value || !partialFilesByPath.value.has(file.path)),
    ),
  );
  const ignored = computed(() => files.value.filter(isIgnored));
  const changed = computed(() => files.value.filter(isChanged));

  const activeListId = computed(() => {
    const lists = changelists.value?.lists ?? [];
    return lists.find((l) => l.active)?.id ?? lists[0]?.id ?? "default";
  });

  const assignmentByPath = computed(() => {
    const map = new Map<string, string>();
    for (const assignment of changelists.value?.assignments ?? []) {
      if (!assignment.hunkRanges?.length) map.set(assignment.path, assignment.listId);
    }
    return map;
  });

  const checkedSet = computed(() => new Set(checkedPaths.value));
  const partialFilesByPath = computed(() => {
    const map = new Map<string, ChangelistFileState>(
      (changelists.value?.partialFiles ?? []).map((file) => [file.path, file]),
    );
    // Metadata writes return before the derived preview is refreshed. Keep a
    // conservative partial marker during that interval (and on read failure).
    for (const assignment of changelists.value?.assignments ?? []) {
      if (assignment.hunkRanges?.length && !map.has(assignment.path))
        map.set(assignment.path, {
          path: assignment.path,
          contentToken: "",
          hunks: [],
          previewHunks: [],
          problem: "Refresh and review block ownership before committing.",
        });
    }
    return map;
  });
  function partialForPath(path: string) {
    return partialFilesByPath.value.get(path);
  }
  function listIdsForPath(path: string): string[] {
    const partial = partialForPath(path);
    if (partial) {
      const ids = partial.hunks.map((hunk) => hunk.listId);
      if (!ids.length)
        ids.push(
          ...(changelists.value?.assignments ?? [])
            .filter((a) => a.path === path)
            .map((a) => a.listId),
        );
      return [...new Set(ids.length ? ids : [activeListId.value])];
    }
    return [listIdForPath(path)];
  }
  function isChecked(path: string, section?: ChangesSection): boolean {
    if (!checkedSet.value.has(path)) return false;
    const selection = checkedSelections.value[path];
    return (
      !selection ||
      !section?.startsWith("changelist:") ||
      selection.listIds.includes(section.slice(11))
    );
  }
  function commitSelection(paths: string[], section?: ChangesSection): ChangelistCommitFile[] {
    return paths.map((path) => {
      const partial = partialForPath(path);
      return {
        path,
        listIds: section?.startsWith("changelist:") ? [section.slice(11)] : listIdsForPath(path),
        ...(partial ? { expectedToken: partial.contentToken } : {}),
      };
    });
  }
  function checkedCommitSelection(): ChangelistCommitFile[] {
    return checkedPaths.value.map((path) => {
      const file = checkedSelections.value[path] ?? commitSelection([path])[0]!;
      return { ...file, listIds: [...file.listIds] };
    });
  }

  function listIdForPath(path: string): string {
    return assignmentByPath.value.get(path) ?? activeListId.value;
  }

  const filesByList = computed(() => {
    const groups = new Map<string, FileChange[]>();
    for (const file of files.value.filter(
      (file) => isChanged(file) || (isUntracked(file) && partialFilesByPath.value.has(file.path)),
    )) {
      for (const id of listIdsForPath(file.path)) {
        let files = groups.get(id);
        if (!files) groups.set(id, (files = []));
        files.push(file);
      }
    }
    return groups;
  });

  function filesForChangelist(listId: string): FileChange[] {
    return filesByList.value.get(listId) ?? [];
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

  type CheckState = "none" | "all" | "partial";
  // Header rendering and scrolling read cached summaries. Only new status,
  // assignments or a changed selection can invalidate them.
  const sectionChecks = computed(() => {
    const states = new Map<ChangesSection, CheckState>();
    const checked = checkedSet.value;
    if (!checked.size) return states;
    function summarize(section: ChangesSection, files: FileChange[]) {
      if (!files.length) return;
      const first = isChecked(files[0]!.path, section);
      const mixed = files.some((file) => isChecked(file.path, section) !== first);
      states.set(section, mixed ? "partial" : first ? "all" : "none");
    }
    for (const [id, files] of filesByList.value) summarize(`changelist:${id}`, files);
    summarize("unversioned", unversioned.value);
    summarize("staged", staged.value);
    summarize("unstaged", unstaged.value);
    return states;
  });

  function checkStateForSection(section: ChangesSection): CheckState {
    return sectionChecks.value.get(section) ?? "none";
  }

  function toggleCheckSection(section: ChangesSection) {
    const paths = pathsForSection(section);
    if (!paths.length) return;
    const state = checkStateForSection(section);
    setCheckedInSection(paths, section, state !== "all");
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
        if (!stagingMode.value && result.assignments.some((item) => item.hunkRanges?.length)) {
          // A successful write stays successful even if its derived read fails.
          try {
            const resolved = await getBackend().changelistList({ path });
            if (current() && !stagingMode.value) changelists.value = resolved;
          } catch (e) {
            if (current()) error.value = formatErrorMessage(e);
          }
        }
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
      const previous = snapshot.value;
      if (previous && sameStatusFiles(previous, next)) {
        if (!sameBranch(previous.branch, next.branch)) {
          snapshot.value = { ...next, files: previous.files };
        }
      } else {
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
        const selections = { ...checkedSelections.value };
        let pruned = false;
        const kept = checkedPaths.value.filter((path) => {
          if (!known.has(path)) {
            delete selections[path];
            return false;
          }
          const selection = selections[path];
          if (!selection || !changelists.value || stagingMode.value) return true;
          const available = new Set(listIdsForPath(path));
          const listIds = selection.listIds.filter((id) => available.has(id));
          if (listIds.length === selection.listIds.length) return true;
          pruned = true;
          if (!listIds.length) {
            delete selections[path];
            return false;
          }
          selections[path] = { ...selection, listIds };
          return true;
        });
        if (pruned || kept.length !== checkedPaths.value.length) {
          checkedPaths.value = kept;
          checkedSelections.value = selections;
        }
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

  function toggleChecked(path: string, section?: ChangesSection) {
    setCheckedInSection([path], section, !isChecked(path, section));
  }

  function setChecked(paths: string[], section?: ChangesSection) {
    checkedPaths.value = [...paths];
    checkedSelections.value = Object.fromEntries(
      commitSelection(paths, section).map((file) => [file.path, file]),
    );
  }

  function setCheckedInSection(
    paths: string[],
    section: ChangesSection | undefined,
    checked: boolean,
  ) {
    const next = new Set(checkedPaths.value);
    const selections = { ...checkedSelections.value };
    for (const path of paths) {
      if (section?.startsWith("changelist:")) {
        const id = section.slice(11);
        const ids = new Set(
          next.has(path) ? (selections[path]?.listIds ?? listIdsForPath(path)) : [],
        );
        if (checked) ids.add(id);
        else ids.delete(id);
        // Adding/removing a list must not renew the token of an older check.
        if (ids.size) {
          next.add(path);
          selections[path] = {
            ...(selections[path] ?? commitSelection([path], section)[0]!),
            listIds: [...ids],
          };
        } else {
          next.delete(path);
          delete selections[path];
        }
      } else if (checked) {
        next.add(path);
        selections[path] = commitSelection([path], section)[0]!;
      } else {
        next.delete(path);
        delete selections[path];
      }
    }
    checkedPaths.value = [...next];
    checkedSelections.value = selections;
  }

  function checkAllInList(listId: string) {
    const paths = filesForChangelist(listId).map((f) => f.path);
    setCheckedInSection(paths, `changelist:${listId}`, true);
  }

  function uncheckAllInList(listId: string) {
    setCheckedInSection(
      filesForChangelist(listId).map((f) => f.path),
      `changelist:${listId}`,
      false,
    );
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
    checkedSelections,
    isChecked,
    partialForPath,
    listIdsForPath,
    commitSelection,
    checkedCommitSelection,
    setCheckedInSection,
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
