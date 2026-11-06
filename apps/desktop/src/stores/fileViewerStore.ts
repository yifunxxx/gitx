import { defineStore } from "pinia";
import { ref } from "vue";
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
  hunks: DiffHunk[];
  loading: boolean;
  editable: boolean;
};

export const useFileViewerStore = defineStore("fileViewer", () => {
  const tabs = ref<FileViewerTab[]>([]);
  const activeId = ref<string | null>(null);

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
    const tab: FileViewerTab = {
      id,
      path: filePath,
      title: filePath.split("/").pop() ?? filePath,
      text: "",
      hunks: [],
      loading: true,
      editable: true,
    };
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
      tab.text = diff.rightText ?? "";
      tab.hunks = diff.hunks;
    } catch (e) {
      tab.text = `// failed to load ${filePath}\n// ${formatErrorMessage(e)}`;
    } finally {
      tab.loading = false;
    }
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

  return { tabs, activeId, open, closeTab };
});
