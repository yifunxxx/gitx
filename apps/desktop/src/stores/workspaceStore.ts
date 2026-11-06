import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { BranchInfo, RepoRoot, WslPathInfo } from "@/lib/backend";

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
      gitError.value = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  async function loadRecent() {
    const backend = getBackend();
    const res = await backend.workspaceRecent();
    recent.value = res.paths;
  }

  async function openFolder(path: string) {
    const backend = getBackend();
    const res = await backend.workspaceOpen({ path });
    applyOpenRes(res);
    await loadRecent();
    return res;
  }

  async function refreshRoots() {
    if (!folderPath.value || !isRepo.value) return;
    const discovered = await getBackend().repoDiscover({ path: folderPath.value });
    roots.value = discovered;
    if (!roots.value.find((r) => r.id === activeRepoId.value)) {
      activeRepoId.value = roots.value[0]?.id ?? null;
    }
  }

  function setActiveRepo(id: string) {
    if (roots.value.some((r) => r.id === id)) {
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
    const backend = getBackend();
    const res = await backend.initRun({ path, initialBranch });
    applyOpenRes(res);
    await loadRecent();
    return res;
  }

  async function enableVcs(initialBranch = "main") {
    if (!folderPath.value) throw new Error("No folder open");
    const backend = getBackend();
    const res = await backend.vcsEnable({
      path: folderPath.value,
      initialBranch,
    });
    applyOpenRes({ ...res, path: folderPath.value });
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
