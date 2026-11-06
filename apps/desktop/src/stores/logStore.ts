import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { ChangedFile, CommitDetails, LogCommit } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";

export const useLogStore = defineStore("log", () => {
  const commits = ref<LogCommit[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const truncated = ref(false);
  const nextOffset = ref(0);
  const selectedSha = ref<string | null>(null);
  const details = ref<CommitDetails | null>(null);
  const changedFiles = ref<ChangedFile[]>([]);

  async function load(reset = true) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId || !workspace.isRepo) {
      commits.value = [];
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const backend = getBackend();
      const offset = reset ? 0 : nextOffset.value;
      const page = await backend.logQuery({
        repoId: workspace.repoId,
        path: workspace.repoPath,
        offset,
        limit: 100,
      });
      commits.value = reset ? page.commits : [...commits.value, ...page.commits];
      truncated.value = page.truncated;
      nextOffset.value = page.nextOffset;
      if (!selectedSha.value && page.commits[0]) {
        await select(page.commits[0].sha);
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function select(sha: string) {
    selectedSha.value = sha;
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    const backend = getBackend();
    const [d, files] = await Promise.all([
      backend.logCommitDetails({ path: workspace.repoPath, sha }),
      backend.logChangedFiles({ path: workspace.repoPath, sha }),
    ]);
    details.value = d;
    changedFiles.value = files;
  }

  async function loadMore() {
    if (!truncated.value || loading.value) return;
    await load(false);
  }

  return {
    commits,
    loading,
    error,
    truncated,
    selectedSha,
    details,
    changedFiles,
    load,
    select,
    loadMore,
  };
});
