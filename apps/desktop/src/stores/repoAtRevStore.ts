import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { BlobContent, TreeEntry } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useLayoutStore } from "./layoutStore";
import { formatErrorMessage } from "@/lib/errors";

export type RepoAtRevTab = {
  id: string;
  rev: string;
  title: string;
  dir: string;
  entries: TreeEntry[];
  selectedPath: string | null;
  blob: BlobContent | null;
  loading: boolean;
  error: string | null;
};

export const useRepoAtRevStore = defineStore("repoAtRev", () => {
  const tabs = ref<RepoAtRevTab[]>([]);
  const activeId = ref<string | null>(null);

  async function open(rev: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    const short = rev.length > 12 ? rev.slice(0, 7) : rev;
    const id = `repo-at:${rev}`;
    let tab = tabs.value.find((t) => t.id === id);
    if (!tab) {
      tab = {
        id,
        rev,
        title: `Repository at ${short}`,
        dir: "",
        entries: [],
        selectedPath: null,
        blob: null,
        loading: true,
        error: null,
      };
      tabs.value = [...tabs.value, tab];
    }
    activeId.value = id;
    useLayoutStore().activeEditorKind = "repoAtRev";
    await loadDir(tab, "");
  }

  async function loadDir(tab: RepoAtRevTab, dir: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    tab.loading = true;
    tab.error = null;
    tab.dir = dir;
    try {
      tab.entries = await getBackend().treeList({
        path: workspace.repoPath,
        rev: tab.rev,
        dir,
      });
    } catch (e) {
      tab.error = formatErrorMessage(e);
      tab.entries = [];
    } finally {
      tab.loading = false;
    }
  }

  async function openEntry(tab: RepoAtRevTab, entry: TreeEntry) {
    if (entry.kind === "tree") {
      await loadDir(tab, entry.path);
      return;
    }
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    tab.selectedPath = entry.path;
    tab.blob = await getBackend().blobRead({
      path: workspace.repoPath,
      rev: tab.rev,
      filePath: entry.path,
    });
  }

  async function goUp(tab: RepoAtRevTab) {
    if (!tab.dir) return;
    const parts = tab.dir.replace(/\/$/, "").split("/");
    parts.pop();
    await loadDir(tab, parts.join("/"));
  }

  function closeTab(id: string) {
    tabs.value = tabs.value.filter((t) => t.id !== id);
    if (activeId.value === id) {
      activeId.value = tabs.value[tabs.value.length - 1]?.id ?? null;
    }
  }

  return { tabs, activeId, open, loadDir, openEntry, goUp, closeTab };
});
