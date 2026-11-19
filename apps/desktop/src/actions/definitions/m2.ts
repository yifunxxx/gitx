import { CloudDownload, Download, GitBranch, GitFork, RefreshCw, Upload } from "@lucide/vue";
import { registerAction } from "../registry";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { useSyncStore } from "@/stores/syncStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { openDialog } from "@/composables/useDialog";
import { toast } from "@/composables/useToast";
import { createWorkspaceOpen, isWorkspaceOpening } from "@/composables/useWorkspaceOpen";
import { i18n } from "@/i18n";
import CloneDialog from "@/features/welcome/CloneDialog.vue";
import ManageRemotesDialog from "@/features/remotes/ManageRemotesDialog.vue";
import PullDialog from "@/features/sync/PullDialog.vue";
import PushDialog from "@/features/sync/PushDialog.vue";
import UpdateProjectDialog from "@/features/sync/UpdateProjectDialog.vue";

// A clone owns its dialog, not the workspace navigation lock. Other project
// actions remain available while this potentially long-running task finishes.
const cloning = new WeakSet<ReturnType<typeof useWorkspaceStore>>();

export function registerM2Actions() {
  registerAction({
    id: "Git.Branches",
    title: "Branches…",
    description: "Show Branches popup",
    icon: GitBranch,
    scope: "global",
    enabled: (ctx) => !!ctx.folderPath,
    async run() {
      useBranchesStore().openPopup();
    },
  });

  registerAction({
    id: "Git.Clone",
    title: "Clone Repository…",
    description: "Clone a Git repository",
    icon: Download,
    scope: "global",
    enabled: () => !isWorkspaceOpening() && !cloning.has(useWorkspaceStore()),
    async run() {
      const workspace = useWorkspaceStore();
      if (cloning.has(workspace) || isWorkspaceOpening()) return;
      cloning.add(workspace);
      try {
        const navigation = workspace.navigationToken();
        const opening = createWorkspaceOpen(i18n.global.t);
        const path = await openDialog<string | null>(CloneDialog, {});
        if (!path || workspace.navigationToken() !== navigation) return;
        // A newer directory picker can own opening without changing navigation
        // yet. The shared controller also rejects this pending auto-open.
        await opening.openCloned(path);
      } finally {
        cloning.delete(workspace);
      }
    },
  });

  registerAction({
    id: "Git.Configure.Remotes",
    title: "Manage Remotes…",
    description: "Add / edit / remove remotes",
    icon: GitFork,
    scope: "global",
    enabled: (ctx) => !!ctx.folderPath,
    async run() {
      await openDialog(ManageRemotesDialog, {});
    },
  });

  registerAction({
    id: "Git.Fetch",
    title: "Fetch",
    description: "Fetch from remotes",
    icon: CloudDownload,
    scope: "global",
    enabled: (ctx) => !!ctx.folderPath,
    async run() {
      try {
        const summary = await useBranchesStore().fetch();
        if (summary) toast({ title: summary.message || "Fetched" });
      } catch {
        // Toast already shown by branchesStore.
      }
    },
  });

  registerAction({
    id: "Git.Pull",
    title: "Pull…",
    description: "Pull from remote",
    icon: Download,
    scope: "global",
    enabled: (ctx) => !!ctx.folderPath,
    async run() {
      await openDialog(PullDialog, {});
    },
  });

  registerAction({
    id: "Git.Push",
    title: "Push…",
    description: "Push commits to remote",
    icon: Upload,
    defaultShortcuts: {
      mac: ["mod+shift+k"],
      win: ["ctrl+shift+k"],
      linux: ["ctrl+shift+k"],
    },
    scope: "global",
    enabled: (ctx) => !!ctx.folderPath,
    async run() {
      await openDialog(PushDialog, {});
    },
  });

  registerAction({
    id: "Vcs.UpdateProject",
    title: "Update Project…",
    description: "Fetch and update current branch",
    icon: RefreshCw,
    defaultShortcuts: {
      mac: ["mod+t"],
      win: ["ctrl+t"],
      linux: ["ctrl+t"],
    },
    scope: "global",
    enabled: (ctx) => !!ctx.folderPath,
    async run() {
      const settings = useSettingsStore();
      const show = settings.settings?.git?.showOptionsBeforeUpdate ?? true;
      if (show) {
        await openDialog(UpdateProjectDialog, {});
        return;
      }
      const strategy = settings.settings?.git?.updateMethod ?? "merge";
      try {
        await useSyncStore().updateProject(strategy);
      } catch {
        // Toast already shown by syncStore.
      }
    },
  });

  registerAction({
    id: "Git.Commit.And.Push",
    title: "Commit and Push…",
    description: "Commit then open Push dialog",
    icon: Upload,
    defaultShortcuts: {
      mac: ["mod+alt+k"],
      win: ["ctrl+alt+k"],
      linux: ["ctrl+alt+k"],
    },
    scope: "global",
    enabled: (ctx) => !!ctx.folderPath,
    async run(ctx) {
      const { runAction } = await import("../registry");
      await runAction("CheckinProject", ctx);
      await openDialog(PushDialog, {});
    },
  });
}
