import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";

export const useWorkspaceStore = defineStore("workspace", () => {
  const folderPath = ref<string | null>(null);
  const isRepo = ref(false);
  const gitDir = ref<string | null>(null);
  const toplevel = ref<string | null>(null);
  const gitVersion = ref<string | null>(null);
  const gitPath = ref<string | null>(null);

  async function detectGit() {
    const backend = getBackend();
    const info = await backend.gitDetect();
    gitVersion.value = info.version;
    gitPath.value = info.path;
    return info;
  }

  async function openFolder(path: string) {
    const backend = getBackend();
    const res = await backend.workspaceOpen({ path });
    folderPath.value = res.path;
    isRepo.value = res.isRepo;
    gitDir.value = res.gitDir;
    toplevel.value = res.toplevel;
    return res;
  }

  return {
    folderPath,
    isRepo,
    gitDir,
    toplevel,
    gitVersion,
    gitPath,
    detectGit,
    openFolder,
  };
});
