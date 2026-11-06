import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { PushPreview, UpdateInfo, UpdateMethod } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useBranchesStore } from "./branchesStore";
import { useChangesStore } from "./changesStore";
import { useLogStore } from "./logStore";
import { useLayoutStore } from "./layoutStore";
import { toast } from "@/composables/useToast";

export const useSyncStore = defineStore("sync", () => {
  const lastUpdate = ref<UpdateInfo | null>(null);
  const pushing = ref(false);
  const updating = ref(false);

  async function afterSync() {
    await useBranchesStore().refresh();
    await useChangesStore().refresh();
    await useLogStore().load(true);
  }

  async function pull(opts: {
    remote: string;
    branch: string;
    rebase?: boolean;
    ffOnly?: boolean;
    noFf?: boolean;
    squash?: boolean;
    noCommit?: boolean;
    noVerify?: boolean;
  }) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return;
    const result = await getBackend().pullRun({
      path: ws.repoPath,
      remote: opts.remote,
      branch: opts.branch,
      rebase: !!opts.rebase,
      ffOnly: !!opts.ffOnly,
      noFf: !!opts.noFf,
      squash: !!opts.squash,
      noCommit: !!opts.noCommit,
      noVerify: !!opts.noVerify,
    });
    if (result.updated) {
      lastUpdate.value = {
        oldHead: result.oldHead,
        newHead: result.newHead,
        strategy: result.strategy,
        updatedFiles: [],
        commits: [],
        message: result.message,
      };
      useLayoutStore().activeBottomTab = "update";
      useLayoutStore().bottomOpen = true;
    }
    toast({ title: result.message });
    await afterSync();
    return result;
  }

  async function updateProject(strategy: UpdateMethod) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return;
    updating.value = true;
    try {
      const info = await getBackend().updateProjectRun({
        path: ws.repoPath,
        strategy,
      });
      lastUpdate.value = info;
      if (info.oldHead !== info.newHead) {
        useLayoutStore().activeBottomTab = "update";
        useLayoutStore().bottomOpen = true;
        toast({ title: info.message, persistent: true });
      } else {
        toast({ title: "All files are up-to-date" });
      }
      await afterSync();
      return info;
    } finally {
      updating.value = false;
    }
  }

  async function previewPush(remote?: string): Promise<PushPreview | null> {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    return getBackend().pushPreview({ path: ws.repoPath, remote: remote ?? null });
  }

  async function push(opts: {
    remote: string;
    branch: string;
    setUpstream: boolean;
    forceWithLease: boolean;
    pushTags?: string | null;
  }) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return;
    pushing.value = true;
    try {
      const result = await getBackend().pushRun({
        path: ws.repoPath,
        remote: opts.remote,
        branch: opts.branch,
        setUpstream: opts.setUpstream,
        forceWithLease: opts.forceWithLease,
        pushTags: opts.pushTags ?? null,
      });
      if (result.rejected) {
        toast({
          title: "Push rejected",
          description: result.message,
          persistent: true,
        });
      } else {
        toast({ title: result.message });
      }
      await afterSync();
      return result;
    } finally {
      pushing.value = false;
    }
  }

  return {
    lastUpdate,
    pushing,
    updating,
    pull,
    updateProject,
    previewPush,
    push,
    afterSync,
  };
});
