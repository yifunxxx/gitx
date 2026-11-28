# Commits & changelists

## Selection, checkboxes, and staging

Clicking a file **selects** it for a diff or context-menu operation. A **checkbox** controls the file scope of a changelist-mode commit. **Stage** writes content to Git's index. These are separate states.

**Batch Add to VCS:** Ctrl/⌘-click or Shift-click unversioned files, then right-click a selected row and choose **Add to VCS**. You can also check several unversioned files and right-click one of those checked files to add the checked group; the menu shows the count. An explicit selection of multiple rows takes priority. Right-clicking an unchecked, unselected file adds only that file. Checks in other groups are excluded. `Ctrl+Alt+A` (`⌘+Alt+A` on macOS) follows the same rules and uses checked unversioned files when there is no unversioned row selection. Other context-menu actions continue to use row selection.

| Mode | Setting | What gets committed |
| --- | --- | --- |
| Changelist (default) | Settings → Git, staging mode off | Check the files for this commit; changelists organize changes by task |
| Staging | Settings → Git, staging mode on | Stage files or selected changed lines first; the commit uses the index |

For a commit containing only part of one file, use [partial staging](./diff) and inspect Staged in staging mode.

## Create a normal commit

1. Open Commit with `Alt+0` or `Ctrl+K`.
2. Expand directories to inspect changes. The toolbar switches between a tree and flat paths. `M` means modified, `A` added, `D` deleted, and `?` untracked; renames include source information.
3. Double-click each file to review its diff. Include new files in version control or check them in the commit scope.
4. In Changelist mode, check the intended files. In Staging mode, use **Stage** in the context menu and review the Staged section. **Unstage** leaves disk edits intact.
5. Enter a message: summarize the purpose on the first line, then add a blank line and details if needed. Check **Run Git hooks**, then Commit.
6. Wait for the result and inspect the new Log entry and its files. On failure, read the message and Console, resolve the cause, and retry with the preserved draft.

![Commit and the side-by-side diff](/screenshots/commit-diff-en.jpg)

**Commit and Push** connects the commit entry point to the Push dialog. You still need to inspect the push destination. A refresh warning after a successful commit does not mean the commit failed; check Log before retrying.

## Organize work with changelists

1. Click **New Changelist** and enter a name such as `Search improvements`.
2. Select files in Changes and choose **Move to Changelist**, or drag them to the target list.
3. Use the list menu to make it active, rename it, or delete it. The active list receives new changes; deleting a list does not delete files from disk.
4. Check only the current task's files when committing. A changelist does not create a Git branch or push anything.

Enable Settings → Git → **Allow per-hunk changelists**, then open a file from a changelist in **HEAD → Local** Diff. Click the list name beside a block to assign it. One file can appear in multiple lists with a Partial marker. File, folder and list checkboxes select only that list’s blocks; the multiple-file **Commit Files** dialog uses the same scope.

New independent blocks join the active list; uniquely matched blocks retain their owner after line shifts. Merged, split or ambiguous edits show Review needed. Refresh, review every block in the file, then reassign. Checks preserve the preview from selection time: changed content or ownership rejects an old commit. Uncheck and review before checking again, or reopen the commit dialog.

A whole-file move or drag replaces all block assignments for that file. Deleting a list moves only its blocks. Disabling the setting disables assignment controls but preserves existing ownership and commit scope. With partial assignments present, explicitly check files instead of implicitly committing the index with no selection.

Partial commits retain unselected worktree content and compatible staged changes; overlapping staged changes are rejected before committing. New text files and file deletions are supported. Use whole-file assignment for empty files or mode-only changes. Binary/large files, symlinks, custom filters/encodings, rename comparisons and WSL Git do not support block assignment. Commit non-regular files separately when also committing partial files.

## Commit selected files

Choose **Commit Files** from a file context menu. Inspect the file list, enter a message, and submit. This dialog owns its message and selection; it does not replace the main panel's draft. A highlighted row does not mean every file has been checked.

## Amend the latest commit

Enable **Amend**, wait for HEAD's full message to load, then edit the message or include additional files and commit. Turning Amend off restores the ordinary draft. Amend changes the commit ID. Coordinate with collaborators before replacing a published commit; the next push may require force-with-lease. See [history rewriting](./rewrite).

## Roll back, ignore, or stop tracking

Save or close unsaved editor tabs for the selected files first, and finish or close their merge editors. Wait for loading, saving, or file operations to finish before retrying. Affected editors are temporarily read-only during rollback. Successful writes close their old content tabs; failed files keep their text. The editor that remains displayed also keeps its selection and undo history. Reopening a successfully restored file reads its current disk content.

| Command | How to use it | Result |
| --- | --- | --- |
| Rollback | Select changes, inspect the rollback dialog and options, then confirm | Discards the selected local edits; preserve anything needed in Stash or Shelf first |
| Ignore | Use Ignore on untracked paths | Adds `.gitignore` rules, which can be committed for the team |
| Stop Tracking | Open the dialog for tracked files | Removes files from the index while retaining them on disk; optionally add `.gitignore` rules, then commit the index change |
| Open .git/info/exclude | Find Action | Opens Git's local exclusion file; these rules are not shared by ordinary commits |

Adding an already tracked file to `.gitignore` does not stop tracking it. Deleting a file in File moves it to the recycle bin; rolling back changes is a different operation.

## Keyboard navigation

Changes supports arrows, Home/End, and PageUp/PageDown; Left/Right collapse or expand. Shift extends a selection, Ctrl allows independent navigation, Space toggles checkboxes, and Shift+F10 opens the context menu. **F4 in Changes opens the file editor**. In the File tree, F4 opens an applicable diff instead.
