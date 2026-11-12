import { defineStore } from "pinia";
import { reactive, ref, watch } from "vue";
import { getBackend } from "@/lib/backend";
import type { DiffHunk } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useLayoutStore } from "./layoutStore";
import { formatErrorMessage } from "@/lib/errors";

export type FileViewerTab = {
  id: string;
  path: string;
  title: string;
  text: string;
  /** Text as loaded from disk / last clean baseline. */
  baseline: string;
  hunks: DiffHunk[];
  loading: boolean;
  editable: boolean;
  dirty: boolean;
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
      editable: true,
      dirty: false,
    });
    tabs.value.push(tab);
    activeId.value = id;
    layout.activeEditorKind = "file";

    try {
      const backend = getBackend();
      const diff = await backend.diffFile({
        repoId: workspace.repoId,
        path: workspace.repoPath,
        filePath,
        left: "head",
        right: "worktree",
      });
      const text = diff.rightText ?? "";
      tab.text = text;
      tab.baseline = text;
      tab.hunks = diff.hunks;
      tab.dirty = false;
    } catch (e) {
      const text = `// failed to load ${filePath}\n// ${formatErrorMessage(e)}`;
      tab.text = text;
      tab.baseline = text;
      tab.dirty = false;
    } finally {
      tab.loading = false;
    }
  }

  function setDocument(id: string, text: string) {
    const tab = tabs.value.find((t) => t.id === id);
    if (!tab) return;
    tab.text = text;
    tab.dirty = text !== tab.baseline;
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

  return { tabs, activeId, open, setDocument, closeTab };
});
