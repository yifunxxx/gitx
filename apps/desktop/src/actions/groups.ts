import { registerGroup } from "./registry";

export function registerDefaultGroups() {
  registerGroup({
    id: "Git.MainMenu",
    title: "Git",
    children: ["Git.RefreshStatus", "Git.Demo.Hello", "-", "Vcs.Operations.Popup"],
  });
  registerGroup({
    id: "Git.ContextMenu.Changes",
    title: "Changes",
    children: ["Git.RefreshStatus", "Git.Demo.Hello"],
  });
  registerGroup({
    id: "Vcs.Operations.Popup",
    title: "VCS Operations",
    popup: true,
    children: ["Git.RefreshStatus", "Git.Demo.Hello"],
  });
  registerGroup({
    id: "MainToolbar.VcsQuickActions",
    children: ["Git.RefreshStatus"],
  });
}
