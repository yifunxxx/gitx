import { registerGroup } from "./registry";

export function registerDefaultGroups() {
  registerGroup({
    id: "Git.MainMenu",
    title: "Git",
    children: [
      "File.OpenFolder",
      "Git.Clone",
      "Git.Init",
      "Start.Use.Vcs",
      "-",
      "Git.Branches",
      "Git.Configure.Remotes",
      "-",
      "Git.Fetch",
      "Git.Pull",
      "Vcs.UpdateProject",
      "Git.Push",
      "-",
      "Git.RefreshStatus",
      "Git.Add",
      "Git.Stage.Add",
      "Git.Stage.Reset",
      "Diff.ShowDiff",
      "CheckinProject",
      "Git.Commit.And.Push",
      "-",
      "Git.Demo.Hello",
      "Vcs.Operations.Popup",
    ],
  });
  registerGroup({
    id: "Git.ContextMenu.Changes",
    title: "Changes",
    children: [
      "Diff.ShowDiff",
      "Git.Stage.Add",
      "Git.Stage.Reset",
      "Git.Add",
      "-",
      "Git.RefreshStatus",
    ],
  });
  registerGroup({
    id: "Vcs.Operations.Popup",
    title: "VCS Operations",
    popup: true,
    children: [
      "File.OpenFolder",
      "Git.Clone",
      "Git.Init",
      "Start.Use.Vcs",
      "-",
      "Git.Branches",
      "Git.Configure.Remotes",
      "Git.Fetch",
      "Git.Pull",
      "Vcs.UpdateProject",
      "Git.Push",
      "-",
      "Git.RefreshStatus",
      "CheckinProject",
      "Git.Commit.And.Push",
      "Diff.ShowDiff",
      "Git.Demo.Hello",
    ],
  });
  registerGroup({
    id: "MainToolbar.VcsQuickActions",
    children: [
      "Vcs.UpdateProject",
      "Git.RefreshStatus",
      "CheckinProject",
      "Git.Push",
    ],
  });
}
