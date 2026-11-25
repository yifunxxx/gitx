# Stash & Shelf

Save uncommitted work before switching tasks, updating a project, or cleaning the working tree.

| Method | Best suited to | Behavior |
| --- | --- | --- |
| Stash | Standard Git records shared with command-line workflows | Apply, Pop, Drop; optional untracked files and index restoration |
| Shelf | Named tasks, previews, and patch exchange | Expand files, preview/export patches, restore recently deleted records |

Neither is automatic cloud backup. Use exported patches or another backup method when transferring work between machines.

## Create a stash

1. Open VCS → **Stash Changes**, or use the creation control in Stashes & Shelves.
2. Enter a recognizable message and review the checked files.
3. **Include untracked** includes new files. Without it, those files are not backed up by this operation.
4. **Keep index** retains staged content, useful when putting the rest of your work aside.
5. Confirm, then check that the record exists and inspect the changes left in the working tree.

![The Stashes & Shelves panel](/screenshots/stash-en.jpg)

## Restore or remove a stash

Select the intended record, check its message and reference, then choose:

- **Apply** applies changes while keeping the record, useful for a first restoration attempt.
- **Pop** applies and removes the record after success. Inspect conflicts or failures before trying again.
- **Reinstate index** restores the original staged state when requested.
- **Drop** deletes the selected stash; it does not undo changes already applied from it.
- **Clear** removes all stashes. Verify the scope before confirming.

Resolve conflicts using the [conflict workflow](./conflicts), retaining relevant saved records until files are correct.

## Create a shelf

1. Select files in Changes and choose **Shelve Changes**.
2. Enter a name and inspect the file selection.
3. Enable **Keep changes** to save a copy while retaining local edits. Otherwise, selected edits are removed after being saved.
4. Inspect the resulting Shelf entry and its files. A closed dialog alone does not establish success.

**Combine Stashes and Shelves** shows both types in one tab by default. Turn it off in Settings for separate tabs.

## Preview, unshelve, and export

Expand a shelf to inspect its files. **Preview** shows the unified patch captured when it was saved, not a live diff of the current working tree.

Select a Shelf record and choose **Unshelve**, then check the files to restore. The dialog shares the list/tree switch, search, and folder checkboxes used by Stash and other file pickers. All files are initially selected; unselected files remain unchanged.

- Leave **Remove applied** off to retain the complete record. When enabled, only successfully applied content is removed; unselected and failed content stays in the Shelf.
- Select both sides of a rename and all dependent file/directory paths together. Incomplete selections report the related paths before writing, without silently expanding the restoration scope.
- The dialog shows progress and blocks duplicate submissions. Partial failures keep the window open, show an error, and deselect successfully applied files for the next attempt. Inspect Changes and conflicts before retrying.
- Imported patches that cannot be split reliably, such as mail-prefixed or plain unified diffs, may require selecting the entire group. Full selection still supports restoration.

**Rename** changes the description. **Export Patch** writes the saved patch to a file; see [patches](./patches).

## Delete and restore a shelf

Delete moves a Shelf entry to Recently Deleted. Enable **Show deleted** to Preview or Restore one. Restore returns the Shelf record; you still need Unshelve to apply it to working files.

Ordinary deleted records have a **30-day** retention period and may be cleaned up afterward. System protection backups have additional retention rules. Recently Deleted is not long-term backup. Stash Drop/Clear does not share Shelf's recently-deleted mechanism.
