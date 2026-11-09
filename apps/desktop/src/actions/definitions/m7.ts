import { GitBranch, GitFork, Layers, PanelBottom } from "@lucide/vue";
import { ref } from "vue";
import { registerAction } from "../registry";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorktreesStore } from "@/stores/worktreesStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getBackend } from "@/lib/backend";
import { toast } from "@/composables/useToast";
import { confirmDialog } from "@/composables/useConfirm";
import { i18n } from "@/i18n";
import { formatErrorMessage } from "@/lib/errors";
import { submoduleFeedback } from "@/lib/submoduleFeedback";
import { useChangesStore } from "@/stores/changesStore";

function hasRepo() {
  const ws = useWorkspaceStore();
  return !!ws.folderPath && !!ws.isRepo;
}

export function registerM7Actions() {
  const syncingForks = ref(new Set<string>());
  const updatingSubmodules = ref(new Set<string>());
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
    enabled: () => hasRepo() && !syncingForks.value.has(useWorkspaceStore().repoPath ?? ""),
    async run() {
      const ws = useWorkspaceStore();
      const path = ws.repoPath;
      if (!path || syncingForks.value.has(path)) return;
      const navigation = ws.navigationToken();
      const current = () => path === ws.repoPath && navigation === ws.navigationToken();
      const settings = useSettingsStore();
      const parent = settings.settings?.git?.forkParentRemote ?? "upstream";
      syncingForks.value.add(path);
      try {
        const confirmed = await confirmDialog({
          title: i18n.global.t("actions.syncFork"),
          message: i18n.global.t("actions.syncForkConfirm", { remote: parent }),
          confirmLabel: i18n.global.t("actions.syncForkConfirmAction"),
        });
        if (!confirmed || !current()) return;
        const res = await getBackend().syncFork({
          path,
          parentRemote: parent,
          strategy: null,
          pushOrigin: true,
        });
        if (current())
          toast({ title: i18n.global.t("actions.syncFork"), description: res.message });
      } catch (error) {
        if (current())
          toast({
            title: i18n.global.t("actions.syncForkFailed"),
            description: formatErrorMessage(error),
            persistent: true,
          });
      } finally {
        syncingForks.value.delete(path);
      }
    },
  });

  registerAction({
    id: "Git.Submodule.Update",
    title: "Update Submodules",
    description: "Run git submodule update for changed modules",
    icon: GitBranch,
    scope: "global",
    enabled: () => hasRepo() && !updatingSubmodules.value.has(useWorkspaceStore().repoPath ?? ""),
    async run() {
      const ws = useWorkspaceStore();
      const path = ws.repoPath;
      if (!path || updatingSubmodules.value.has(path)) return;
      const navigation = ws.navigationToken();
      const current = () => ws.repoPath === path && ws.navigationToken() === navigation;
      updatingSubmodules.value.add(path);
      try {
        const res = await getBackend().submoduleUpdate({
          path,
          policy: "always",
          changedPaths: null,
        });
        if (!current()) return;
        toast(submoduleFeedback(res));
        await useChangesStore().refresh();
      } catch (error) {
        if (current())
          toast({
            title: i18n.global.t("syncUi.submodulesFailed"),
            description: formatErrorMessage(error),
            persistent: true,
          });
      } finally {
        updatingSubmodules.value.delete(path);
      }
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
