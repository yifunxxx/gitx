import {
  Check,
  FileDiff,
  FolderOpen,
  GitBranchPlus,
  History,
  Plus,
  RefreshCw,
  Minus,
  GitCompare,
  FolderTree,
} from "@lucide/vue";
import { registerAction } from "../registry";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore } from "@/stores/changesStore";
import { useCommitStore } from "@/stores/commitStore";
import { openChangeDiff } from "@/features/commit/openChangeDiff";
import { focusCommitUi } from "@/features/commit/focusCommitUi";
import { useLogStore } from "@/stores/logStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useCompareStore } from "@/stores/compareStore";
import { useRepoAtRevStore } from "@/stores/repoAtRevStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { getBackend } from "@/lib/backend";
import { toast } from "@/composables/useToast";
import { promptDialog } from "@/composables/useConfirm";
import { isTauri } from "@/lib/utils";

export function registerVcsActions() {
  registerAction({
    id: "Git.RefreshStatus",
    title: "Refresh Status",
    description: "Refresh Changes and probe git status into Console",
    icon: RefreshCw,
    defaultShortcuts: {
      mac: ["mod+r"],
      win: ["mod+r"],
      linux: ["mod+r"],
    },
    scope: "global",
    async run(ctx) {
      const workspace = useWorkspaceStore();
      const changes = useChangesStore();
      const path = ctx.folderPath ?? workspace.folderPath;
      if (!path) {
        toast({ title: "No folder open" });
        return;
      }
      const backend = getBackend();
      await backend.statusProbe({ path });
      if (workspace.isRepo) {
        await changes.refresh();
        await useLogStore().load(true);
      }
    },
  });

  registerAction({
    id: "File.OpenFolder",
    title: "Open…",
    description: "Open a folder / repository",
    icon: FolderOpen,
    defaultShortcuts: {
      mac: ["mod+o"],
      win: ["mod+o"],
      linux: ["mod+o"],
    },
    scope: "global",
    async run() {
      let path: string | null = null;
      if (isTauri()) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false });
        path = typeof selected === "string" ? selected : null;
      } else {
        path = await promptDialog({
          title: "Open…",
          placeholder: "Folder path",
          allowEmpty: false,
        });
      }
      if (!path) return;
      const workspace = useWorkspaceStore();
      await workspace.openFolder(path);
      toast({ title: "Opened", description: path });
      if (workspace.isRepo) {
        await useChangesStore().refresh();
        await useLogStore().load(true);
        useLayoutStore().activeBottomTab = "log";
      }
    },
  });

  registerAction({
    id: "Git.Init",
    title: "Create Git Repository…",
    description: "git init in a chosen directory",
    icon: GitBranchPlus,
    scope: "global",
    async run() {
      let path: string | null = null;
      if (isTauri()) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false });
        path = typeof selected === "string" ? selected : null;
      } else {
        path = await promptDialog({
          title: "Create Git Repository…",
          placeholder: "Directory for new repository",
          allowEmpty: false,
        });
      }
      if (!path) return;
      const workspace = useWorkspaceStore();
      await workspace.initRepo(path, "main");
      toast({ title: "Repository created", description: path });
      await useChangesStore().refresh();
      await useLogStore().load(true);
    },
  });

  registerAction({
    id: "Start.Use.Vcs",
    title: "Enable Version Control Integration…",
    description: "Initialize Git in the current folder",
    icon: GitBranchPlus,
    scope: "global",
    enabled: (ctx) => !!ctx.folderPath,
    async run() {
      const workspace = useWorkspaceStore();
      await workspace.enableVcs("main");
      toast({ title: "Git enabled" });
      await useChangesStore().refresh();
    },
  });

  registerAction({
    id: "Git.Add",
    title: "Add to VCS",
    description: "git add selected unversioned files",
    icon: Plus,
    defaultShortcuts: {
      mac: ["mod+alt+a"],
      win: ["ctrl+alt+a"],
      linux: ["ctrl+alt+a"],
    },
    scope: "changes",
    enabled: () => useChangesStore().selectedPaths.length > 0,
    async run() {
      const changes = useChangesStore();
      const paths = changes.selectedPaths;
      if (!paths.length) return;
      await changes.add(paths);
      toast({ title: "Added to VCS" });
    },
  });

  registerAction({
    id: "Git.Stage.Add",
    title: "Stage",
    description: "Stage selected files",
    icon: Plus,
    scope: "changes",
    enabled: () => useChangesStore().selectedPaths.length > 0,
    async run() {
      const changes = useChangesStore();
      if (!changes.selectedPaths.length) return;
      await changes.stage(changes.selectedPaths);
      toast({ title: "Staged" });
    },
  });

  registerAction({
    id: "Git.Stage.Reset",
    title: "Unstage",
    description: "Unstage selected files",
    icon: Minus,
    scope: "changes",
    enabled: () => useChangesStore().selectedPaths.length > 0,
    async run() {
      const changes = useChangesStore();
      if (!changes.selectedPaths.length) return;
      await changes.unstage(changes.selectedPaths);
      toast({ title: "Unstaged" });
    },
  });

  registerAction({
    id: "Diff.ShowDiff",
    title: "Show Diff",
    description: "Open Diff for the selected change",
    icon: FileDiff,
    defaultShortcuts: {
      mac: ["mod+d"],
      win: ["ctrl+d"],
      linux: ["ctrl+d"],
    },
    scope: "changes",
    async run() {
      const changes = useChangesStore();
      const path = changes.selectedPaths[0];
      if (!path || !changes.selectedSection) {
        toast({ title: "Select a file first" });
        return;
      }
      await openChangeDiff(path, changes.selectedSection);
    },
  });

  registerAction({
    id: "CheckinProject",
    title: "Commit…",
    description: "Focus Commit message / create commit",
    icon: Check,
    defaultShortcuts: {
      mac: ["mod+k"],
      win: ["ctrl+k"],
      linux: ["ctrl+k"],
    },
    scope: "global",
    async run() {
      const layout = useLayoutStore();
      const changes = useChangesStore();
      const commit = useCommitStore();
      const workspace = useWorkspaceStore();
      // Freeze session before any await so a mid-flight focus cannot pin a newer repo.
      const path = workspace.repoPath;
      const repoId = workspace.repoId;
      const navigation = workspace.navigationToken();
      const sameSession = () =>
        workspace.isRepo &&
        workspace.repoPath === path &&
        workspace.repoId === repoId &&
        workspace.navigationToken() === navigation;
      // IDEA: first invoke focuses the Commit TW / message; second (with text) commits.
      await focusCommitUi();
      if (!sameSession()) return;
      const hasCheckedChanges = !changes.stagingMode && changes.checkedPaths.length > 0;
      if (!changes.staged.length && !hasCheckedChanges && !commit.amend) {
        toast({ title: "Nothing to commit" });
        return;
      }
      if (commit.message.trim()) {
        try {
          const result = await commit.commit();
          if (result && sameSession()) {
            layout.activeBottomTab = "log";
          }
        } catch {
          // The store already reports the failure for its source session.
        }
      } else {
        toast({ title: "Enter a commit message" });
      }
    },
  });

  registerAction({
    id: "Git.ShowHistory",
    title: "Show History",
    description: "File / folder history for the selected path",
    icon: History,
    scope: "changes",
    async run() {
      const changes = useChangesStore();
      const path = changes.selectedPaths[0];
      if (!path) {
        toast({ title: "Select a file first" });
        return;
      }
      await useHistoryStore().openFileHistory(path);
    },
  });

  registerAction({
    id: "Git.Compare.With.Branch",
    title: "Compare with Branch or Tag…",
    description: "Compare current HEAD with another ref (host-agnostic)",
    icon: GitCompare,
    scope: "global",
    enabled: (ctx) => !!ctx.folderPath,
    async run() {
      const workspace = useWorkspaceStore();
      if (!workspace.repoPath) return;
      const refs = await getBackend().listRefs({ path: workspace.repoPath });
      const other = (
        await promptDialog({
          title: "Compare with Branch or Tag…",
          defaultValue: refs[0] ?? "main",
          placeholder: "branch / tag",
          allowEmpty: false,
        })
      )?.trim();
      if (!other) return;
      await useCompareStore().compareRefs("HEAD", other);
    },
  });

  registerAction({
    id: "Vcs.ShowRepositoryAtRevision",
    title: "Browse Repository at Revision…",
    description: "Open read-only tree at a revision",
    icon: FolderTree,
    scope: "global",
    enabled: (ctx) => !!ctx.folderPath,
    defaultShortcuts: {
      mac: ["mod+shift+o"],
      win: ["ctrl+shift+o"],
      linux: ["ctrl+shift+o"],
    },
    async run() {
      const rev = (
        await promptDialog({
          title: "Browse Repository at Revision…",
          defaultValue: "HEAD",
          placeholder: "hash / branch / tag",
          allowEmpty: false,
        })
      )?.trim();
      if (!rev) return;
      await useRepoAtRevStore().open(rev);
    },
  });

  registerAction({
    id: "Git.Log.CompareWithLocal",
    title: "Compare with Local",
    description: "Compare selected Log commit with the working tree",
    icon: GitCompare,
    scope: "global",
    async run() {
      const sha = useLogStore().selectedSha;
      if (!sha) {
        toast({ title: "Select a commit in Log" });
        return;
      }
      await useCompareStore().compareWithLocal(sha);
    },
  });
}
