import { defineStore } from "pinia";
import { computed, onScopeDispose, ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { BranchInfo, RepoRoot, WslPathInfo } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";
import { toast } from "@/composables/useToast";
import { i18n } from "@/i18n";

export const useWorkspaceStore = defineStore("workspace", () => {
  const folderPath = ref<string | null>(null);
  const isRepo = ref(false);
  const gitDir = ref<string | null>(null);
  const commonDir = ref<string | null>(null);
  const toplevel = ref<string | null>(null);
  const isWorktree = ref(false);
  const wsl = ref<WslPathInfo | null>(null);
  const roots = ref<RepoRoot[]>([]);
  const activeRepoId = ref<string | null>(null);
  const gitVersion = ref<string | null>(null);
  const gitPath = ref<string | null>(null);
  const gitError = ref<string | null>(null);
  const recent = ref<string[]>([]);
  const branch = ref<BranchInfo | null>(null);
  const openGeneration = ref(0);
  let rootsGeneration = 0;
  let recentGeneration = 0;
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    ++recentGeneration;
  });

  const activeRoot = computed(
    () => roots.value.find((r) => r.id === activeRepoId.value) ?? roots.value[0] ?? null,
  );
  const repoId = computed(() => activeRoot.value?.id ?? toplevel.value ?? folderPath.value);
  const repoPath = computed(
    () => activeRoot.value?.worktreeRoot ?? toplevel.value ?? folderPath.value,
  );
  const multiRoot = computed(() => roots.value.length > 1);

  function applyOpenRes(res: {
    path: string;
    isRepo: boolean;
    gitDir: string | null;
    commonDir?: string | null;
    toplevel: string | null;
    isWorktree?: boolean | null;
    wsl?: WslPathInfo | null;
    roots?: RepoRoot[];
  }) {
    branch.value = null;
    folderPath.value = res.path;
    isRepo.value = res.isRepo;
    gitDir.value = res.gitDir;
    commonDir.value = res.commonDir ?? res.gitDir;
    toplevel.value = res.toplevel;
    isWorktree.value = !!res.isWorktree;
    wsl.value = res.wsl ?? null;
    roots.value = res.roots?.length
      ? res.roots
      : res.isRepo && res.toplevel
        ? [
            {
              id: res.toplevel,
              worktreeRoot: res.toplevel,
              gitDir: res.gitDir ?? `${res.toplevel}/.git`,
              commonDir: res.commonDir ?? res.gitDir ?? `${res.toplevel}/.git`,
              isWorktree: !!res.isWorktree,
              displayName: res.toplevel.split(/[/\\]/).pop() ?? "repo",
              color: "#3b82f6",
              isSubmodule: false,
            },
          ]
        : [];
    activeRepoId.value = roots.value[0]?.id ?? null;
  }

  async function detectGit() {
    const backend = getBackend();
    try {
      const info = await backend.gitDetect();
      gitVersion.value = info.version;
      gitPath.value = info.path;
      gitError.value = null;
      return info;
    } catch (e) {
      gitVersion.value = null;
      gitPath.value = null;
      gitError.value = formatErrorMessage(e);
      throw e;
    }
  }

  async function loadRecent() {
    if (disposed) return;
    const generation = ++recentGeneration;
    try {
      const res = await getBackend().workspaceRecent();
      if (generation === recentGeneration) recent.value = res.paths;
    } catch (error) {
      if (generation !== recentGeneration) return;
      // This shared list is auxiliary: keep the last known entries and report
      // its failure without aborting a successful open or startup Git detection.
      toast({
        title: i18n.global.t("welcome.recentRefreshFailed"),
        description: formatErrorMessage(error),
      });
    }
  }

  async function openFolder(path: string) {
    const generation = ++openGeneration.value;
    const backend = getBackend();
    const res = await backend.workspaceOpen({ path });
    if (generation !== openGeneration.value) return res;
    applyOpenRes(res);
    // Recent projects are auxiliary. Their IPC must not delay the initial
    // repository reads; loadRecent handles errors and obsolete completions.
    void loadRecent();
    return res;
  }

  async function refreshRoots() {
    if (!folderPath.value || !isRepo.value) return;
    const path = folderPath.value;
    const open = openGeneration.value;
    const generation = ++rootsGeneration;
    const discovered = await getBackend().repoDiscover({ path });
    if (path !== folderPath.value || open !== openGeneration.value || generation !== rootsGeneration)
      return;
    roots.value = discovered;
    if (!roots.value.find((r) => r.id === activeRepoId.value)) {
      activeRepoId.value = roots.value[0]?.id ?? null;
    }
  }

  function setActiveRepo(id: string) {
    if (roots.value.some((r) => r.id === id)) {
      if (activeRepoId.value !== id) {
        ++openGeneration.value;
        branch.value = null;
      }
      activeRepoId.value = id;
      const root = roots.value.find((r) => r.id === id);
      if (root) {
        gitDir.value = root.gitDir;
        commonDir.value = root.commonDir;
        toplevel.value = root.worktreeRoot;
        isWorktree.value = root.isWorktree;
      }
    }
  }

  async function initRepo(path: string, initialBranch = "main") {
    const generation = ++openGeneration.value;
    const backend = getBackend();
    const res = await backend.initRun({ path, initialBranch });
    if (generation !== openGeneration.value) return res;
    applyOpenRes(res);
    void loadRecent();
    return res;
  }

  async function enableVcs(initialBranch = "main") {
    if (!folderPath.value) throw new Error("No folder open");
    const path = folderPath.value;
    const generation = ++openGeneration.value;
    const backend = getBackend();
    const res = await backend.vcsEnable({
      path,
      initialBranch,
    });
    if (generation === openGeneration.value) applyOpenRes({ ...res, path });
    return res;
  }

  function setBranch(info: BranchInfo | null) {
    branch.value = info;
  }

  return {
    folderPath,
    isRepo,
    gitDir,
    commonDir,
    toplevel,
    isWorktree,
    wsl,
    roots,
    activeRepoId,
    activeRoot,
    multiRoot,
    gitVersion,
    gitPath,
    gitError,
    recent,
    branch,
    repoId,
    repoPath,
    navigationToken: () => openGeneration.value,
    detectGit,
    loadRecent,
    openFolder,
    refreshRoots,
    setActiveRepo,
    initRepo,
    enableVcs,
    setBranch,
  };
});
