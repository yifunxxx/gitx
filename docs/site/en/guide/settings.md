# Settings, themes & updates

Press `Ctrl+,` or the toolbar gear. Choose a page on the left, or search by name and keyword. **Apply** saves without closing, **OK** saves and closes, and **Cancel** discards unapplied changes. A live appearance preview is not the same as saving it.

![Appearance settings in the native app](/screenshots/settings-en.jpg)

## Appearance and Project Files

<!-- settings: theme locale cornerStyle palette showIgnoredInFileTree showHiddenInFileTree compactFileTree -->

| Setting | Explanation |
| --- | --- |
| Theme | System, Light, Dark, and system/light/dark Liquid Glass variants; preview and save |
| Language | English or 简体中文; independent of the documentation language |
| Corner style | Small, Large, or None |
| Palette | Pearl or Graphite base colors |
| Show ignored in File | Include ignored files in File and its related searches |
| Show hidden in File | Show hidden files; this does not expose Git metadata as ordinary project files |
| Compact directories | Combine loaded single-child directory chains without expanding the whole repository |

File visibility and Commit's ignored-file setting are stored independently.

## Version Control · Git

<!-- settings: gitExecutable stagingMode showIgnored updateMethod cleanTree combineStashShelf autoFetch protectedBranches useCredentialHelper executeBranchOpsAllRoots showOptionsBeforeUpdate fetchOnAddRemote cherryPickSuffix allowPerHunk forkParent commitTwMode logIndexing logListMode changesListMode logChangedFilesListMode -->

| Setting | How to use it |
| --- | --- |
| Git executable | Choose `git.exe`, Test the version, then Apply; a successful test does not save the path |
| Staging mode | Enable traditional staging; disable for changelists. See [commits](./commit) |
| Show ignored files | Display ignored items in Commit without changing ignore rules |
| Update method | Default Merge / Rebase / Reset strategy; Reset removes local commits absent from the remote |
| Clean working tree using | Use Stash or Shelve to preserve local edits during updates |
| Combine Stashes and Shelves | Show the two record types together or separately |
| Auto-fetch interval | 0 means off; 1–1440 minutes fetches all remotes of the active repository. Hidden windows, offline state, and running tasks defer it. Authentication failures offer a manual Fetch |
| Protected branches | Names/patterns such as main/master constrain applicable force operations; not a replacement for server rules |
| Use credential helper | Enable Git credential-helper use; a failed save warning means credentials were not necessarily remembered |
| Execute branch operations on all roots | Control multi-root scope, particularly checkout; inspect each root afterward |
| Show options before update | Show the strategy chooser before updating |
| Fetch after adding a remote | Fetch immediately after adding a remote |
| Cherry-pick suffix on protected sources | Append source commit information when applicable |
| Allow per-hunk changelists | Assign blocks in Changelist HEAD → Local Diff; disabling preserves existing ownership and commit scope |
| Fork parent remote name | Parent remote for Sync Fork, normally upstream |
| Commit tool window mode | Docked / Window / Float; see [layout](./workspace) |
| Enable Log indexing | Control log-index functionality; rebuild from Log when needed |
| Log list mode | Flat chronological list or branch tree |
| Changes list mode | Tree or flat paths in Commit |
| Log changed files list mode | Tree or flat paths in Log details |

## Confirmation & Display

<!-- settings: closeCommitTw commitControlsHidden groupBranches showRecentBranches showTags showUpdateInfo -->

| Setting | Effect |
| --- | --- |
| Close Commit tool window after commit | Hide Commit after a successful commit |
| Hide commit controls | Hide the message area; show it with Ctrl+K or Toggle Commit Controls |
| Group branches by directory | Group slash-separated branch names |
| Show recent branches | Display recently used branches |
| Show tags | Display tags in applicable branch/log views |
| Show Update Info | Display update information after updating |

## Keymap

Search and replacement actions are included: Find/Replace in Files, Find/Replace in File, Find Next/Previous, Replace Current Match, and Replace All in File. Find in Files defaults to `Ctrl+Shift+R` (not `Ctrl+Shift+F`); Find in File starts as a single find row that expands for replace. Saved bindings work in editor content and the search panel. Removing a binding disables its original default; toolbar buttons remain available. Replacement stays disabled in read-only diffs. See [search and replace](./search).

1. Open Keymap and search for an action.
2. Click **Rebind**, press the combination, and inspect it. Conflicts and reserved system keys produce feedback.
3. **Remove** clears a binding; **Reset** restores that action's default; **Reset All** restores all defaults.
4. Save with Apply/OK. Cancel discards only unapplied edits.

**Find Action** and terminal toggling have reserved combinations. Do not try to reassign system close/security shortcuts. Execution still depends on repository and selection context. See [default shortcuts](./shortcuts).

## About & Updates

This page shows the installed version, the latest version returned by a check, a check button, Update Center, and the download-page link. The toolbar Update badge also opens Update Center with release notes, progress, and status.

The desktop app quietly checks about 8 seconds after launch, then approximately every 24 hours. An available update may start downloading in the background. **Downloaded does not mean installed**: use the restart/update action and complete installation when ready. Save edits and inspect running jobs first.

Update Center allows canceling a download, postponing, or ignoring that version. Retry network/download errors after inspecting them, or open Releases to download manually. Checks require access to GitHub; a failed check does not establish that you are up to date.
