# File-picker dialogs (Changes actions)

Stash, Shelve, and Rollback open a path checklist so the user can adjust which
working-tree files the action covers. Opening context (Changes selection or
section) pre-selects matching paths; the set can be changed before OK.

## Intentional whole-repo / selection-only actions

These do **not** show an in-dialog file picker by design:

| Action | Why |
| --- | --- |
| Clear All Stashes | Clears the entire stash list after confirm; not a path-scoped op. |
| Log Revert / Cherry-pick / Reword / Squash / Drop commits | Operate on commits, not working-tree paths (partial file extract/drop use `PartialChangesDialog`). |
| Dirty worktree (Smart merge/rebase) | Lists blocking files read-only; choice is smart-stash vs cancel. |
| Stop Tracking / Ignore | Act on the frozen Changes selection; confirm options only (gitignore checkbox). |
| Commit Files… (context) | Focuses the Commit tool window; commit uses Changes checkboxes / staging. |
| Create Patch | Uses context/selection/checked paths without a second picker. |
| Stage / Unstage / Move to Changelist | Direct selection actions; no intermediate path dialog. |
| Update Project / Push / Pull | Repo-level sync; local-change handling is separate. |
