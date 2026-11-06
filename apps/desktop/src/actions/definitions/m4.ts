import { GitMerge, GitPullRequestArrow, AlertTriangle } from "@lucide/vue";
import { registerAction } from "../registry";
import { openDialog } from "@/composables/useDialog";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useConflictsStore } from "@/stores/conflictsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useLogStore } from "@/stores/logStore";
import MergeDialog from "@/features/merge/MergeDialog.vue";
import RebaseDialog from "@/features/merge/RebaseDialog.vue";
import ConflictsDialog from "@/features/merge/ConflictsDialog.vue";

function hasRepo(ctx: { folderPath?: string | null }) {
  return !!ctx.folderPath && !!useWorkspaceStore().isRepo;
}

export function registerM4Actions() {
  registerAction({
    id: "Git.Merge",
    title: "Merge…",
    description: "Merge branches into current",
    icon: GitMerge,
    scope: "global",
    enabled: (ctx) => hasRepo(ctx),
    async run() {
      await openDialog(MergeDialog, {});
    },
  });

  registerAction({
    id: "Git.Merge.Abort",
    title: "Abort Merge",
    description: "Abort the current merge",
    scope: "global",
    enabled: () => useRewriteStore().opState?.kind === "merge",
    async run() {
      await useRewriteStore().abort();
    },
  });

  registerAction({
    id: "Git.Merge.Commit",
    title: "Commit Merge",
    description: "Commit the merge after resolving conflicts",
    scope: "global",
    enabled: () => {
      const s = useRewriteStore().opState;
      return s?.kind === "merge" && (s.conflictCount ?? 0) === 0;
    },
    async run() {
      await useRewriteStore().continueOp();
    },
  });

  registerAction({
    id: "Git.Rebase",
    title: "Rebase…",
    description: "Rebase current branch",
    icon: GitPullRequestArrow,
    scope: "global",
    enabled: (ctx) => hasRepo(ctx),
    async run() {
      await openDialog(RebaseDialog, {});
    },
  });

  registerAction({
    id: "Git.Rebase.Continue",
    title: "Continue Rebase",
    scope: "global",
    enabled: () => {
      const s = useRewriteStore().opState;
      return s?.kind === "rebase" && (s.conflictCount ?? 0) === 0;
    },
    async run() {
      await useRewriteStore().continueOp();
    },
  });

  registerAction({
    id: "Git.Rebase.Skip",
    title: "Skip Commit",
    scope: "global",
    enabled: () => useRewriteStore().opState?.kind === "rebase",
    async run() {
      await useRewriteStore().skip();
    },
  });

  registerAction({
    id: "Git.Rebase.Abort",
    title: "Abort Rebase",
    scope: "global",
    enabled: () => useRewriteStore().opState?.kind === "rebase",
    async run() {
      await useRewriteStore().abort();
    },
  });

  registerAction({
    id: "Git.CherryPick",
    title: "Cherry-Pick",
    description: "Cherry-pick selected Log commits",
    scope: "global",
    enabled: (ctx) => hasRepo(ctx),
    async run() {
      const log = useLogStore();
      const shas = log.selectedShas?.length
        ? log.selectedShas
        : log.selectedSha
          ? [log.selectedSha]
          : [];
      if (!shas.length) return;
      await useRewriteStore().cherryPick({ shas });
    },
  });

  registerAction({
    id: "Git.CherryPick.Continue",
    title: "Continue Cherry-Pick",
    scope: "global",
    enabled: () => {
      const s = useRewriteStore().opState;
      return s?.kind === "cherryPick" && (s.conflictCount ?? 0) === 0;
    },
    async run() {
      await useRewriteStore().continueOp();
    },
  });

  registerAction({
    id: "Git.CherryPick.Abort",
    title: "Abort Cherry-Pick",
    scope: "global",
    enabled: () => useRewriteStore().opState?.kind === "cherryPick",
    async run() {
      await useRewriteStore().abort();
    },
  });

  registerAction({
    id: "Git.ResolveConflicts",
    title: "Resolve Conflicts…",
    description: "Open Conflicts dialog",
    icon: AlertTriangle,
    scope: "global",
    enabled: () => {
      const s = useRewriteStore().opState;
      return !!s && s.kind !== "normal" && (s.conflictCount > 0 || useConflictsStore().hasConflicts);
    },
    async run() {
      await useConflictsStore().refresh();
      await openDialog(ConflictsDialog, {});
    },
  });

  registerAction({
    id: "Git.ChangesView.AcceptYours",
    title: "Accept Yours",
    scope: "changes",
    enabled: () => useConflictsStore().hasConflicts,
    async run() {
      const c = useConflictsStore();
      const paths = c.selected.length ? c.selected : c.entries.map((e) => e.path);
      await c.acceptSide("ours", paths);
    },
  });

  registerAction({
    id: "Git.ChangesView.AcceptTheirs",
    title: "Accept Theirs",
    scope: "changes",
    enabled: () => useConflictsStore().hasConflicts,
    async run() {
      const c = useConflictsStore();
      const paths = c.selected.length ? c.selected : c.entries.map((e) => e.path);
      await c.acceptSide("theirs", paths);
    },
  });

  registerAction({
    id: "Git.ChangesView.Merge",
    title: "Merge…",
    scope: "changes",
    enabled: () => useConflictsStore().hasConflicts,
    async run() {
      const c = useConflictsStore();
      const entry = c.entries.find((e) => c.selected.includes(e.path)) ?? c.entries[0];
      if (entry) await c.openMerge(entry);
    },
  });
}
