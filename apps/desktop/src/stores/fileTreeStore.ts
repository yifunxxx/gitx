import { defineStore } from "pinia";
import { computed, markRaw, reactive, ref, watch } from "vue";
import { getBackend, type FsEntry } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";
import { useWorkspaceStore } from "./workspaceStore";
import { useSettingsStore } from "./settingsStore";

type Directory = {
  // Keep the last successful snapshot while a stale directory is re-read.
  entries: readonly FsEntry[] | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
  revision: number;
};
export type FileTreeRow = FsEntry & {
  key: string;
  depth: number;
  expanded: boolean;
  loading: boolean;
  error: string | null;
  /** Original directory at the start of a compact chain. */
  compactRoot?: string;
};

export const useFileTreeStore = defineStore("fileTree", () => {
  const workspace = useWorkspaceStore();
  const settings = useSettingsStore();
  const directories = reactive(new Map<string, Directory>());
  const expanded = reactive(new Set<string>());
  const selectedPath = ref<string | null>(null);
  const selectedPaths = ref<string[]>([]);
  let selectionAnchor: string | null = null;
  const filter = ref("");
  const initialized = ref(false);
  const pending = new Map<string, Promise<void>>();
  let generation = 0;

  function directory(path: string) {
    let value = directories.get(path);
    if (!value) {
      directories.set(path, {
        entries: null,
        stale: true,
        loading: false,
        error: null,
        revision: 0,
      });
      value = directories.get(path)!;
    }
    return value;
  }

  // Only descend into expanded directories. Cached collapsed children do not
  // participate in row construction or filtering.
  const visibleRows = computed(() => {
    const result: FileTreeRow[] = [];
    function visit(path: string, depth: number) {
      for (const original of directories.get(path)?.entries ?? []) {
        let entry = original;
        let name = entry.name;
        const compactStates: Directory[] | null = entry.kind === "directory" ? [] : null;
        // Compact only directories loaded through normal expansion. Rendering
        // never starts a recursive scan of unopened project subtrees.
        if (settings.settings?.compactFileTree && entry.kind === "directory") {
          for (let count = 0; count < 256; count++) {
            const childState = directories.get(entry.path);
            const child = childState?.entries?.[0];
            if (
              childState?.entries?.length !== 1 ||
              child?.kind !== "directory" ||
              !expanded.has(entry.path)
            )
              break;
            compactStates!.push(childState);
            name += `/${child.name}`;
            entry = child;
          }
        }
        if (compactStates) {
          const state = directories.get(entry.path);
          if (state) compactStates.push(state);
        }
        const open = entry.kind === "directory" && expanded.has(entry.path);
        const row: FileTreeRow = {
          ...entry,
          name,
          compactRoot: original.path !== entry.path ? original.path : undefined,
          key: `${entry.kind}:${entry.path}`,
          depth,
          expanded: open,
          loading: false,
          error: null,
        };
        // Read transient state in the row consumer, not in the full-tree
        // computed. Files need no state closures; compact directory rows also
        // expose loading/errors of their hidden parents.
        if (compactStates)
          Object.defineProperties(row, {
            loading: { get: () => compactStates.some((directory) => directory.loading) },
            error: { get: () => compactStates.find((directory) => directory.error)?.error ?? null },
          });
        result.push(row);
        if (open) visit(entry.path, depth + 1);
      }
    }
    visit("", 0);
    return result;
  });
  const rows = computed(() => {
    const query = filter.value.trim().toLocaleLowerCase();
    if (!query) return visibleRows.value;
    const included = new Set<string>();
    for (const row of visibleRows.value) {
      if (!row.name.toLocaleLowerCase().includes(query)) continue;
      included.add(row.path);
      let parent = row.path;
      while (parent.includes("/")) {
        parent = parent.slice(0, parent.lastIndexOf("/"));
        included.add(parent);
      }
    }
    return visibleRows.value.filter((row) => included.has(row.path));
  });
  const loading = computed(() => !!directories.get("")?.loading);
  const error = computed(() => directories.get("")?.error ?? null);

  function select(path: string, options: { toggle?: boolean; range?: boolean } = {}) {
    const paths = rows.value.map((row) => row.path);
    if (!paths.includes(path)) return;
    if (options.range && selectionAnchor && paths.includes(selectionAnchor)) {
      const a = paths.indexOf(selectionAnchor),
        b = paths.indexOf(path);
      const range = paths.slice(Math.min(a, b), Math.max(a, b) + 1);
      selectedPaths.value = options.toggle
        ? [...new Set([...selectedPaths.value, ...range])]
        : range;
    } else if (options.toggle) {
      selectedPaths.value = selectedPaths.value.includes(path)
        ? selectedPaths.value.filter((item) => item !== path)
        : [...selectedPaths.value, path];
      selectionAnchor = path;
    } else {
      selectedPaths.value = [path];
      selectionAnchor = path;
    }
    selectedPath.value = path;
  }
  function selectAll() {
    selectedPaths.value = rows.value.map((row) => row.path);
    selectedPath.value = selectedPaths.value[0] ?? null;
    selectionAnchor = selectedPath.value;
  }
  // Hidden or vanished rows cannot remain accidental batch-operation targets.
  watch(
    rows,
    (visible, previous) => {
      if (!selectedPaths.value.length && !selectedPath.value && !selectionAnchor) return;
      const paths = new Set(visible.map((row) => row.path));
      // Compaction replaces a directory row with its only descendant directory.
      // Preserve that visible representation, but never substitute an unrelated
      // ancestor for a filtered/deleted row or restore a deselected focus.
      const aliases = new Map<string, string>();
      let previousDirectories: Set<string> | undefined;
      for (const row of visible) {
        if (!row.compactRoot) continue;
        previousDirectories ??= new Set(
          previous?.filter((item) => item.kind === "directory").map((item) => item.path),
        );
        for (
          let end = row.path.lastIndexOf("/");
          end >= row.compactRoot.length;
          end = row.path.lastIndexOf("/", end - 1)
        ) {
          const parent = row.path.slice(0, end);
          if (previousDirectories.has(parent)) aliases.set(parent, row.path);
        }
      }
      const resolve = (path: string | null) =>
        path === null ? null : paths.has(path) ? path : (aliases.get(path) ?? null);
      const kept = [
        ...new Set(
          selectedPaths.value.map(resolve).filter((path): path is string => path !== null),
        ),
      ];
      if (
        kept.length !== selectedPaths.value.length ||
        kept.some((path, index) => path !== selectedPaths.value[index])
      )
        selectedPaths.value = kept;
      // Focus may intentionally be unselected after Ctrl+click, but it and the
      // range anchor must not outlive their visible row or silently target row 0.
      if (selectedPath.value) selectedPath.value = resolve(selectedPath.value) ?? kept[0] ?? null;
      if (selectionAnchor) selectionAnchor = resolve(selectionAnchor) ?? selectedPath.value;
    },
    { flush: "sync" },
  );

  async function loadDir(path: string): Promise<void> {
    const folderPath = workspace.folderPath;
    if (!folderPath) return;
    const queued = pending.get(path);
    if (queued) return queued;
    const state = directory(path);
    if (!state.stale) return;
    const epoch = generation;
    const revision = state.revision;
    state.loading = true;
    state.error = null;
    const current = () => generation === epoch && directories.get(path) === state;
    const request = (async () => {
      try {
        const entries = await getBackend().fsReadDir({
          folderPath,
          dir: path,
          showIgnored: !!settings.settings?.showIgnoredInFileTree,
          showHidden: !!settings.settings?.showHiddenInFileTree,
        });
        if (!current() || revision !== state.revision) return;
        const previous = state.entries;
        if (
          !previous ||
          previous.length !== entries.length ||
          entries.some((entry, index) => {
            const before = previous[index]!;
            return (
              entry.path !== before.path || entry.name !== before.name || entry.kind !== before.kind
            );
          })
        )
          // IPC entries are immutable snapshots; avoid deep reactive proxies
          // and publish only when names, kinds, paths or their order change.
          state.entries = markRaw(entries);
        state.stale = false;
        // Evict vanished directory generations before reusing a path. A newly
        // created directory must not wait for the old directory's pending read;
        // current() also prevents that late read from touching the new cache.
        const children = new Set(entries.map((entry) => `${entry.kind}:${entry.path}`));
        const vanished = (child: string) => {
          if (child === path || (path && !child.startsWith(`${path}/`))) return false;
          const relative = path ? child.slice(path.length + 1) : child;
          const first = relative.split("/")[0]!;
          const direct = path ? `${path}/${first}` : first;
          return !children.has(`directory:${direct}`);
        };
        for (const child of directories.keys()) {
          if (!vanished(child)) continue;
          directories.delete(child);
          pending.delete(child);
        }
        for (const child of expanded) if (vanished(child)) expanded.delete(child);
        if (selectedPath.value && (!path || selectedPath.value.startsWith(`${path}/`))) {
          const relative = path ? selectedPath.value.slice(path.length + 1) : selectedPath.value;
          const first = relative.split("/")[0]!;
          const direct = path ? `${path}/${first}` : first;
          if (
            !entries.some(
              (entry) =>
                entry.path === direct && (relative === first || entry.kind === "directory"),
            )
          )
            selectedPath.value = null;
        }
      } catch (e) {
        if (current() && revision === state.revision) state.error = formatErrorMessage(e);
      } finally {
        if (current()) {
          state.loading = false;
          pending.delete(path);
        }
      }
    })();
    pending.set(path, request);
    await request;
    if (current() && revision !== state.revision && (path === "" || expanded.has(path)))
      await loadDir(path);
  }

  async function loadRoot() {
    if (!workspace.folderPath) return;
    initialized.value = true;
    await loadDir("");
  }
  async function expand(path: string) {
    const row = visibleRows.value.find((row) => row.path === path && row.kind === "directory");
    if (!row) return;
    // Retry on a compact row must also retry a failed hidden parent. A parent
    // may publish a different chain, so recheck the target after each read.
    const epoch = generation;
    if (row.compactRoot) {
      for (
        let end = row.compactRoot.length;
        end >= 0 && end < path.length;
        end = path.indexOf("/", end + 1)
      ) {
        const parent = path.slice(0, end);
        const state = directories.get(parent);
        if (!state?.stale) continue;
        await loadDir(parent);
        if (
          epoch !== generation ||
          state.error ||
          !visibleRows.value.some((item) => item.path === path && item.kind === "directory")
        )
          return;
      }
    }
    expanded.add(path);
    await loadDir(path);
  }
  function collapse(path: string) {
    const focusInside = selectedPath.value?.startsWith(`${path}/`);
    expanded.delete(path);
    if (focusInside) select(path);
  }
  async function toggle(path: string) {
    if (expanded.has(path)) collapse(path);
    else await expand(path);
  }
  let refreshing: Promise<void> | null = null;
  let refreshAgain = false;
  async function refreshExpanded(): Promise<void> {
    if (!initialized.value) return;
    for (const state of directories.values()) {
      state.stale = true;
      ++state.revision;
    }
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    const epoch = generation;
    const request = (async () => {
      do {
        refreshAgain = false;
        await loadDir("");
        if (epoch !== generation) return;
        // Parent-first reload avoids requesting directories removed by a refresh.
        const paths = [...expanded].sort((a, b) => a.split("/").length - b.split("/").length);
        for (const path of paths) {
          if (epoch !== generation) return;
          if (expanded.has(path)) await loadDir(path);
        }
      } while (epoch === generation && refreshAgain);
    })();
    refreshing = request;
    try {
      await request;
    } finally {
      if (refreshing === request) refreshing = null;
    }
  }
  watch(
    () => [workspace.folderPath, workspace.appliedOpenToken()],
    () => {
      ++generation;
      directories.clear();
      pending.clear();
      expanded.clear();
      selectedPath.value = null;
      selectedPaths.value = [];
      selectionAnchor = null;
      filter.value = "";
      initialized.value = false;
      refreshing = null;
      refreshAgain = false;
    },
    { flush: "sync" },
  );
  watch(
    () => [settings.settings?.showIgnoredInFileTree, settings.settings?.showHiddenInFileTree],
    () => {
      void refreshExpanded();
    },
    { flush: "sync" },
  );

  return {
    rows,
    selectedPath,
    selectedPaths,
    select,
    selectAll,
    filter,
    loading,
    error,
    initialized,
    loadRoot,
    expand,
    collapse,
    toggle,
    refreshExpanded,
  };
});
