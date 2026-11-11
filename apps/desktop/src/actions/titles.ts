import type { ActionDef } from "./types";

/**
 * Maps action ids → vue-i18n keys. Prefer this over hard-coded English `title`
 * when rendering menus / palettes so locale follows settings (default en).
 */
export const ACTION_TITLE_KEYS: Record<string, string> = {
  "Git.RefreshStatus": "actions.refreshStatus",
  "File.OpenFolder": "actions.openFolder",
  "Git.Init": "actions.createRepo",
  "Git.Clone": "actions.clone",
  "Git.Branches": "actions.branches",
  "Git.Fetch": "actions.fetch",
  "Git.Pull": "actions.pull",
  "Git.Push": "actions.push",
  "Vcs.UpdateProject": "actions.updateProject",
  "Git.Configure.Remotes": "actions.manageRemotes",
  "Git.Merge": "actions.merge",
  "Git.Rebase": "actions.rebase",
  "Git.CherryPick": "actions.cherryPick",
  "Git.ResolveConflicts": "actions.resolveConflicts",
  "Git.Merge.Abort": "actions.abortMerge",
  "Git.Merge.Commit": "merge.commitMerge",
  "Git.Rebase.Abort": "actions.abortRebase",
  "Git.Rebase.Continue": "actions.continueRebase",
  "Git.Rebase.Skip": "actions.skipCommit",
  "Git.CherryPick.Continue": "actions.continueCherryPick",
  "Git.CherryPick.Abort": "actions.abortCherryPick",
  "Git.Interactive.Rebase": "actions.interactiveRebase",
  "Git.Reword.Commit": "actions.reword",
  "Git.Squash.Commits": "actions.squash",
  "Git.Fixup.To.Commit": "actions.fixupInto",
  "Git.Squash.Into.Commit": "actions.squashInto",
  "Git.Revert.Abort": "actions.abortRevert",
  "Git.Drop.Commits": "actions.dropCommits",
  "Git.Uncommit": "actions.uncommit",
  "Git.Undo.Rewrite": "actions.undoRewrite",
  "Git.Revert.In.Log": "actions.revert",
  "Git.Reset.In.Log": "actions.reset",
  Settings: "actions.settings",
  "Diff.ShowDiff": "actions.showDiff",
  "Git.Stage.Add": "actions.stage",
  "Git.Stage.Reset": "actions.unstage",
  CheckinProject: "actions.commit",
  "Git.ShowHistory": "history.showHistory",
  "Git.Add": "actions.addToVcs",
  "ChangesView.NewChangeList": "changelist.new",
  "Git.Ignore.File": "actions.ignoreFile",
  "Git.Shelve": "shelf.create",
  "Git.Shelf.ImportPatch": "shelf.importPatch",
  "Git.Stash": "stash.create",
  "Git.Show.Stash": "actions.showStashes",
  "Git.ChangesView.AcceptYours": "merge.acceptYours",
  "Git.ChangesView.AcceptTheirs": "merge.acceptTheirs",
  "Git.ChangesView.Merge": "actions.merge",
  "Git.InMemory.Extract.Selected.Changes": "actions.extractSelected",
  "Git.Drop.Selected.Changes": "actions.dropSelected",
  "Git.Compare.With.Branch": "actions.compareWithBranch",
  "Vcs.ShowRepositoryAtRevision": "history.repoAtRevision",
  "Git.Log.CompareWithLocal": "history.compareWithLocal",
  "Create Patch": "actions.createPatch",
  "Git.OpenExcludeFile": "actions.openExclude",
  "Git.Commit.And.Push": "actions.commitAndPush",
  "Start.Use.Vcs": "empty.enableVcs",
  "Vcs.Operations.Popup": "actions.vcsOperations",
  "Git.FindAction": "actions.findAction",
  "Git.Show.WorkingTrees": "actions.showWorktrees",
  "Git.CreateNewWorkingTree": "worktrees.new",
  "Git.Worktrees.OpenRef": "worktrees.openRefTitle",
  "Github.Sync.Fork": "actions.syncFork",
  "Git.Submodule.Update": "actions.updateSubmodules",
  "Git.Commit.Tw.Docked": "actions.commitDocked",
  "Git.Commit.Tw.Window": "actions.commitWindow",
  "Git.Commit.Tw.Float": "actions.commitFloat",
  "Git.Commit.ToggleControls": "commitTw.toggleControls",
};

export function actionTitleKey(def: ActionDef): string | undefined {
  return def.titleKey ?? ACTION_TITLE_KEYS[def.id];
}

export function resolveActionTitle(def: ActionDef, t: (key: string) => string): string {
  const key = actionTitleKey(def);
  if (!key) return def.title;
  const translated = t(key);
  // vue-i18n returns the key itself when missing — fall back to English title.
  return translated === key ? def.title : translated;
}
