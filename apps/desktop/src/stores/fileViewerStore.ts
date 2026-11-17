import { defineStore } from "pinia";
import { reactive, ref, watch } from "vue";
import { getBackend } from "@/lib/backend";
import type { DiffHunk } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useLayoutStore } from "./layoutStore";
import { useChangesStore } from "./changesStore";
import { formatErrorMessage } from "@/lib/errors";
import { toast } from "@/composables/useToast";
import { i18n } from "@/i18n";

export type FileViewerTab = {
  id: string;
  path: string;
  title: string;
  text: string;
  /** Text as loaded from disk / last successful save. */
  baseline: string;
  hunks: DiffHunk[];
  loading: boolean;
  saving: boolean;
  editable: boolean;
  dirty: boolean;
  /** Bumped when a load finishes so the editor remounts once, not on each save. */
  loadGeneration: number;
};

export const useFileViewerStore = defineStore("fileViewer", () => {
  const tabs = ref<FileViewerTab[]>([]);
  const activeId = ref<string | null>(null);
  const workspace = useWorkspaceStore();
  watch(
    () => workspace.repoPath,
    () => {
      tabs.value = [];
      activeId.value = null;
    },
    { flush: "sync" },
  );

  async function open(filePath: string) {
    const workspace = useWorkspaceStore();
    const layout = useLayoutStore();
    if (!workspace.repoPath || !workspace.repoId) return;

    const existing = tabs.value.find((t) => t.path === filePath);
    if (existing) {
      activeId.value = existing.id;
      layout.activeEditorKind = "file";
      return;
    }

    const id = `file:${filePath}`;
    const tab = reactive<FileViewerTab>({
      id,
      path: filePath,
      title: filePath.split("/").pop() ?? filePath,
      text: "",
      baseline: "",
      hunks: [],
      loading: true,
      saving: false,
      editable: true,
      dirty: false,
      loadGeneration: 0,
    });
    tabs.value.push(tab);
    activeId.value = id;
    layout.activeEditorKind = "file";

    const repoPath = workspace.repoPath;
    const repoId = workspace.repoId;
    try {
      const backend = getBackend();
      const diff = await backend.diffFile({
        repoId,
        path: repoPath,
        filePath,
        left: "head",
        right: "worktree",
      });
      if (!tabs.value.includes(tab) || workspace.repoPath !== repoPath) return;
      const text = diff.rightText ?? "";
      tab.text = text;
      tab.baseline = text;
      tab.hunks = diff.hunks;
      tab.dirty = false;
      tab.editable = true;
    } catch (e) {
      if (!tabs.value.includes(tab) || workspace.repoPath !== repoPath) return;
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
    if (!tab || tab.saving) return;
    tab.text = text;
    tab.dirty = text !== tab.baseline;
  }

  async function save(id?: string | null) {
    const workspace = useWorkspaceStore();
    const targetId = id ?? activeId.value;
    const tab = tabs.value.find((t) => t.id === targetId);
    if (!tab || !workspace.repoPath || !workspace.repoId) return false;
    if (!tab.editable || tab.loading || tab.saving) return false;
    if (!tab.dirty) return true;

    const repoPath = workspace.repoPath;
    const repoId = workspace.repoId;
    const path = tab.path;
    const content = tab.text;
    const navigation = workspace.navigationToken();
    tab.saving = true;
    try {
      const backend = getBackend();
      await backend.fileWriteWorktree({
        repoId,
        path: repoPath,
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
      try {
        const diff = await backend.diffFile({
          repoId,
          path: repoPath,
          filePath: path,
          left: "head",
          right: "worktree",
        });
        if (
          tabs.value.includes(tab) &&
          workspace.repoPath === repoPath &&
          workspace.navigationToken() === navigation
        ) {
          tab.hunks = diff.hunks;
        }
      } catch {
        // Disk write already succeeded; stale gutter is recoverable on reopen.
      }
      if (workspace.repoPath === repoPath && workspace.navigationToken() === navigation) {
        void useChangesStore().refresh();
      }
      return true;
    } catch (e) {
      toast({
        title: i18n.global.t("editor.saveFailed"),
        description: formatErrorMessage(e),
      });
      return false;
    } finally {
      if (tabs.value.includes(tab)) tab.saving = false;
    }
  }

  async function saveActive() {
    return save(activeId.value);
  }

  function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    tabs.value.splice(idx, 1);
    if (activeId.value === id) {
      activeId.value = tabs.value[idx]?.id ?? tabs.value[idx - 1]?.id ?? null;
      if (!activeId.value) {
        useLayoutStore().activeEditorKind = "welcome";
      }
    }
  }

  return { tabs, activeId, open, setDocument, save, saveActive, closeTab };
});
