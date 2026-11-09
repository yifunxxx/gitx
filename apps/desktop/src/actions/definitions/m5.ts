import { registerAction } from "../registry";
import { openDialog } from "@/composables/useDialog";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useLogStore } from "@/stores/logStore";
import InteractiveRebaseEditor from "@/features/merge/InteractiveRebaseEditor.vue";
import RewordDialog from "@/features/merge/RewordDialog.vue";
import ResetDialog from "@/features/merge/ResetDialog.vue";
import SquashDialog from "@/features/merge/SquashDialog.vue";
import PartialChangesDialog from "@/features/merge/PartialChangesDialog.vue";
import { confirmDialog, promptDialog } from "@/composables/useConfirm";
import { captureRewriteContext } from "@/features/merge/rewriteContext";
import { i18n } from "@/i18n";

const t = (key: string) => i18n.global.t(key);

function hasRepo(ctx: { folderPath?: string | null }) {
  return !!ctx.folderPath && !!useWorkspaceStore().isRepo && !useRewriteStore().busy;
}

function selectedShas(): string[] {
  const log = useLogStore();
  if (log.selectedShas?.length) return [...log.selectedShas];
  if (log.selectedSha) return [log.selectedSha];
  return [];
}

export function registerM5Actions() {
  registerAction({
    id: "Git.Undo.Rewrite",
    title: "Undo Last History Rewrite",
    scope: "global",
    enabled: (ctx) => hasRepo(ctx) && useRewriteStore().canUndo,
    async run() {
      await useRewriteStore().undoWithFeedback();
    },
  });

  registerAction({
    id: "Git.Interactive.Rebase",
    title: "Interactively Rebase from Here…",
    description: "Edit todo (pick/reword/squash/fixup/drop) and rebase",
    scope: "global",
    enabled: (ctx) => hasRepo(ctx) && selectedShas().length === 1,
    async run() {
      const sha = selectedShas()[0];
      if (!sha) return;
      await openDialog(InteractiveRebaseEditor, { fromSha: sha });
    },
  });

  registerAction({
    id: "Git.Reword.Commit",
    title: "Edit Commit Message…",
    description: "Reword selected commit",
    defaultShortcuts: { mac: ["F2"], win: ["F2"], linux: ["F2"] },
    scope: "global",
    enabled: (ctx) => hasRepo(ctx) && selectedShas().length === 1,
    async run() {
      const sha = selectedShas()[0];
      if (!sha) return;
      await openDialog(RewordDialog, { sha });
    },
  });

  registerAction({
    id: "Git.Squash.Commits",
    title: "Squash Commits…",
    scope: "global",
    enabled: (ctx) => hasRepo(ctx) && selectedShas().length >= 2,
    async run() {
      const shas = selectedShas();
      if (shas.length < 2) return;
      await openDialog(SquashDialog, { shas });
    },
  });

  registerAction({
    id: "Git.Drop.Commits",
    title: "Drop Commits",
    scope: "global",
    enabled: (ctx) => hasRepo(ctx) && selectedShas().length >= 1,
    async run() {
      const shas = selectedShas();
      if (!shas.length) return;
      const current = captureRewriteContext();
      const ok = await confirmDialog({
        title: t("actions.dropCommits"),
        message: i18n.global.t("log.dropConfirm", { count: shas.length }),
        destructive: true,
      });
      if (!ok || !current()) return;
      await useRewriteStore().drop(shas);
    },
  });

  registerAction({
    id: "Git.Fixup.To.Commit",
    title: "Fixup…",
    description: "Commit local changes as fixup into selected commit",
    scope: "global",
    enabled: (ctx) => hasRepo(ctx) && selectedShas().length === 1,
    async run() {
      const sha = selectedShas()[0];
      if (!sha) return;
      await useRewriteStore().fixupInto(sha, false);
    },
  });

  registerAction({
    id: "Git.Squash.Into.Commit",
    title: "Squash Into…",
    scope: "global",
    enabled: (ctx) => hasRepo(ctx) && selectedShas().length === 1,
    async run() {
      const sha = selectedShas()[0];
      if (!sha) return;
      const current = captureRewriteContext();
      const msg = await promptDialog({
        title: t("actions.squashInto"),
        placeholder: t("rewrite.combinedMessage"),
      });
      if (msg == null || !current()) return;
      await useRewriteStore().fixupInto(sha, true, msg.trim() ? msg : undefined);
    },
  });

  registerAction({
    id: "Git.Uncommit",
    title: "Undo Commit",
    description: "Soft-reset the tip commit (keep changes staged)",
    scope: "global",
    enabled: (ctx) => hasRepo(ctx),
    async run() {
      await useRewriteStore().uncommit();
    },
  });

  registerAction({
    id: "Git.Revert.In.Log",
    title: "Revert Commit",
    scope: "global",
    enabled: (ctx) => hasRepo(ctx) && selectedShas().length >= 1,
    async run() {
      const shas = selectedShas();
      if (!shas.length) return;
      await useRewriteStore().revert(shas);
    },
  });

  registerAction({
    id: "Git.Reset.In.Log",
    title: "Reset Current Branch to Here…",
    scope: "global",
    enabled: (ctx) => hasRepo(ctx) && selectedShas().length === 1,
    async run() {
      const sha = selectedShas()[0];
      if (!sha) return;
      await openDialog(ResetDialog, { target: sha });
    },
  });

  registerAction({
    id: "Git.Revert.Abort",
    title: "Abort Revert",
    scope: "global",
    enabled: () => useRewriteStore().opState?.kind === "revert",
    async run() {
      await useRewriteStore().abort();
    },
  });

  registerAction({
    id: "Git.InMemory.Extract.Selected.Changes",
    title: "Extract Selected Changes…",
    scope: "changes",
    enabled: (ctx) => hasRepo(ctx) && selectedShas().length === 1,
    async run() {
      const log = useLogStore();
      const sha = log.selectedSha;
      if (!sha) return;
      await openDialog(PartialChangesDialog, { commit: sha, mode: "extract" });
    },
  });

  registerAction({
    id: "Git.Drop.Selected.Changes",
    title: "Drop Selected Changes",
    scope: "changes",
    enabled: (ctx) => hasRepo(ctx) && selectedShas().length === 1,
    async run() {
      const log = useLogStore();
      const sha = log.selectedSha;
      if (!sha) return;
      await openDialog(PartialChangesDialog, { commit: sha, mode: "drop" });
    },
  });
}
