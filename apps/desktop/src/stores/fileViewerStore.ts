import { defineStore } from "pinia";
import { owningRepository } from "@/features/file-tree/fileRepository";
import { onScopeDispose, reactive, ref, watch } from "vue";
import { getBackend } from "@/lib/backend";
import type { DiffHunk, FsMutation, FsOperation } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useLayoutStore } from "./layoutStore";
import { useChangesStore } from "./changesStore";
import { formatErrorMessage } from "@/lib/errors";
import { toast } from "@/composables/useToast";
import { i18n } from "@/i18n";
import { relativeToRoot } from "@/lib/projectFilePath";
import { workspacePathKey } from "@/lib/workspacePath";
import type { FileEditorSnapshot } from "@/features/file/fileEditorState";

export type FileViewerTab = {
  id: string;
  path: string;
  /** Present for files outside the active Git repository. */
  folderPath?: string;
  title: string;
  text: string;
  /** Text as loaded from disk / last successful save. */
  baseline: string;
  hunks: DiffHunk[];
  loading: boolean;
  saving: boolean;
  fileOperationPending?: boolean;
  restorePending?: boolean;
  deletedOnDisk?: boolean;
  reveal?: { line: number; column: number };
  editable: boolean;
  dirty: boolean;
  /** Bumped when a load finishes so the editor remounts once, not on each save. */
  loadGeneration: number;
};

type SavedGutterRequest = {
  repoPath: string;
  repoId: string;
  path: string;
  content: string;
  navigation: number;
};
type SavedGutterQueue = {
  running: boolean;
  latest: SavedGutterRequest | null;
  pending: SavedGutterRequest | null;
};

export const useFileViewerStore = defineStore("fileViewer", () => {
  const tabs = ref<FileViewerTab[]>([]);
  const activeId = ref<string | null>(null);
  const fileMutationPending = ref(false);
  const workspace = useWorkspaceStore();
  const gutterQueues = new WeakMap<FileViewerTab, SavedGutterQueue>();
  let editorSnapshots = new WeakMap<FileViewerTab, FileEditorSnapshot>();
  let disposed = false;
  function cacheEditorSnapshot(tab: FileViewerTab, snapshot: FileEditorSnapshot) {
    if (
      disposed ||
      !tabs.value.includes(tab) ||
      tab.loading ||
      tab.text !== snapshot.text ||
      tab.loadGeneration !== snapshot.generation ||
      tab.editable !== snapshot.editable
    )
      return;
    editorSnapshots.set(tab, snapshot);
  }
  function takeEditorSnapshot(tab: FileViewerTab) {
    const snapshot = editorSnapshots.get(tab);
    editorSnapshots.delete(tab);
    return !disposed &&
      snapshot &&
      snapshot.text === tab.text &&
      snapshot.generation === tab.loadGeneration &&
      snapshot.editable === tab.editable
      ? snapshot
      : undefined;
  }
  function invalidateGutters(tab: FileViewerTab) {
    const queue = gutterQueues.get(tab);
    if (queue) queue.latest = queue.pending = null;
  }
  onScopeDispose(() => {
    disposed = true;
    editorSnapshots = new WeakMap();
    tabs.value.forEach(invalidateGutters);
  });
  watch(
    () => [workspace.repoPath, workspace.folderPath, workspace.appliedOpenToken?.()],
    () => {
      editorSnapshots = new WeakMap();
      tabs.value.forEach(invalidateGutters);
      tabs.value = [];
      activeId.value = null;
    },
    { flush: "sync" },
  );

  async function refreshSavedGutters(tab: FileViewerTab, request: SavedGutterRequest) {
    let queue = gutterQueues.get(tab);
    if (!queue) {
      queue = { running: false, latest: null, pending: null };
      gutterQueues.set(tab, queue);
    }
    queue.latest = queue.pending = request;
    if (queue.running) return;
    queue.running = true;
    try {
      // At most one auxiliary read per tab, with only the latest save queued.
      while (queue.pending) {
        const snapshot = queue.pending;
        queue.pending = null;
        const current = () =>
          !disposed &&
          queue.latest === snapshot &&
          tabs.value.includes(tab) &&
          workspace.repoPath === snapshot.repoPath &&
          workspace.navigationToken() === snapshot.navigation &&
          tab.path === snapshot.path &&
          !tab.folderPath &&
          !tab.saving &&
          tab.text === snapshot.content &&
          tab.baseline === snapshot.content;
        if (!current()) continue;
        try {
          const diff = await getBackend().diffFile({
            repoId: snapshot.repoId,
            path: snapshot.repoPath,
            filePath: snapshot.path,
            left: "head",
            right: "worktree",
          });
          if (current()) tab.hunks = diff.rightText === snapshot.content ? diff.hunks : [];
        } catch {
          // Optional line marks cannot turn a successful disk write into failure.
          if (current()) tab.hunks = [];
        }
      }
    } finally {
      queue.running = false;
      queue.latest = null;
    }
  }

  async function open(
    filePath: string,
    source?: { folderPath: string | null; line?: number; column?: number },
  ) {
    if (fileMutationPending.value) return;
    const workspace = useWorkspaceStore();
    const layout = useLayoutStore();
    const sourceRoot = source?.folderPath ?? workspace.repoPath;
    if (!sourceRoot) return;
    const sourceFilePath = filePath;
    const owner = owningRepository(sourceRoot, filePath, workspace.roots ?? []);
    const repoRelative =
      workspace.isRepo &&
      workspace.repoPath &&
      workspace.repoId &&
      (!owner || owner.id === workspace.repoId)
        ? relativeToRoot(sourceRoot, filePath, workspace.repoPath)
        : null;
    const folderPath = repoRelative === null ? sourceRoot : undefined;
    filePath = repoRelative ?? filePath;
    const navigation = workspace.navigationToken();

    const existing = tabs.value.find((t) => t.path === filePath && t.folderPath === folderPath);
    if (existing) {
      if (source?.line) existing.reveal = { line: source.line, column: source.column ?? 1 };
      activeId.value = existing.id;
      layout.activeEditorKind = "file";
      return;
    }

    const pathId = folderPath
      ? `file:${JSON.stringify([folderPath, filePath])}`
      : `file:${filePath}`;
    const id = tabs.value.some((tab) => tab.id === pathId)
      ? `${pathId}:${crypto.randomUUID()}`
      : pathId;
    const tab = reactive<FileViewerTab>({
      id,
      path: filePath,
      folderPath,
      title: filePath.split("/").pop() ?? filePath,
      text: "",
      baseline: "",
      hunks: [],
      loading: true,
      saving: false,
      editable: true,
      dirty: false,
      loadGeneration: 0,
      reveal: source?.line ? { line: source.line, column: source.column ?? 1 } : undefined,
    });
    tabs.value.push(tab);
    activeId.value = id;
    layout.activeEditorKind = "file";

    const repoPath = workspace.repoPath;
    const repoId = workspace.repoId;
    const current = () =>
      tabs.value.includes(tab) &&
      workspace.repoPath === repoPath &&
      workspace.navigationToken() === navigation;
    try {
      const backend = getBackend();
      // Every editing entry point needs strict, complete disk text. A diff can
      // omit large/binary contents or decode invalid UTF-8 for display only.
      const text = await backend.fsReadFile({
        folderPath: sourceRoot,
        filePath: sourceFilePath,
      });
      if (!current()) return;
      const diff =
        folderPath || text.length > 5 * 1024 * 1024
          ? null
          : await backend
              .diffFile({
                repoId: repoId!,
                path: repoPath!,
                filePath,
                left: "head",
                right: "worktree",
              })
              .catch(() => null);
      if (!current()) return;
      tab.text = text;
      tab.baseline = text;
      // A failed HEAD read must not prevent editing. Concurrent disk changes
      // can also make the optional gutter describe a different snapshot.
      tab.hunks = diff?.rightText === text ? diff.hunks : [];
      tab.dirty = false;
      tab.editable = true;
    } catch (e) {
      if (!current()) return;
      const text = `// failed to load ${filePath}\n// ${formatErrorMessage(e)}`;
      tab.text = text;
      tab.baseline = text;
      tab.dirty = false;
      tab.editable = false;
    } finally {
      if (tabs.value.includes(tab)) {
        tab.loading = false;
        tab.loadGeneration += 1;
      }
    }
  }

  function setDocument(id: string, text: string) {
    const tab = tabs.value.find((t) => t.id === id);
    if (!tab || !tab.editable || tab.loading || tab.restorePending) return;
    tab.text = text;
    tab.dirty = text !== tab.baseline;
  }

  async function save(id?: string | null) {
    const workspace = useWorkspaceStore();
    const targetId = id ?? activeId.value;
    const tab = tabs.value.find((t) => t.id === targetId);
    if (!tab || (!tab.folderPath && (!workspace.repoPath || !workspace.repoId))) return false;
    if (
      !tab.editable ||
      tab.loading ||
      tab.saving ||
      fileMutationPending.value ||
      tab.fileOperationPending ||
      tab.deletedOnDisk
    )
      return false;
    if (!tab.dirty) return true;

    const repoPath = workspace.repoPath;
    const repoId = workspace.repoId;
    const path = tab.path;
    const content = tab.text;
    const navigation = workspace.navigationToken();
    invalidateGutters(tab);
    tab.saving = true;
    try {
      const backend = getBackend();
      if (tab.folderPath)
        await backend.fsWriteFile({ folderPath: tab.folderPath, filePath: path, content });
      else
        await backend.fileWriteWorktree({
          repoId: repoId!,
          path: repoPath!,
          filePath: path,
          content,
        });
      if (
        !tabs.value.includes(tab) ||
        workspace.repoPath !== repoPath ||
        workspace.navigationToken() !== navigation
      ) {
        return false;
      }
      tab.baseline = content;
      tab.dirty = tab.text !== tab.baseline;
      if (!tab.dirty) tab.hunks = [];
      if (
        workspace.isRepo &&
        workspace.repoPath === repoPath &&
        workspace.navigationToken() === navigation
      ) {
        void useChangesStore().refresh();
      }
    } catch (e) {
      toast({
        title: i18n.global.t("editor.saveFailed"),
        description: formatErrorMessage(e),
      });
      return false;
    } finally {
      if (tabs.value.includes(tab)) tab.saving = false;
    }
    if (!tab.folderPath && content.length <= 5 * 1024 * 1024)
      void refreshSavedGutters(tab, {
        repoPath: repoPath!,
        repoId: repoId!,
        path,
        content,
        navigation,
      });
    return true;
  }

  async function saveActive() {
    return save(activeId.value);
  }

  function affectedByFiles(folder: string, paths: string[]) {
    return tabs.value.filter((tab) => {
      const root = tab.folderPath ?? workspace.repoPath;
      const relative = root ? relativeToRoot(root, tab.path, folder) : null;
      return relative !== null && paths.some((path) => withinFilePath(folder, relative, path));
    });
  }

  function withinFilePath(folder: string, path: string, parent: string) {
    const key = workspacePathKey(`${folder}/${path}`);
    const parentKey = workspacePathKey(`${folder}/${parent}`);
    return key === parentKey || key.startsWith(`${parentKey}/`);
  }

  function applyFileMutation(
    folder: string,
    operation: FsOperation,
    completed: FsMutation[],
    confirmedDeletes?: ReadonlyMap<FileViewerTab, string>,
  ) {
    if (operation === "delete") {
      for (const tab of affectedByFiles(
        folder,
        completed.map((item) => item.path),
      )) {
        // Only successful deletions can consume confirmed drafts. Edits made
        // during confirmation/recycling and replacement tab instances survive.
        if (tab.dirty && confirmedDeletes?.get(tab) !== tab.text) tab.deletedOnDisk = true;
        else closeTab(tab.id);
      }
      return;
    }
    if (operation !== "rename" && operation !== "move") return;
    for (const tab of tabs.value) {
      const root = tab.folderPath ?? workspace.repoPath;
      const relative = root ? relativeToRoot(root, tab.path, folder) : null;
      if (relative === null) continue;
      const item = completed.find((item) => withinFilePath(folder, relative, item.path));
      if (!item?.destination) continue;
      invalidateGutters(tab);
      const nextPath = item.destination + relative.slice(item.path.length);
      const owner = owningRepository(folder, nextPath, workspace.roots ?? []);
      const repoRelative =
        workspace.isRepo && workspace.repoPath && (!owner || owner.id === workspace.repoId)
          ? relativeToRoot(folder, nextPath, workspace.repoPath)
          : null;
      tab.folderPath = repoRelative === null ? folder : undefined;
      tab.path = repoRelative ?? nextPath;
      tab.title = tab.path.split("/").at(-1)!;
      // The editor instance owns selection and undo history. Its identity must
      // survive a path change; open() resolves tabs by current path instead.
      tab.hunks = [];
    }
  }

  function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    editorSnapshots.delete(tabs.value[idx]!);
    invalidateGutters(tabs.value[idx]!);
    tabs.value.splice(idx, 1);
    if (activeId.value === id) {
      activeId.value = tabs.value[idx]?.id ?? tabs.value[idx - 1]?.id ?? null;
      if (!activeId.value && useLayoutStore().activeEditorKind === "file") {
        useLayoutStore().activeEditorKind = "welcome";
      }
    }
  }

  return {
    tabs,
    activeId,
    fileMutationPending,
    open,
    setDocument,
    save,
    saveActive,
    closeTab,
    affectedByFiles,
    applyFileMutation,
    cacheEditorSnapshot,
    takeEditorSnapshot,
  };
});
