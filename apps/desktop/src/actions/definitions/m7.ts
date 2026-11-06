import { GitBranch, GitFork, Layers, PanelBottom } from "@lucide/vue";
import { registerAction } from "../registry";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorktreesStore } from "@/stores/worktreesStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getBackend } from "@/lib/backend";
import { toast } from "@/composables/useToast";
import { confirmDialog } from "@/composables/useConfirm";

function hasRepo() {
  const ws = useWorkspaceStore();
  return !!ws.folderPath && !!ws.isRepo;
}

export function registerM7Actions() {
  registerAction({
    id: "Git.Show.WorkingTrees",
    title: "Show Worktrees",
    description: "Open the Worktrees tool window tab",
    icon: Layers,
    scope: "global",
    enabled: () => hasRepo(),
    async run() {
      const layout = useLayoutStore();
      const wt = useWorktreesStore();
      wt.userOpened = true;
      layout.bottomOpen = true;
      layout.activeBottomTab = "worktrees";
      await wt.refresh();
    },
  });

  registerAction({
    id: "Git.CreateNewWorkingTree",
    title: "New Worktree…",
    description: "Create a new git worktree",
    icon: Layers,
    scope: "global",
    enabled: () => hasRepo(),
    async run() {
      const layout = useLayoutStore();
      const wt = useWorktreesStore();
      wt.userOpened = true;
      layout.bottomOpen = true;
      layout.activeBottomTab = "worktrees";
      wt.createOpen = true;
      await wt.refresh();
    },
  });

  registerAction({
    id: "Git.Worktrees.OpenRef",
    title: "Open Ref in Worktree…",
    description: "Fetch a ref/PR head and open it in a new worktree",
    icon: Layers,
    scope: "global",
    enabled: () => hasRepo(),
    async run() {
      const layout = useLayoutStore();
      const wt = useWorktreesStore();
      wt.userOpened = true;
      layout.bottomOpen = true;
      layout.activeBottomTab = "worktrees";
      wt.openRefOpen = true;
    },
  });

  registerAction({
    id: "Github.Sync.Fork",
    title: "Sync Fork with Upstream…",
    description: "Fetch upstream and update the default branch (host-agnostic)",
    icon: GitFork,
    scope: "global",
    enabled: () => hasRepo(),
    async run() {
      const ws = useWorkspaceStore();
      if (!ws.repoPath) return;
      const settings = useSettingsStore();
      const parent = settings.settings?.git?.forkParentRemote ?? "upstream";
      const push = await confirmDialog({
        title: "Sync Fork",
        message: `Sync with '${parent}' and push to origin?`,
      });
      const res = await getBackend().syncFork({
        path: ws.repoPath,
        parentRemote: parent,
        pushOrigin: push,
      });
      toast({ title: "Sync Fork", description: res.message });
    },
  });

  registerAction({
    id: "Git.Submodule.Update",
    title: "Update Submodules",
    description: "Run git submodule update for changed modules",
    icon: GitBranch,
    scope: "global",
    enabled: () => hasRepo(),
    async run() {
      const ws = useWorkspaceStore();
      if (!ws.repoPath) return;
      const res = await getBackend().submoduleUpdate({
        path: ws.repoPath,
        policy: "always",
      });
      toast({ title: "Submodules", description: res.message });
    },
  });

  registerAction({
    id: "Git.Commit.Tw.Docked",
    title: "Commit Tool Window: Docked",
    scope: "global",
    enabled: () => true,
    async run() {
      await useLayoutStore().setCommitTwMode("docked");
      toast({ title: "Commit TW: Docked" });
    },
  });

  registerAction({
    id: "Git.Commit.Tw.Window",
    title: "Commit Tool Window: Window",
    scope: "global",
    enabled: () => true,
    async run() {
      await useLayoutStore().setCommitTwMode("window");
      toast({ title: "Commit TW: Window" });
    },
  });

  registerAction({
    id: "Git.Commit.Tw.Float",
    title: "Commit Tool Window: Float",
    scope: "global",
    enabled: () => true,
    async run() {
      await useLayoutStore().setCommitTwMode("float");
      toast({ title: "Commit TW: Float" });
    },
  });

  registerAction({
    id: "Git.Commit.ToggleControls",
    title: "Toggle Commit Controls",
    description: "Hide or show the commit message area",
    icon: PanelBottom,
    scope: "global",
    enabled: () => true,
    async run() {
      useLayoutStore().toggleCommitControls();
    },
  });
}
