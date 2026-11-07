import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { PushPreview, UpdateInfo, UpdateMethod } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useBranchesStore } from "./branchesStore";
import { useChangesStore } from "./changesStore";
import { useLogStore } from "./logStore";
import { useLayoutStore } from "./layoutStore";
import { useJobsStore } from "./jobsStore";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";
import { handleAuthFailure } from "@/composables/useCredentials";
import { i18n } from "@/i18n";

export const useSyncStore = defineStore("sync", () => {
  const lastUpdate = ref<UpdateInfo | null>(null);
  const pushing = ref(false);
  const updating = ref(false);
  const pulling = ref(false);

  async function afterSync() {
    await useBranchesStore().refresh();
    await useChangesStore().refresh();
    await useLogStore().load(true);
  }

  async function onAuthOrToast<T>(
    title: string,
    e: unknown,
    retry: () => Promise<T>,
  ): Promise<T> {
    const retryOk = await handleAuthFailure(e, { title: i18n.global.t("auth.title") });
    if (retryOk) {
      return retry();
    }
    toast({
      title,
      description: formatErrorMessage(e),
      persistent: true,
      action: {
        label: String(i18n.global.t("auth.enterCredentials")),
        onClick: () => {
          void handleAuthFailure(e, { title: i18n.global.t("auth.title") }).then((ok) => {
            if (ok) void retry();
          });
        },
      },
    });
    throw e;
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
    if (!ws.repoPath) {
      toast({ title: "Pull failed", description: "No repository open" });
      return;
    }
    const jobs = useJobsStore();
    const jobId = `pull-${Date.now()}`;
    pulling.value = true;
    jobs.started({
      id: jobId,
      title: `Pulling ${opts.remote}/${opts.branch}…`,
    });
    const run = async () => {
      const result = await getBackend().pullRun({
        path: ws.repoPath!,
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
    };
    try {
      return await run();
    } catch (e) {
      return await onAuthOrToast("Pull failed", e, run);
    } finally {
      pulling.value = false;
      jobs.finished(jobId);
    }
  }

  async function updateProject(strategy: UpdateMethod) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) {
      toast({ title: "Update Project failed", description: "No repository open" });
      return;
    }
    const jobs = useJobsStore();
    const jobId = `update-project-${Date.now()}`;
    updating.value = true;
    jobs.started({
      id: jobId,
      title: `Updating project (${strategy})…`,
      message: "Fetching…",
    });
    const run = async () => {
      jobs.progress(jobId, { message: "Fetching & updating…" });
      const info = await getBackend().updateProjectRun({
        path: ws.repoPath!,
        strategy,
      });
      lastUpdate.value = info;
      if (info.oldHead !== info.newHead) {
        useLayoutStore().activeBottomTab = "update";
        useLayoutStore().bottomOpen = true;
        toast({ title: info.message, persistent: true });
      } else {
        toast({ title: info.message || "All files are up-to-date" });
      }
      await afterSync();
      return info;
    };
    try {
      return await run();
    } catch (e) {
      return await onAuthOrToast("Update Project failed", e, run);
    } finally {
      updating.value = false;
      jobs.finished(jobId);
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
    if (!ws.repoPath) {
      toast({ title: "Push failed", description: "No repository open" });
      return;
    }
    const jobs = useJobsStore();
    const jobId = `push-${Date.now()}`;
    pushing.value = true;
    jobs.started({
      id: jobId,
      title: `Pushing to ${opts.remote}/${opts.branch}…`,
    });
    const run = async () => {
      const result = await getBackend().pushRun({
        path: ws.repoPath!,
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
    };
    try {
      return await run();
    } catch (e) {
      return await onAuthOrToast("Push failed", e, run);
    } finally {
      pushing.value = false;
      jobs.finished(jobId);
    }
  }

  return {
    lastUpdate,
    pushing,
    updating,
    pulling,
    pull,
    updateProject,
    previewPush,
    push,
    afterSync,
  };
});
