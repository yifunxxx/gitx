import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { RefEntry, RefsList, RemoteInfo } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useSettingsStore } from "./settingsStore";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";
import { handleAuthFailure } from "@/composables/useCredentials";
import { i18n } from "@/i18n";
import { useJobsStore } from "./jobsStore";

export const useBranchesStore = defineStore("branches", () => {
  const refs = ref<RefsList | null>(null);
  const remotes = ref<RemoteInfo[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const popupOpen = ref(false);
  const search = ref("");
  const hasUnfetched = ref(false);
  const lastFetchAt = ref<number | null>(null);
  const selectedFullName = ref<string | null>(null);

  const workspace = () => useWorkspaceStore();
  const settings = () => useSettingsStore();

  const filteredLocal = computed(() => filterRefs(refs.value?.local ?? [], search.value));
  const filteredRemote = computed(() => filterRefs(refs.value?.remote ?? [], search.value));
  const filteredTags = computed(() => filterRefs(refs.value?.tags ?? [], search.value));

  async function refresh() {
    const ws = workspace();
    if (!ws.repoPath || !ws.isRepo) {
      refs.value = null;
      remotes.value = [];
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const backend = getBackend();
      const [list, remoteList] = await Promise.all([
        backend.refsList({
          repoId: ws.repoId!,
          path: ws.repoPath,
          gitDir: ws.gitDir,
        }),
        backend.remoteList({ path: ws.repoPath }),
      ]);
      refs.value = list;
      remotes.value = remoteList;
    } catch (e) {
      error.value = formatErrorMessage(e);
    } finally {
      loading.value = false;
    }
  }

  async function toggleFavorite(entry: RefEntry) {
    const ws = workspace();
    if (!ws.gitDir || !refs.value) return;
    const full = entry.fullName;
    const current = [
      ...refs.value.local,
      ...refs.value.remote,
      ...refs.value.tags,
    ]
      .filter((r) => r.isFavorite)
      .map((r) => r.fullName);
    const next = current.includes(full)
      ? current.filter((f) => f !== full)
      : [...current, full];
    await getBackend().favoritesSet({ gitDir: ws.gitDir, favorites: next });
    await refresh();
  }

  async function checkout(entry: RefEntry) {
    const ws = workspace();
    if (!ws.repoPath) return;
    const mode =
      entry.kind === "remoteBranch"
        ? "remote"
        : entry.kind === "tag"
          ? "revision"
          : "local";
    const target =
      entry.kind === "remoteBranch" ? entry.name : entry.name;
    const checkoutTarget = entry.kind === "tag" ? entry.fullName : target;
    const allRoots =
      settings().settings?.git?.executeBranchOpsOnAllRoots !== false &&
      ws.multiRoot &&
      ws.roots.length > 1;

    if (allRoots) {
      const result = await getBackend().multiRootCheckout({
        roots: ws.roots.map((r) => r.worktreeRoot),
        target: checkoutTarget,
        mode,
        rollbackOnFail: true,
      });
      if (!result.ok) {
        const failed = result.steps.find((s) => !s.ok);
        const msg = failed?.error ?? "Multi-root checkout failed";
        if (result.rolledBack) {
          toast({
            title: "Multi-root checkout failed",
            description: `${msg}\n\nRolled back successful roots.`,
            persistent: true,
          });
        } else {
          const { confirmDialog } = await import("@/composables/useConfirm");
          const roll = await confirmDialog({
            title: "Multi-root checkout failed",
            message: `${msg}\n\nRollback successful roots?`,
            destructive: true,
          });
          if (roll) {
            await getBackend().multiRootRollback({ steps: result.steps });
          }
        }
      }
    } else {
      await getBackend().branchCheckout({
        path: ws.repoPath,
        target: checkoutTarget,
        mode,
      });
    }
    await refresh();
  }

  async function createBranch(name: string, startPoint?: string, checkout = true, force = false) {
    const ws = workspace();
    if (!ws.repoPath) return;
    await getBackend().branchCreate({
      path: ws.repoPath,
      name,
      startPoint: startPoint ?? null,
      checkout,
      force,
    });
    await refresh();
  }

  async function renameBranch(oldName: string, newName: string, unsetUpstream: boolean) {
    const ws = workspace();
    if (!ws.repoPath) return;
    await getBackend().branchRename({
      path: ws.repoPath,
      oldName,
      newName,
      unsetUpstream,
      force: false,
      gitDir: ws.gitDir,
    });
    await refresh();
  }

  async function deleteBranch(name: string, force: boolean) {
    const ws = workspace();
    if (!ws.repoPath) return;
    const res = await getBackend().branchDelete({ path: ws.repoPath, name, force });
    await refresh();
    return res.sha;
  }

  async function restoreBranch(name: string, sha: string) {
    const ws = workspace();
    if (!ws.repoPath) return;
    await getBackend().branchRestore({ path: ws.repoPath, name, sha });
    await refresh();
  }

  async function updateBranch(local: string, remoteRef: string) {
    const ws = workspace();
    if (!ws.repoPath) return;
    await getBackend().branchUpdate({ path: ws.repoPath, local, remoteRef });
    await refresh();
  }

  async function fetch(remote?: string) {
    const ws = workspace();
    if (!ws.repoPath) {
      toast({ title: "Fetch failed", description: "No repository open" });
      return null;
    }
    const path = ws.repoPath;
    const jobs = useJobsStore();
    const jobId = `fetch-${Date.now()}`;
    jobs.started({
      id: jobId,
      title: remote ? `Fetching ${remote}…` : "Fetching remotes…",
    });
    const run = async () => {
      const summary = await getBackend().fetchRun({
        path,
        remote: remote ?? null,
        prune: true,
      });
      lastFetchAt.value = Date.now();
      hasUnfetched.value = false;
      await refresh();
      return summary;
    };
    try {
      return await run();
    } catch (e) {
      const retryOk = await handleAuthFailure(e, {
        title: String(i18n.global.t("auth.title")),
        url: remotes.value[0]?.fetchUrl,
      });
      if (retryOk) {
        try {
          return await run();
        } catch (e2) {
          toast({
            title: "Fetch failed",
            description: formatErrorMessage(e2),
            persistent: true,
          });
          throw e2;
        }
      }
      toast({
        title: "Fetch failed",
        description: formatErrorMessage(e),
        persistent: true,
        action: {
          label: String(i18n.global.t("auth.enterCredentials")),
          onClick: () => {
            void handleAuthFailure(e, {
              title: String(i18n.global.t("auth.title")),
              url: remotes.value[0]?.fetchUrl,
            }).then((ok) => {
              if (ok) void fetch(remote);
            });
          },
        },
      });
      throw e;
    } finally {
      jobs.finished(jobId);
    }
  }

  async function checkIncoming() {
    const ws = workspace();
    const policy = settings().settings?.git?.checkIncoming ?? "auto";
    const path = ws.repoPath;
    if (policy === "never" || !path || !remotes.value.length) {
      hasUnfetched.value = false;
      return;
    }
    try {
      const remote = remotes.value[0]?.name ?? "origin";
      const res = await getBackend().lsRemoteCheck({ path, remote });
      hasUnfetched.value = res.hasUnfetched;
    } catch {
      /* silent for auto */
    }
  }

  function openPopup() {
    popupOpen.value = true;
    void refresh();
  }

  function closePopup() {
    popupOpen.value = false;
    search.value = "";
  }

  return {
    refs,
    remotes,
    loading,
    error,
    popupOpen,
    search,
    hasUnfetched,
    lastFetchAt,
    selectedFullName,
    filteredLocal,
    filteredRemote,
    filteredTags,
    refresh,
    toggleFavorite,
    checkout,
    createBranch,
    renameBranch,
    deleteBranch,
    restoreBranch,
    updateBranch,
    fetch,
    checkIncoming,
    openPopup,
    closePopup,
  };
});

function filterRefs(list: RefEntry[], q: string): RefEntry[] {
  const query = q.trim().toLowerCase();
  if (!query) return list;
  return list.filter(
    (r) =>
      r.name.toLowerCase().includes(query) ||
      r.fullName.toLowerCase().includes(query) ||
      (r.subject?.toLowerCase().includes(query) ?? false),
  );
}
