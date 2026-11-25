import { defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { getBackend, type FsEntry } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";
import { useWorkspaceStore } from "./workspaceStore";
import { useSettingsStore } from "./settingsStore";

type Directory = {
  entries: FsEntry[];
  loaded: boolean;
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
        entries: [],
        loaded: false,
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
        // Compact only directories loaded through normal expansion. Rendering
        // never starts a recursive scan of unopened project subtrees.
        if (settings.settings?.compactFileTree && entry.kind === "directory") {
          for (let count = 0; count < 256; count++) {
            const childState = directories.get(entry.path);
            const child = childState?.entries[0];
            if (
              !childState?.loaded ||
              childState.error ||
              childState.entries.length !== 1 ||
              child?.kind !== "directory" ||
              !expanded.has(entry.path)
            )
              break;
            name += `/${child.name}`;
            entry = child;
          }
        }
        const state = directories.get(entry.path);
        const open = entry.kind === "directory" && expanded.has(entry.path);
        result.push({
          ...entry,
          name,
          compactRoot: original.path !== entry.path ? original.path : undefined,
          key: `${entry.kind}:${entry.path}`,
          depth,
          expanded: open,
          loading: !!state?.loading,
          error: state?.error ?? null,
        });
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
    (visible) => {
      const paths = new Set(visible.map((row) => row.path));
      selectedPaths.value = selectedPaths.value.filter((path) => paths.has(path));
    },
    { flush: "sync" },
  );

  async function loadDir(path: string): Promise<void> {
    const folderPath = workspace.folderPath;
    if (!folderPath) return;
    const queued = pending.get(path);
    if (queued) return queued;
    const state = directory(path);
    if (state.loaded) return;
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
        state.entries = entries;
        state.loaded = true;
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
    if (!visibleRows.value.some((row) => row.path === path && row.kind === "directory")) return;
    expanded.add(path);
    await loadDir(path);
  }
  function collapse(path: string) {
    expanded.delete(path);
    if (selectedPath.value?.startsWith(`${path}/`)) select(path);
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
      state.loaded = false;
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
