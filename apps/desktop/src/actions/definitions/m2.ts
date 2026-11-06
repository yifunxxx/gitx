import {
  CloudDownload,
  Download,
  GitBranch,
  GitFork,
  RefreshCw,
  Upload,
} from "@lucide/vue";
import { registerAction } from "../registry";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { useSyncStore } from "@/stores/syncStore";
import { useChangesStore } from "@/stores/changesStore";
import { useLogStore } from "@/stores/logStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { openDialog } from "@/composables/useDialog";
import { toast } from "@/composables/useToast";
import CloneDialog from "@/features/welcome/CloneDialog.vue";
import ManageRemotesDialog from "@/features/remotes/ManageRemotesDialog.vue";
import PullDialog from "@/features/sync/PullDialog.vue";
import PushDialog from "@/features/sync/PushDialog.vue";
import UpdateProjectDialog from "@/features/sync/UpdateProjectDialog.vue";

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
    async run() {
      const path = await openDialog<string | null>(CloneDialog, {});
      if (!path) return;
      const workspace = useWorkspaceStore();
      await workspace.openFolder(path);
      if (workspace.isRepo) {
        await useChangesStore().refresh();
        await useLogStore().load(true);
        await useBranchesStore().refresh();
        useLayoutStore().activeBottomTab = "log";
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
      const summary = await useBranchesStore().fetch();
      toast({ title: summary?.message ?? "Fetched" });
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
      } else {
        const strategy = settings.settings?.git?.updateMethod ?? "merge";
        await useSyncStore().updateProject(strategy);
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
