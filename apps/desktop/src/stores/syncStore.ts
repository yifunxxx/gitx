import { defineStore } from "pinia";
import { ref, watch } from "vue";
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
import { isAuthError } from "@/lib/auth";
import { i18n } from "@/i18n";
import { submoduleFeedback } from "@/lib/submoduleFeedback";
import { useConflictsStore } from "./conflictsStore";
import { useRewriteStore } from "./rewriteStore";
import { useStashShelfStore } from "./stashShelfStore";

export const useSyncStore = defineStore("sync", () => {
  const lastUpdate = ref<UpdateInfo | null>(null);
  const pushing = ref(false);
  const updating = ref(false);
  const pulling = ref(false);
  const workspace = useWorkspaceStore();
  let generation = 0;
  watch(
    () => workspace.repoPath,
    () => {
      ++generation;
      lastUpdate.value = null;
    },
    { flush: "sync" },
  );

  async function afterSync(request = generation) {
    if (request !== generation) return;
    await useBranchesStore().refresh();
    if (request !== generation) return;
    await useChangesStore().refresh();
    if (request !== generation) return;
    await useLogStore().load(true, true);
  }

  async function onAuthOrToast<T>(
    title: string,
    e: unknown,
    retry: () => Promise<T>,
    url: string | null,
    request: number,
  ): Promise<T> {
    if (request !== generation) throw e;
    const retryOk = await handleAuthFailure(e, { title: i18n.global.t("auth.title"), url });
    if (retryOk) {
      if (request !== generation) throw e;
      return retry();
    }
    toast({
      title,
      description: formatErrorMessage(e),
      persistent: true,
      action: isAuthError(e)
        ? {
            label: String(i18n.global.t("auth.enterCredentials")),
            onClick: () => {
              if (request !== generation) return;
              void handleAuthFailure(e, { title: i18n.global.t("auth.title"), url })
                .then(async (ok) => {
                  if (ok && request === generation) await retry();
                })
                .catch((error) => toast({ title, description: formatErrorMessage(error) }));
            },
          }
        : undefined,
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
    if (pulling.value) return;
    if (!ws.repoPath) {
      toast({ title: "Pull failed", description: "No repository open" });
      return;
    }
    const path = ws.repoPath;
    const request = generation;
    const url = useBranchesStore().remotes.find((r) => r.name === opts.remote)?.fetchUrl ?? null;
    const jobs = useJobsStore();
    const jobId = `pull-${Date.now()}`;
    pulling.value = true;
    jobs.started({
      id: jobId,
      title: `Pulling ${opts.remote}/${opts.branch}…`,
    });
    const run = async () => {
      const result = await getBackend().pullRun({
        path,
        remote: opts.remote,
        branch: opts.branch,
        rebase: !!opts.rebase,
        ffOnly: !!opts.ffOnly,
        noFf: !!opts.noFf,
        squash: !!opts.squash,
        noCommit: !!opts.noCommit,
        noVerify: !!opts.noVerify,
      });
      if (request !== generation) return result;
      const message = i18n.global.t(
        !result.updated
          ? "syncUi.upToDate"
          : result.oldHead === result.newHead
            ? "syncUi.commitRequired"
            : "syncUi.pulled",
      );
      if (result.updated) {
        lastUpdate.value = {
          oldHead: result.oldHead,
          newHead: result.newHead,
          strategy: result.strategy,
          updatedFiles: result.updatedFiles,
          commits: result.commits,
          message,
          submodules: null,
          submoduleError: null,
        };
        useLayoutStore().activeBottomTab = "update";
        useLayoutStore().bottomOpen = true;
      }
      toast({ title: message });
      await afterSync(request);
      return result;
    };
    try {
      return await run();
    } catch (e) {
      return await onAuthOrToast("Pull failed", e, run, url, request);
    } finally {
      pulling.value = false;
      jobs.finished(jobId);
    }
  }

  async function updateProject(strategy: UpdateMethod) {
    const ws = useWorkspaceStore();
    if (updating.value) return;
    if (!ws.repoPath) {
      toast({ title: "Update Project failed", description: "No repository open" });
      return;
    }
    const path = ws.repoPath;
    const request = generation;
    const url = useBranchesStore().remotes[0]?.fetchUrl ?? null;
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
      const info = await getBackend()
        .updateProjectRun({
          path,
          strategy,
        })
        .catch(async (error) => {
          // An update can stop after changing HEAD, creating conflicts or saving
          // local work. Publish that state before showing the recovery message.
          if (request === generation) {
            await Promise.allSettled([
              afterSync(request),
              useConflictsStore().refresh(),
              useRewriteStore().refreshOpState(),
              useStashShelfStore().refresh(),
            ]);
          }
          throw error;
        });
      if (request !== generation) return info;
      lastUpdate.value = info;
      const moduleFeedback = info.submodules ? submoduleFeedback(info.submodules) : null;
      const attention = !!info.submoduleError || !!moduleFeedback?.persistent;
      const modulesChanged = info.submodules?.items.some(
        (item) => item.updated && item.oldSha !== item.newSha,
      );
      if (info.oldHead !== info.newHead || attention || modulesChanged) {
        useLayoutStore().activeBottomTab = "update";
        useLayoutStore().bottomOpen = true;
        toast({
          title: attention
            ? i18n.global.t("syncUi.updateSubmodulesIncomplete")
            : info.oldHead === info.newHead && modulesChanged
              ? moduleFeedback!.title
              : info.message,
          description: info.submoduleError || moduleFeedback?.description,
          persistent: true,
        });
      } else {
        toast({ title: info.message || "All files are up-to-date" });
      }
      await afterSync(request);
      return info;
    };
    try {
      return await run();
    } catch (e) {
      return await onAuthOrToast("Update Project failed", e, run, url, request);
    } finally {
      updating.value = false;
      jobs.finished(jobId);
    }
  }

  async function previewPush(
    remote?: string,
    branch?: string,
    remoteBranch?: string,
  ): Promise<PushPreview | null> {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    return getBackend().pushPreview({
      path: ws.repoPath,
      remote: remote ?? null,
      branch: branch ?? null,
      remoteBranch: remoteBranch ?? null,
    });
  }

  async function push(opts: {
    remote: string;
    branch: string;
    remoteBranch?: string;
    setUpstream: boolean;
    forceWithLease: boolean;
    pushTags?: string | null;
  }) {
    const ws = useWorkspaceStore();
    if (pushing.value) return;
    if (!ws.repoPath) {
      toast({ title: "Push failed", description: "No repository open" });
      return;
    }
    const path = ws.repoPath;
    const request = generation;
    const remote = useBranchesStore().remotes.find((r) => r.name === opts.remote);
    const url = remote?.pushUrl ?? remote?.fetchUrl ?? null;
    const jobs = useJobsStore();
    const jobId = `push-${Date.now()}`;
    pushing.value = true;
    jobs.started({
      id: jobId,
      title: `Pushing to ${opts.remote}/${opts.branch}…`,
    });
    const run = async () => {
      const result = await getBackend().pushRun({
        path,
        remote: opts.remote,
        branch: opts.branch,
        remoteBranch: opts.remoteBranch ?? null,
        setUpstream: opts.setUpstream,
        forceWithLease: opts.forceWithLease,
        pushTags: opts.pushTags ?? null,
      });
      if (request !== generation) return result;
      if (result.rejected) {
        toast({
          title: "Push rejected",
          description: result.message,
          persistent: true,
        });
      } else {
        toast({ title: result.message });
      }
      await afterSync(request);
      return result;
    };
    try {
      return await run();
    } catch (e) {
      return await onAuthOrToast("Push failed", e, run, url, request);
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
