import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { getBackend } from "@/lib/backend";
import type { MultiRootOpResult, RefEntry, RefsList, RemoteInfo } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useSettingsStore } from "./settingsStore";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";
import { handleAuthFailure } from "@/composables/useCredentials";
import { i18n } from "@/i18n";
import { useJobsStore } from "./jobsStore";
import { useChangesStore } from "./changesStore";
import { useLogStore } from "./logStore";

export const useBranchesStore = defineStore("branches", () => {
  const refs = ref<RefsList | null>(null);
  const remotes = ref<RemoteInfo[]>([]);
  const loading = ref(false);
  const checkingOut = ref(false);
  const error = ref<string | null>(null);
  const popupOpen = ref(false);
  const search = ref("");
  const hasUnfetched = ref(false);
  const lastFetchAt = ref<number | null>(null);
  const selectedFullName = ref<string | null>(null);

  const workspace = () => useWorkspaceStore();
  const settings = () => useSettingsStore();
  let refreshGeneration = 0;
  watch(
    () => workspace().repoPath,
    () => {
      ++refreshGeneration;
      refs.value = null;
      remotes.value = [];
      selectedFullName.value = null;
      search.value = "";
      popupOpen.value = false;
      loading.value = false;
      error.value = null;
    },
    { flush: "sync" },
  );

  const filteredLocal = computed(() => filterRefs(refs.value?.local ?? [], search.value));
  const filteredRemote = computed(() => filterRefs(refs.value?.remote ?? [], search.value));
  const filteredTags = computed(() => filterRefs(refs.value?.tags ?? [], search.value));

  async function refresh() {
    const generation = ++refreshGeneration;
    const ws = workspace();
    const path = ws.repoPath;
    const navigation = ws.navigationToken();
    const current = () =>
      generation === refreshGeneration &&
      ws.repoPath === path &&
      ws.navigationToken() === navigation;
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
      if (!current()) return;
      refs.value = list;
      remotes.value = remoteList;
    } catch (e) {
      if (current()) error.value = formatErrorMessage(e);
    } finally {
      if (generation === refreshGeneration) loading.value = false;
    }
  }

  async function toggleFavorite(entry: RefEntry) {
    const ws = workspace();
    if (!ws.gitDir || !refs.value) return;
    const full = entry.fullName;
    const current = [...refs.value.local, ...refs.value.remote, ...refs.value.tags]
      .filter((r) => r.isFavorite)
      .map((r) => r.fullName);
    const next = current.includes(full) ? current.filter((f) => f !== full) : [...current, full];
    await getBackend().favoritesSet({ gitDir: ws.gitDir, favorites: next });
    await refresh();
  }

  async function checkout(entry: RefEntry): Promise<boolean> {
    const ws = workspace();
    const path = ws.repoPath;
    if (!path || checkingOut.value) return false;
    const navigation = ws.navigationToken();
    const current = () => ws.repoPath === path && ws.navigationToken() === navigation;
    const mode =
      entry.kind === "remoteBranch" ? "remote" : entry.kind === "tag" ? "revision" : "local";
    const checkoutTarget = entry.kind === "tag" ? entry.fullName : entry.name;
    const allRoots =
      settings().settings?.git?.executeBranchOpsOnAllRoots !== false &&
      ws.multiRoot &&
      ws.roots.length > 1;
    const refreshCurrent = async () => {
      try {
        if (!current()) return;
        await refresh();
        if (!current()) return;
        if (error.value) throw new Error(error.value);
        await useChangesStore().refresh();
        if (!current()) return;
        await useLogStore().load(true);
      } catch (reason) {
        if (current())
          toast({
            title: i18n.global.t("branches.refreshFailed"),
            description: formatErrorMessage(reason),
            persistent: true,
          });
      }
    };
    const describe = (result: MultiRootOpResult) =>
      result.steps
        .flatMap((step) => [
          ...(step.error ? [`${step.path}: ${step.error}`] : []),
          ...(step.rollbackError
            ? [`${step.path}: ${i18n.global.t("branches.rollbackFailed")} — ${step.rollbackError}`]
            : []),
        ])
        .join("\n");
    const reportFailure = (result: MultiRootOpResult, recoveryError?: unknown) => {
      if (!current()) return;
      toast({
        title: i18n.global.t("branches.multiRootFailed"),
        description: [
          describe(result),
          ...(recoveryError ? [formatErrorMessage(recoveryError)] : []),
          i18n.global.t(
            result.rolledBack ? "branches.rootsRestored" : "branches.rollbackIncomplete",
          ),
        ].join("\n\n"),
        persistent: true,
        action: result.rolledBack
          ? undefined
          : {
              label: i18n.global.t("branches.retryRollback"),
              disabled: () => !current() || checkingOut.value,
              onClick: () => {
                if (!current() || checkingOut.value) return false;
                checkingOut.value = true;
                void (async () => {
                  try {
                    const recovery = await getBackend().multiRootRollback({ steps: result.steps });
                    if (!current()) return;
                    if (recovery.ok && recovery.rolledBack)
                      toast({ title: i18n.global.t("branches.rootsRestored") });
                    else reportFailure(recovery);
                  } catch (reason) {
                    reportFailure(result, reason);
                  } finally {
                    await refreshCurrent();
                    checkingOut.value = false;
                  }
                })().catch((reason) => {
                  checkingOut.value = false;
                  if (current())
                    toast({
                      title: i18n.global.t("branches.rollbackFailed"),
                      description: formatErrorMessage(reason),
                      persistent: true,
                    });
                });
              },
            },
      });
    };
    checkingOut.value = true;
    try {
      if (allRoots) {
        const result = await getBackend().multiRootCheckout({
          roots: ws.roots.map((root) => root.worktreeRoot),
          target: checkoutTarget,
          mode,
          rollbackOnFail: true,
        });
        if (!current()) return false;
        if (!result.ok) {
          reportFailure(result);
          return false;
        }
        if (result.steps.some((step) => step.skipped)) {
          toast({
            title: i18n.global.t("branches.multiRootSkipped"),
            description: describe(result),
            persistent: true,
          });
          if (result.steps.every((step) => step.skipped)) return false;
        }
      } else {
        await getBackend().branchCheckout({ path, target: checkoutTarget, mode });
      }
    } catch (reason) {
      if (current())
        toast({
          title: i18n.global.t("branches.checkoutFailed"),
          description: formatErrorMessage(reason),
          persistent: true,
        });
      return false;
    } finally {
      try {
        await refreshCurrent();
      } finally {
        checkingOut.value = false;
      }
    }
    return current();
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
    checkingOut,
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
