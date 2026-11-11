import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { RebasePlan, RepoOpState, ResetMode, RewriteHead, RewriteResult } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useChangesStore } from "./changesStore";
import { useLogStore } from "./logStore";
import { useBranchesStore } from "./branchesStore";
import { useConflictsStore } from "./conflictsStore";
import { toast } from "@/composables/useToast";
import { openDialog, useDialogStack } from "@/composables/useDialog";
import DirtyWorktreeDialog from "@/features/merge/DirtyWorktreeDialog.vue";
import ConflictsDialog from "@/features/merge/ConflictsDialog.vue";
import { i18n } from "@/i18n";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { formatErrorMessage, invokeErrorCode } from "@/lib/errors";
import { rewriteResultTitle, type RewriteOperation } from "@/lib/rewriteFeedback";

type OperationContext = ReturnType<ReturnType<typeof useRepositoryAction>>;

export const useRewriteStore = defineStore("rewrite", () => {
  const opState = ref<RepoOpState | null>(null);
  const busy = ref(false);
  const lastBackupRef = ref<string | null>(null);
  const lastUndoHead = ref<RewriteHead | null>(null);
  const canUndo = computed(
    () =>
      !!lastBackupRef.value &&
      !!lastUndoHead.value &&
      !busy.value &&
      (!opState.value || opState.value.kind === "normal"),
  );

  let refreshGeneration = 0;
  let repositoryGeneration = 0;
  const captureOperation = useRepositoryAction(() => {
    ++refreshGeneration;
    ++repositoryGeneration;
    opState.value = null;
    lastBackupRef.value = null;
    lastUndoHead.value = null;
  });
  const isCurrent = (context: OperationContext) => context.current();
  const repositoryToken = () => repositoryGeneration;

  async function afterRewrite(context: OperationContext = captureOperation()) {
    if (!isCurrent(context)) return;
    await refreshOpState();
    if (!isCurrent(context)) return;
    await useChangesStore().refresh();
    if (!isCurrent(context)) return;
    await useLogStore().load(true);
    if (!isCurrent(context)) return;
    await useBranchesStore().refresh();
    if (!isCurrent(context)) return;
    if (
      opState.value &&
      opState.value.kind !== "normal" &&
      (opState.value.conflictCount ?? 0) > 0
    ) {
      await useConflictsStore().refresh();
      if (!isCurrent(context)) return;
      if (!useDialogStack().value.some((dialog) => dialog.component === ConflictsDialog)) {
        void openDialog(ConflictsDialog, {});
      }
    }
  }

  async function refreshOpState() {
    const generation = ++refreshGeneration;
    const context = captureOperation();
    const current = () => generation === refreshGeneration && context.current();
    if (!context.path || !current()) {
      opState.value = null;
      return null;
    }
    try {
      const result = await getBackend().repoOpStateGet({ path: context.path });
      if (!current()) return null;
      opState.value = result;
      return result;
    } catch (error) {
      if (current()) throw error;
      return null;
    }
  }

  async function refreshAfterSuccess(context: OperationContext) {
    try {
      await afterRewrite(context);
    } catch (error) {
      if (isCurrent(context))
        toast({
          title: i18n.global.t("rewrite.refreshFailed"),
          description: formatErrorMessage(error),
          persistent: true,
        });
    }
  }

  async function handleResult(
    result: RewriteResult,
    operation: RewriteOperation,
    context: OperationContext,
  ) {
    if (!isCurrent(context)) return result;
    if (result.backupRef) {
      lastBackupRef.value = result.backupRef;
      lastUndoHead.value = result.undoHead ?? null;
    }
    const title = rewriteResultTitle(result, operation);
    if (result.outcome === "conflicts") {
      toast({ title });
    } else if (result.backupRef && result.undoHead) {
      toast({
        title,
        action: {
          label: i18n.global.t("rewrite.undo"),
          disabled: () => busy.value || !isCurrent(context),
          onClick: () => {
            if (busy.value || !isCurrent(context)) return false;
            void undoWithFeedback(result.backupRef!, result.undoHead!);
          },
        },
      });
    } else {
      toast({ title });
    }
    await refreshAfterSuccess(context);
    return result;
  }

  async function undoWithFeedback(backupRef?: string, expectedHead?: RewriteHead) {
    const context = captureOperation();
    try {
      return await undoLast(backupRef, expectedHead);
    } catch (error) {
      if (isCurrent(context))
        toast({
          title: i18n.global.t("rewrite.undoFailed"),
          persistent: true,
          description:
            invokeErrorCode(error) === "staleUndo"
              ? i18n.global.t("rewrite.staleUndo")
              : formatErrorMessage(error),
        });
      return null;
    }
  }

  async function undoLast(backupRef?: string, expectedHead?: RewriteHead) {
    const refName = backupRef ?? lastBackupRef.value;
    const context = captureOperation();
    if (!context.path || !context.current() || !refName || busy.value) return null;
    const expected = expectedHead ?? (refName === lastBackupRef.value ? lastUndoHead.value : null);
    if (!expected) throw new Error(i18n.global.t("rewrite.undoUnavailable"));
    busy.value = true;
    try {
      const result = await getBackend().undoRewrite({
        path: context.path,
        backupRef: refName,
        restoreWorktree: true,
        expectedHead: expected,
      });
      if (isCurrent(context)) {
        lastBackupRef.value = result.backupRef;
        lastUndoHead.value = result.undoHead ?? null;
        toast({ title: i18n.global.t("rewrite.undone") });
      }
      await refreshAfterSuccess(context);
      return result;
    } catch (error) {
      try {
        await refreshAfterSuccess(context);
      } catch {
        /* the original error is actionable */
      }
      throw error;
    } finally {
      busy.value = false;
    }
  }

  async function withDirtyRetry<T>(
    context: OperationContext,
    operation: string,
    run: (smart: boolean) => Promise<T>,
  ): Promise<T | null> {
    try {
      return await run(false);
    } catch (e: unknown) {
      if (!isCurrent(context)) throw e;
      const err = e as { code?: string; args?: { files?: string[]; operation?: string } };
      if (
        err?.code === "dirtyWorktreeWouldBeOverwritten" ||
        err?.code === "untrackedWouldBeOverwritten"
      ) {
        const choice = await openDialog<"smart" | "cancel" | null>(DirtyWorktreeDialog, {
          files: err.args?.files ?? [],
          operation: err.args?.operation ?? operation,
        });
        if (choice === "smart" && isCurrent(context)) return await run(true);
        return null;
      }
      toast({ title: operation + " failed", description: formatErrorMessage(e) });
      throw e;
    }
  }

  async function merge(opts: {
    branches: string[];
    noFf?: boolean;
    ffOnly?: boolean;
    squash?: boolean;
    message?: string | null;
    noCommit?: boolean;
    noVerify?: boolean;
    allowUnrelated?: boolean;
  }) {
    opts = { ...opts, branches: [...opts.branches] };
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await withDirtyRetry(context, "merge", (smart) =>
        getBackend().mergeRun({
          path: context.path,
          branches: opts.branches,
          noFf: !!opts.noFf,
          ffOnly: !!opts.ffOnly,
          squash: !!opts.squash,
          message: opts.message ?? null,
          noCommit: !!opts.noCommit,
          noVerify: !!opts.noVerify,
          allowUnrelated: !!opts.allowUnrelated,
          smart,
        }),
      );
      if (!result) return null;
      return await handleResult(result, "merge", context);
    } finally {
      busy.value = false;
    }
  }

  async function rebase(opts: {
    upstream: string;
    onto?: string | null;
    branch?: string | null;
    rebaseMerges?: boolean;
    keepEmpty?: boolean;
    root?: boolean;
    updateRefs?: boolean;
    autosquash?: boolean;
    interactive?: boolean;
  }) {
    opts = { ...opts };
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await withDirtyRetry(context, "rebase", (smart) =>
        getBackend().rebaseRun({
          path: context.path,
          upstream: opts.upstream,
          onto: opts.onto ?? null,
          branch: opts.branch ?? null,
          rebaseMerges: !!opts.rebaseMerges,
          keepEmpty: !!opts.keepEmpty,
          root: !!opts.root,
          updateRefs: !!opts.updateRefs,
          autosquash: !!opts.autosquash,
          interactive: !!opts.interactive,
          smart,
        }),
      );
      if (!result) return null;
      return await handleResult(result, "rebase", context);
    } finally {
      busy.value = false;
    }
  }

  async function cherryPick(opts: {
    shas: string[];
    mainline?: number | null;
    addSuffix?: boolean | null;
    allowEmpty?: boolean;
  }) {
    opts = { ...opts, shas: [...opts.shas] };
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await withDirtyRetry(context, "cherry-pick", (smart) =>
        getBackend().cherryPickRun({
          path: context.path,
          shas: opts.shas,
          mainline: opts.mainline ?? null,
          addSuffix: opts.addSuffix ?? null,
          allowEmpty: !!opts.allowEmpty,
          smart,
        }),
      );
      if (!result) return null;
      return await handleResult(result, "cherryPick", context);
    } finally {
      busy.value = false;
    }
  }

  async function abort() {
    const ws = useWorkspaceStore();
    if (!ws.repoPath || !opState.value) return;
    const kind = opState.value.kind;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      let result: RewriteResult;
      if (kind === "merge") result = await getBackend().mergeAbort({ path: context.path });
      else if (kind === "rebase") result = await getBackend().rebaseAbort({ path: context.path });
      else if (kind === "revert") result = await getBackend().revertAbort({ path: context.path });
      else result = await getBackend().cherryPickAbort({ path: context.path });
      if (isCurrent(context)) toast({ title: rewriteResultTitle(result, "abort") });
      await refreshAfterSuccess(context);
    } finally {
      busy.value = false;
    }
  }

  async function continueOp() {
    const ws = useWorkspaceStore();
    if (!ws.repoPath || !opState.value) return;
    const kind = opState.value.kind;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      let result: RewriteResult;
      if (kind === "merge") {
        result = await getBackend().mergeCommit({ path: context.path, message: null });
      } else if (kind === "rebase") {
        result = await getBackend().rebaseContinue({ path: context.path });
      } else if (kind === "revert") {
        result = await getBackend().revertContinue({ path: context.path });
      } else {
        result = await getBackend().cherryPickContinue({ path: context.path });
      }
      return await handleResult(result, kind === "normal" ? "cherryPick" : (kind as RewriteOperation), context);
    } finally {
      busy.value = false;
    }
  }

  async function skip() {
    const ws = useWorkspaceStore();
    if (!ws.repoPath || !opState.value) return;
    const kind = opState.value.kind;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      let result: RewriteResult;
      if (kind === "rebase") result = await getBackend().rebaseSkip({ path: context.path });
      else result = await getBackend().cherryPickSkip({ path: context.path });
      return await handleResult(result, kind === "rebase" ? "rebase" : "cherryPick", context);
    } finally {
      busy.value = false;
    }
  }

  async function loadInteractivePlan(fromSha: string, upstream = false) {
    const context = captureOperation();
    if (!context.path || !context.current()) return null;
    try {
      const plan = await getBackend().rebaseInteractivePlan({
        path: context.path,
        fromSha,
        upstream,
      });
      return context.current() ? plan : null;
    } catch (error) {
      if (context.current()) throw error;
      return null;
    }
  }

  async function startInteractive(plan: RebasePlan) {
    plan = { ...plan, items: plan.items.map((item) => ({ ...item })) };
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await withDirtyRetry(context, "rebase", (smart) =>
        getBackend().rebaseInteractiveStart({ path: context.path, plan, smart }),
      );
      if (!result) return null;
      return await handleResult(result, "rebase", context);
    } finally {
      busy.value = false;
    }
  }

  async function reword(sha: string, message: string) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await getBackend().rewordCommit({ path: context.path, sha, message });
      return await handleResult(result, "reword", context);
    } finally {
      busy.value = false;
    }
  }

  async function squash(shas: string[], message: string) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await getBackend().squashCommits({ path: context.path, shas, message });
      return await handleResult(result, "squash", context);
    } finally {
      busy.value = false;
    }
  }

  async function drop(shas: string[]) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await getBackend().dropCommits({ path: context.path, shas });
      return await handleResult(result, "drop", context);
    } finally {
      busy.value = false;
    }
  }

  async function fixupInto(target: string, squashMode: boolean, message?: string | null) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await getBackend().fixupInto({
        path: context.path,
        target,
        squash: squashMode,
        message: message ?? null,
      });
      return await handleResult(result, squashMode ? "squashInto" : "fixup", context);
    } finally {
      busy.value = false;
    }
  }

  async function uncommit() {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await getBackend().uncommit({ path: context.path });
      return await handleResult(result, "uncommit", context);
    } finally {
      busy.value = false;
    }
  }

  async function revert(shas: string[], mainline?: number | null) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await getBackend().revertRun({
        path: context.path,
        shas,
        mainline: mainline ?? null,
        noCommit: false,
      });
      return await handleResult(result, "revert", context);
    } finally {
      busy.value = false;
    }
  }

  async function reset(target: string, mode: ResetMode) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await getBackend().resetRun({ path: context.path, target, mode });
      return await handleResult(result, "reset", context);
    } finally {
      busy.value = false;
    }
  }

  async function extractChanges(commit: string, paths: string[], message: string) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await getBackend().extractChanges({
        path: context.path,
        commit,
        paths,
        message,
      });
      return await handleResult(result, "extract", context);
    } finally {
      busy.value = false;
    }
  }

  async function dropChanges(commit: string, paths: string[]) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    if (busy.value) return null;
    const context = { ...captureOperation(), path: ws.repoPath };
    if (!context.current()) return null;
    busy.value = true;
    try {
      const result = await getBackend().dropChanges({
        path: context.path,
        commit,
        paths,
        message: null,
      });
      return await handleResult(result, "dropChanges", context);
    } finally {
      busy.value = false;
    }
  }

  async function restoreSmartChanges() {
    const context = captureOperation();
    const saved = opState.value?.smartRecovery;
    if (!context.current() || !context.path || busy.value || !saved?.canRestore) return;
    const sha = saved.sha;
    busy.value = true;
    try {
      await getBackend().smartRestoreChanges({ path: context.path, sha });
      if (context.current()) toast({ title: i18n.global.t("merge.smartRecovered") });
    } finally {
      await refreshAfterSuccess(context);
      busy.value = false;
    }
  }

  return {
    restoreSmartChanges,
    repositoryToken,
    opState,
    busy,
    lastBackupRef,
    canUndo,
    refreshOpState,
    merge,
    rebase,
    cherryPick,
    abort,
    continueOp,
    skip,
    afterRewrite,
    loadInteractivePlan,
    startInteractive,
    reword,
    squash,
    drop,
    fixupInto,
    uncommit,
    revert,
    reset,
    extractChanges,
    dropChanges,
    undoLast,
    undoWithFeedback,
  };
});
