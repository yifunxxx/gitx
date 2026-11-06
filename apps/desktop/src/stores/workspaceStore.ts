import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { BranchInfo } from "@/lib/backend";

export const useWorkspaceStore = defineStore("workspace", () => {
  const folderPath = ref<string | null>(null);
  const isRepo = ref(false);
  const gitDir = ref<string | null>(null);
  const toplevel = ref<string | null>(null);
  const gitVersion = ref<string | null>(null);
  const gitPath = ref<string | null>(null);
  const recent = ref<string[]>([]);
  const branch = ref<BranchInfo | null>(null);

  const repoId = computed(() => toplevel.value ?? folderPath.value);
  const repoPath = computed(() => toplevel.value ?? folderPath.value);

  async function detectGit() {
    const backend = getBackend();
    const info = await backend.gitDetect();
    gitVersion.value = info.version;
    gitPath.value = info.path;
    return info;
  }

  async function loadRecent() {
    const backend = getBackend();
    const res = await backend.workspaceRecent();
    recent.value = res.paths;
  }

  async function openFolder(path: string) {
    const backend = getBackend();
    const res = await backend.workspaceOpen({ path });
    folderPath.value = res.path;
    isRepo.value = res.isRepo;
    gitDir.value = res.gitDir;
    toplevel.value = res.toplevel;
    await loadRecent();
    return res;
  }

  async function initRepo(path: string, initialBranch = "main") {
    const backend = getBackend();
    const res = await backend.initRun({ path, initialBranch });
    folderPath.value = res.path;
    isRepo.value = res.isRepo;
    gitDir.value = res.gitDir;
    toplevel.value = res.toplevel;
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
    isRepo.value = res.isRepo;
    gitDir.value = res.gitDir;
    toplevel.value = res.toplevel;
    return res;
  }

  function setBranch(info: BranchInfo | null) {
    branch.value = info;
  }

  return {
    folderPath,
    isRepo,
    gitDir,
    toplevel,
    gitVersion,
    gitPath,
    recent,
    branch,
    repoId,
    repoPath,
    detectGit,
    loadRecent,
    openFolder,
    initRepo,
    enableVcs,
    setBranch,
  };
});
