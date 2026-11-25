# Importing & exporting patches

Patches transfer file changes without requiring another person to have your local Shelf data. They can contain source code and other file content, so inspect them before sharing.

## Create a patch from local changes

1. Open a repository and select the intended files in Changes. If no rows are selected, the command uses checked files; with neither, it uses the default scope.
2. Run **Create Patch** from the VCS menu or Find Action.
3. Wait for the success message and note its output path and byte count. The default is `gitx/changes.patch` within Git's metadata directory; later exports reuse it, so copy an earlier patch elsewhere if you need to retain it.
4. Open the generated `.patch` and verify its scope. This entry point may write directly to a default path instead of showing Shelf's Save As dialog.

This command compares HEAD with local content and supports binary patches. **Untracked files are not automatically included**: Add/Stage them before exporting. A repository without a first commit has no HEAD; create its initial commit first. Creating a patch does not commit, push, or send it to anyone. Keep separate backups of important content.

## Export an existing shelf

1. Select an active Shelf record in Stashes & Shelves.
2. Use **Preview** to inspect its saved content.
3. Click **Export Patch** and choose a destination and `.patch` / `.diff` filename in the system save dialog.
4. Wait for completion and verify the file. Canceling the save dialog does not export anything.

The export comes from the selected record. Later working-tree edits are not automatically added.

## Import a patch into Shelf

1. Open the repository that should receive the changes.
2. Click **Import Patch** and choose a `.patch` or `.diff` file.
3. Inspect the new Shelf record, expand its files, and Preview it.
4. When satisfied it applies to this repository, Unshelve it, then review, test, and commit the resulting Changes.

**Import creates a Shelf record without immediately changing working files.** This allows inspection before application. If paths or contents are unsuitable, keep the working tree as it is and read the error.

## If application fails

Possible causes include a different baseline, overlapping local edits, renamed paths, or unsupported patch content. Save local work before trying a matching baseline. After partial success, inspect Changes and the remaining Shelf record rather than applying the whole patch repeatedly.

For independently applicable tasks, create separate shelves before exporting. The current Shelf UI does not expose per-file Unshelve checkboxes. See [Stash & Shelf](./stash-shelf).
