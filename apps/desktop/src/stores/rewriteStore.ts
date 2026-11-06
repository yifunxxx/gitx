import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend } from "@/lib/backend";
import type { RebasePlan, RepoOpState, ResetMode, RewriteResult } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useChangesStore } from "./changesStore";
import { useLogStore } from "./logStore";
import { useBranchesStore } from "./branchesStore";
import { useConflictsStore } from "./conflictsStore";
import { toast } from "@/composables/useToast";
import { openDialog } from "@/composables/useDialog";
import DirtyWorktreeDialog from "@/features/merge/DirtyWorktreeDialog.vue";
import ConflictsDialog from "@/features/merge/ConflictsDialog.vue";

export const useRewriteStore = defineStore("rewrite", () => {
  const opState = ref<RepoOpState | null>(null);
  const busy = ref(false);
  const lastBackupRef = ref<string | null>(null);

  async function afterRewrite() {
    await refreshOpState();
    await useChangesStore().refresh();
    await useLogStore().load(true);
    await useBranchesStore().refresh();
    if (opState.value && opState.value.kind !== "normal" && (opState.value.conflictCount ?? 0) > 0) {
      await useConflictsStore().refresh();
      void openDialog(ConflictsDialog, {});
    }
  }

  async function refreshOpState() {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) {
      opState.value = null;
      return null;
    }
    opState.value = await getBackend().repoOpStateGet({ path: ws.repoPath });
    return opState.value;
  }

  async function handleResult(result: RewriteResult, label: string) {
    if (result.backupRef) lastBackupRef.value = result.backupRef;
    if (result.outcome === "conflicts") {
      toast({
        title: result.message || `${label} conflicts`,
        persistent: true,
      });
      await useConflictsStore().refresh();
      void openDialog(ConflictsDialog, {});
    } else if (result.backupRef) {
      toast({
        title: result.message || label,
        action: {
          label: "Undo",
          onClick: () => {
            void undoLast(result.backupRef!);
          },
        },
      });
    } else {
      toast({ title: result.message || label });
    }
    await afterRewrite();
    return result;
  }

  async function undoLast(backupRef?: string) {
    const ws = useWorkspaceStore();
    const refName = backupRef ?? lastBackupRef.value;
    if (!ws.repoPath || !refName) return null;
    busy.value = true;
    try {
      const result = await getBackend().undoRewrite({
        path: ws.repoPath,
        backupRef: refName,
        restoreWorktree: true,
      });
      toast({ title: result.message || "Undone" });
      await afterRewrite();
      return result;
    } finally {
      busy.value = false;
    }
  }

  async function withDirtyRetry<T>(
    operation: string,
    run: (smart: boolean) => Promise<T>,
  ): Promise<T | null> {
    try {
      return await run(false);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string; args?: { files?: string[]; operation?: string } };
      if (
        err?.code === "dirtyWorktreeWouldBeOverwritten" ||
        err?.code === "untrackedWouldBeOverwritten"
      ) {
        const files = err.args?.files ?? [];
        const choice = await openDialog<"smart" | "cancel" | null>(DirtyWorktreeDialog, {
          files,
          operation: err.args?.operation ?? operation,
        });
        if (choice === "smart") {
          return await run(true);
        }
        return null;
      }
      toast({ title: `${operation} failed`, description: err?.message ?? String(e) });
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
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await withDirtyRetry("merge", (smart) =>
        getBackend().mergeRun({
          path: ws.repoPath!,
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
      return handleResult(result, "Merge");
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
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await withDirtyRetry("rebase", (smart) =>
        getBackend().rebaseRun({
          path: ws.repoPath!,
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
      return handleResult(result, "Rebase");
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
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await withDirtyRetry("cherry-pick", (smart) =>
        getBackend().cherryPickRun({
          path: ws.repoPath!,
          shas: opts.shas,
          mainline: opts.mainline ?? null,
          addSuffix: opts.addSuffix ?? null,
          allowEmpty: !!opts.allowEmpty,
          smart,
        }),
      );
      if (!result) return null;
      return handleResult(result, "Cherry-pick");
    } finally {
      busy.value = false;
    }
  }

  async function abort() {
    const ws = useWorkspaceStore();
    if (!ws.repoPath || !opState.value) return;
    const kind = opState.value.kind;
    busy.value = true;
    try {
      let result: RewriteResult;
      if (kind === "merge") result = await getBackend().mergeAbort({ path: ws.repoPath });
      else if (kind === "rebase") result = await getBackend().rebaseAbort({ path: ws.repoPath });
      else if (kind === "revert") result = await getBackend().revertAbort({ path: ws.repoPath });
      else result = await getBackend().cherryPickAbort({ path: ws.repoPath });
      toast({ title: result.message });
      await afterRewrite();
    } finally {
      busy.value = false;
    }
  }

  async function continueOp() {
    const ws = useWorkspaceStore();
    if (!ws.repoPath || !opState.value) return;
    const kind = opState.value.kind;
    busy.value = true;
    try {
      let result: RewriteResult;
      if (kind === "merge") {
        result = await getBackend().mergeCommit({ path: ws.repoPath, message: null });
      } else if (kind === "rebase") {
        result = await getBackend().rebaseContinue({ path: ws.repoPath });
      } else if (kind === "revert") {
        result = await getBackend().revertContinue({ path: ws.repoPath });
      } else {
        result = await getBackend().cherryPickContinue({ path: ws.repoPath });
      }
      return handleResult(result, "Continue");
    } finally {
      busy.value = false;
    }
  }

  async function skip() {
    const ws = useWorkspaceStore();
    if (!ws.repoPath || !opState.value) return;
    const kind = opState.value.kind;
    busy.value = true;
    try {
      let result: RewriteResult;
      if (kind === "rebase") result = await getBackend().rebaseSkip({ path: ws.repoPath });
      else result = await getBackend().cherryPickSkip({ path: ws.repoPath });
      return handleResult(result, "Skip");
    } finally {
      busy.value = false;
    }
  }

  async function loadInteractivePlan(fromSha: string, upstream = false) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    return getBackend().rebaseInteractivePlan({ path: ws.repoPath, fromSha, upstream });
  }

  async function startInteractive(plan: RebasePlan) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await withDirtyRetry("rebase", (smart) =>
        getBackend().rebaseInteractiveStart({ path: ws.repoPath!, plan, smart }),
      );
      if (!result) return null;
      return handleResult(result, "Interactive rebase");
    } finally {
      busy.value = false;
    }
  }

  async function reword(sha: string, message: string) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await getBackend().rewordCommit({ path: ws.repoPath, sha, message });
      return handleResult(result, "Reword");
    } finally {
      busy.value = false;
    }
  }

  async function squash(shas: string[], message: string) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await getBackend().squashCommits({ path: ws.repoPath, shas, message });
      return handleResult(result, "Squash");
    } finally {
      busy.value = false;
    }
  }

  async function drop(shas: string[]) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await getBackend().dropCommits({ path: ws.repoPath, shas });
      return handleResult(result, "Drop");
    } finally {
      busy.value = false;
    }
  }

  async function fixupInto(target: string, squashMode: boolean, message?: string | null) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await getBackend().fixupInto({
        path: ws.repoPath,
        target,
        squash: squashMode,
        message: message ?? null,
      });
      return handleResult(result, squashMode ? "Squash Into" : "Fixup");
    } finally {
      busy.value = false;
    }
  }

  async function uncommit() {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await getBackend().uncommit({ path: ws.repoPath });
      return handleResult(result, "Undo Commit");
    } finally {
      busy.value = false;
    }
  }

  async function revert(shas: string[], mainline?: number | null) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await getBackend().revertRun({
        path: ws.repoPath,
        shas,
        mainline: mainline ?? null,
        noCommit: false,
      });
      return handleResult(result, "Revert");
    } finally {
      busy.value = false;
    }
  }

  async function reset(target: string, mode: ResetMode) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await getBackend().resetRun({ path: ws.repoPath, target, mode });
      return handleResult(result, "Reset");
    } finally {
      busy.value = false;
    }
  }

  async function extractChanges(commit: string, paths: string[], message: string) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await getBackend().extractChanges({
        path: ws.repoPath,
        commit,
        paths,
        message,
      });
      return handleResult(result, "Extract");
    } finally {
      busy.value = false;
    }
  }

  async function dropChanges(commit: string, paths: string[]) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return null;
    busy.value = true;
    try {
      const result = await getBackend().dropChanges({
        path: ws.repoPath,
        commit,
        paths,
        message: null,
      });
      return handleResult(result, "Drop changes");
    } finally {
      busy.value = false;
    }
  }

  return {
    opState,
    busy,
    lastBackupRef,
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
  };
});
