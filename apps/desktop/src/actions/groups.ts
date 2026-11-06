import { registerGroup } from "./registry";

export function registerDefaultGroups() {
  registerGroup({
    id: "Git.MainMenu",
    title: "Git",
    children: [
      "File.OpenFolder",
      "Git.Init",
      "Start.Use.Vcs",
      "-",
      "Git.RefreshStatus",
      "Git.Add",
      "Git.Stage.Add",
      "Git.Stage.Reset",
      "Diff.ShowDiff",
      "CheckinProject",
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
      "Git.Init",
      "Start.Use.Vcs",
      "-",
      "Git.RefreshStatus",
      "CheckinProject",
      "Diff.ShowDiff",
      "Git.Demo.Hello",
    ],
  });
  registerGroup({
    id: "MainToolbar.VcsQuickActions",
    children: ["Git.RefreshStatus", "CheckinProject"],
  });
}
