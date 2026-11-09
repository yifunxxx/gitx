import { defineStore } from "pinia";
import { ref, watch } from "vue";
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
  const workspace = useWorkspaceStore();
  watch(
    () => workspace.repoPath,
    () => {
      tabs.value = [];
      activeId.value = null;
    },
    { flush: "sync" },
  );
  const loads = new WeakMap<RepoAtRevTab, number>();
  const blobs = new WeakMap<RepoAtRevTab, number>();
  let generation = 0;

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
    tab = tabs.value.find((t) => t.id === id)!;
    activeId.value = id;
    useLayoutStore().activeEditorKind = "repoAtRev";
    await loadDir(tab, "");
  }

  async function loadDir(tab: RepoAtRevTab, dir: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    if (!tabs.value.includes(tab)) return;
    const request = ++generation;
    loads.set(tab, request);
    blobs.set(tab, ++generation);
    const current = () => tabs.value.includes(tab) && loads.get(tab) === request;
    tab.loading = true;
    tab.error = null;
    tab.dir = dir;
    tab.selectedPath = null;
    tab.blob = null;
    tab.entries = [];
    try {
      const entries = await getBackend().treeList({
        path: workspace.repoPath,
        rev: tab.rev,
        dir,
      });
      if (current()) tab.entries = entries;
    } catch (e) {
      if (current()) tab.error = formatErrorMessage(e);
    } finally {
      if (current()) tab.loading = false;
    }
  }

  async function openEntry(tab: RepoAtRevTab, entry: TreeEntry) {
    if (entry.kind === "tree") {
      await loadDir(tab, entry.path);
      return;
    }
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    if (!tabs.value.includes(tab)) return;
    const request = ++generation;
    blobs.set(tab, request);
    const current = () => tabs.value.includes(tab) && blobs.get(tab) === request;
    tab.selectedPath = entry.path;
    tab.blob = null;
    tab.error = null;
    try {
      const blob = await getBackend().blobRead({
        path: workspace.repoPath,
        rev: tab.rev,
        filePath: entry.path,
      });
      if (current()) tab.blob = blob;
    } catch (e) {
      if (current()) tab.error = formatErrorMessage(e);
    }
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
