import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { BlobContent, TreeEntry } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useLayoutStore } from "./layoutStore";
import { formatErrorMessage } from "@/lib/errors";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { useDiffStore } from "./diffStore";
import { useHistoryStore } from "./historyStore";
import { useChangesStore } from "./changesStore";
import { confirmDialog } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import { i18n } from "@/i18n";

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
  blobLoading: boolean;
  blobError: string | null;
  restoreError: string | null;
};

export const useRepoAtRevStore = defineStore("repoAtRev", () => {
  const tabs = ref<RepoAtRevTab[]>([]);
  const activeId = ref<string | null>(null);
  const capture = useRepositoryAction(() => {
    tabs.value = [];
    activeId.value = null;
  });
  const requests = new WeakMap<RepoAtRevTab, { directory: number; blob: number }>();
  const pendingWrites = reactive(new Set<string>());
  const workspace = useWorkspaceStore();
  const busy = computed(() => !!workspace.repoPath && pendingWrites.has(workspace.repoPath));
  function live(tab: RepoAtRevTab) {
    return tabs.value.includes(tab) && capture().current();
  }
  function stateFor(tab: RepoAtRevTab) {
    let state = requests.get(tab);
    if (!state) {
      state = { directory: 0, blob: 0 };
      requests.set(tab, state);
    }
    return state;
  }
  function selectedEntry(tab: RepoAtRevTab) {
    if (!live(tab) || tab.loading) return;
    return tab.entries.find((e) => e.path === tab.selectedPath && e.kind === "blob");
  }

  async function open(rev: string) {
    if (!capture().current()) return;
    const short = rev.length > 12 ? rev.slice(0, 7) : rev;
    const id = `repo-at:${rev}`;
    let tab = tabs.value.find((t) => t.id === id);
    const existing = !!tab;
    if (!tab) {
      tab = {
        id,
        rev,
        title: `Repository at ${short}`,
        dir: "",
        entries: [],
        selectedPath: null,
        blob: null,
        loading: false,
        error: null,
        blobLoading: false,
        blobError: null,
        restoreError: null,
      };
      tabs.value = [...tabs.value, tab];
    }
    tab = tabs.value.find((t) => t.id === id)!;
    activeId.value = id;
    useLayoutStore().activeEditorKind = "repoAtRev";
    if (!existing) await loadDir(tab, "");
  }

  async function loadDir(tab: RepoAtRevTab, dir: string) {
    const source = capture();
    if (!source.current() || !source.path || !live(tab)) return;
    if (tab.loading && tab.dir === dir) return;
    const state = stateFor(tab);
    const generation = ++state.directory;
    ++state.blob;
    const current = () => source.current() && live(tab) && generation === state.directory;
    tab.loading = true;
    tab.error = null;
    tab.dir = dir;
    tab.entries = [];
    tab.selectedPath = null;
    tab.blob = null;
    tab.blobLoading = false;
    tab.blobError = null;
    tab.restoreError = null;
    try {
      const entries = await getBackend().treeList({
        path: source.path,
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
    const source = capture();
    if (!source.current() || !source.path || !live(tab) || tab.loading) return;
    // Reject queued events from a directory that has already been replaced.
    if (!tab.entries.includes(entry)) return;
    if (entry.kind === "tree") {
      await loadDir(tab, entry.path);
      return;
    }
    if (entry.kind !== "blob") return;
    if (tab.selectedPath === entry.path && (tab.blobLoading || tab.blob)) return;
    const state = stateFor(tab);
    const generation = ++state.blob;
    const current = () => source.current() && live(tab) && generation === state.blob;
    tab.selectedPath = entry.path;
    tab.blob = null;
    tab.blobLoading = true;
    tab.blobError = null;
    tab.restoreError = null;
    try {
      const blob = await getBackend().blobRead({
        path: source.path,
        rev: tab.rev,
        filePath: entry.path,
      });
      if (current()) tab.blob = blob;
    } catch (e) {
      if (current()) tab.blobError = formatErrorMessage(e);
    } finally {
      if (current()) tab.blobLoading = false;
    }
  }

  async function retryBlob(tab: RepoAtRevTab) {
    const entry = selectedEntry(tab);
    if (entry) await openEntry(tab, entry);
  }

  async function compareLocal(tab: RepoAtRevTab) {
    const entry = selectedEntry(tab);
    if (entry) await useDiffStore().openRevDiff(entry.path, tab.rev, "WORKTREE");
  }

  async function showHistory(tab: RepoAtRevTab) {
    const entry = selectedEntry(tab);
    if (entry) await useHistoryStore().openFileHistory(entry.path);
  }

  async function restoreFile(tab: RepoAtRevTab) {
    const source = capture();
    const entry = selectedEntry(tab);
    if (!entry || !source.path || !source.repoId || !source.current() || busy.value) return false;
    const filePath = entry.path;
    const rev = tab.rev;
    const state = stateFor(tab);
    const generation = state.blob;
    const current = () => source.current() && live(tab) && generation === state.blob;
    pendingWrites.add(source.path);
    tab.restoreError = null;
    try {
      const confirmed = await confirmDialog({
        title: i18n.global.t("history.restore"),
        message: i18n.global.t("history.restoreConfirm", { file: filePath, rev }),
        confirmLabel: i18n.global.t("history.restore"),
        destructive: true,
      });
      if (
        !confirmed ||
        !current() ||
        activeId.value !== tab.id ||
        useLayoutStore().activeEditorKind !== "repoAtRev"
      )
        return false;
      await getBackend().checkoutPathFromRev({
        repoId: source.repoId,
        path: source.path,
        rev,
        filePath,
      });
    } catch (e) {
      if (current()) tab.restoreError = formatErrorMessage(e);
      return false;
    } finally {
      pendingWrites.delete(source.path);
    }
    if (source.current()) {
      toast({ title: i18n.global.t("history.restored"), description: filePath });
      try {
        const changes = useChangesStore();
        await changes.refresh();
        if (source.current() && changes.error) throw new Error(changes.error);
      } catch (e) {
        if (source.current())
          toast({
            title: i18n.global.t("history.restoreRefreshFailed"),
            description: formatErrorMessage(e),
            persistent: true,
          });
      }
    }
    return true;
  }

  async function goUp(tab: RepoAtRevTab) {
    if (!live(tab) || !tab.dir) return;
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

  return {
    tabs,
    activeId,
    busy,
    open,
    loadDir,
    openEntry,
    retryBlob,
    compareLocal,
    showHistory,
    restoreFile,
    goUp,
    closeTab,
  };
});
