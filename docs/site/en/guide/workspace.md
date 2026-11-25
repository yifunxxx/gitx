# Workspace & navigation

## The five main areas

![The main workspace with Commit, Diff, and Log](/screenshots/commit-diff-en.png)

| Area | Purpose |
| --- | --- |
| Top toolbar | Project switching, branches, VCS menu, Update Project, Commit, Push, history, theme, Find Action, and Settings |
| Left stripe | **Commit** manages changes; **File** browses the entire folder; **Git** opens or hides the bottom tool window |
| Left panel | The selected Commit or File view; drag the divider to change its width |
| Center editor | Tabs for files, diffs, comparisons, historical revisions, and conflict resolution |
| Bottom tool window and status bar | Log, Update Info, Stashes & Shelves, Console, Terminal, and Worktrees when opened; the status bar shows background jobs and the current branch |

Click an active tool-window entry to hide its panel. Drag dividers to resize panes. The Git panel's upper-right maximize button expands it; click again to restore the layout.

## Open and switch projects

Use `Ctrl+O` to open a folder, or **Recent projects** beside the project name to reopen one. When prompted, choose the current window or a new window. Removing a recent entry removes the shortcut, not the folder.

The **workspace folder** and **active Git repository** can differ. A workspace may be a repository subfolder or contain multiple repositories. File shows the workspace tree; Commit, Log, and branch actions target the active repository. Check the repository and branch before operating across roots. See [multiple repositories](./worktrees).

## Find Action

1. Press `Ctrl+Shift+A` or click the toolbar search icon.
2. Type a command name, such as `Stash`, `Worktree`, or `Settings`.
3. Select with the arrow keys and press Enter. Press Esc to close.

When this guide says “open through Find Action,” it means this dialog. Commands that need a repository, file, or commit selection become available in the relevant context. Close an input dialog before invoking another command. Features without a default shortcut remain available through menus or Find Action.

## Editor tabs

Click a tab to switch views. Its context menu can close the current tab, other tabs, tabs to the right, or all tabs. “To the right” follows the visible tab order. Unsaved or unapplied edits may block closing or navigation until you save or confirm discarding them. Closing a diff only closes the view; it does not roll back a file.

## Commit tool-window layout

Search for **Commit Tool Window** in Find Action, or use **Settings → Git → Commit tool window mode**. Choose **Docked**, **Window**, or **Float**. These are presentations within the app; Float overlays part of the workspace. Switching to File and back preserves the commit draft.

**Toggle Commit Controls** shows or hides the commit message area. `Ctrl+K` returns to the commit UI. Check this setting if the message editor seems to be missing.

## Refresh and background work

File changes normally refresh automatically; press `Ctrl+R` when needed. Local refresh checks disk state. **Fetch** contacts a remote repository. Long operations appear under **Background processes** in the status bar. Switching views does not cancel them. See [Console and jobs](./terminal) when an operation fails.
