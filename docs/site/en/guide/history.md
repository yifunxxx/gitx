# Log, history & comparisons

## Browse Log

Click **Show Log** in the toolbar or **Log** in the bottom panel. Graph lines show parent relationships; rows show messages, authors, dates, and branch/tag labels. Select a commit to read its full message, parents, and Changed Files. Open a changed file to inspect that commit's diff.

![Example commit graph and branch list](/screenshots/history-en.jpg)

Ctrl-click selects multiple commits; Shift extends a range. The context menu can copy a revision, create a branch/tag, check out, compare, cherry-pick, or [rewrite history](./rewrite). Write actions depend on the number selected and repository state.

## Filter and locate commits

1. Enter message text, authors, branches/revision ranges such as `main..feature/search`, or file paths.
2. Choose a date condition and click **Apply**. **Clear** removes filters.
3. Additional controls include date/topological ordering, First parent, and hiding merge commits.
4. Use **Go to Hash / Branch / Tag** to locate a revision. If it is outside the loaded window, related history is loaded. Use the return-to-latest entry point to return to the current tip.

Scrolling to a boundary loads additional history; use Load more or newer-record controls when shown. Wide graphs can be inspected horizontally. The graph column is another presentation of the same commits.

**Log list mode** selects a flat list or branch-oriented tree. **Rebuild index** rebuilds a local index used for filtering; it does not create or rewrite commits. If filters return nothing, Clear them and check the revision scope.

## Compare commits or compare with local

- Select two commits and choose Compare, then inspect changed files and their diffs.
- Select one commit and choose **Compare with Local** to compare it with the working tree.
- Use Combined Diff to read multiple changed files together. Open a local file through File when you need to edit it.

The direction determines what counts as added or removed. Read labels again after swapping sides or changing a target. Comparing does not write files.

## File history

1. Choose **History / Show History** from Changes, File, or a changed-file menu in Log.
2. Select a revision to inspect its changes. Enable **All branches** if needed.
3. Use **Compare with Local** to compare against the current file.
4. Load additional history to inspect older records; use Retry after a loading error.

History follows earlier paths across renames. A first commit, deleted file, or merge commit may legitimately have an absent side; that alone is not a load failure.

## Browse the repository at a revision

Select a Log commit and use **Show Repository at Revision** (`Ctrl+Shift+O`). Browse directories and choose a file to read its historical text. **Up** goes to the parent, **Show History** opens file history, and **Compare with Local** compares it with the working file.

**Restore** writes the selected historical file into your working tree. Verify the revision, path, and any local content that may be overwritten before confirming. Restoration leaves local changes to review, stage, and commit. Reading a revision and restoring it are separate actions.

Binary or oversized content, invalid revisions, and unreadable objects produce messages. Retry or select the revision again; an error does not mean the file is empty.
