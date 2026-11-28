# Log, history & comparisons

## Browse Log

Click **Show Log** in the toolbar or **Log** in the bottom panel. Graph lines show parent relationships; rows show messages, authors, dates, and branch/tag labels. Select a commit to read its full message, parents, and Changed Files. Open a changed file to inspect that commit's diff.

**Go to hash / branch / tag** adds a task while resolving the target and reading its history window. Once found, the target is selected and scrolled into view while its details load independently. Slow or failed details do not block navigation; retry a failed read in the details area. The same applies when the left arrow key jumps to a parent that has not been loaded yet.

While reading, the details area and task queue identify the revision being loaded. On failure, the details area keeps the error and a **Retry** button. Retrying details preserves multiple selections and the Shift-range anchor. A successfully loaded empty commit explicitly shows that it has no changed files, distinguishing it from loading or failure.

![Example commit graph and branch list](/screenshots/history-en.jpg)

Ctrl-click selects multiple commits; Shift extends a range. The context menu can copy a revision, create a branch/tag, check out, compare, cherry-pick, or [rewrite history](./rewrite). Write actions depend on the number selected and repository state.

## Filter and locate commits

1. Enter message text, authors, branches/revision ranges such as `main..feature/search`, or file paths.
2. Choose a date condition and click **Apply**, or press Enter in a filter field. **Clear** removes filters.
3. Additional controls include date/topological ordering, First parent, and hiding merge commits.
4. Enter a revision in **Go to Hash / Branch / Tag** and press Enter to locate it. If it is outside the loaded window, related history is loaded. Use the return-to-latest entry point to return to the current tip.

Confirming an input-method candidate does not apply filters or navigate; press Enter again after completing the text. Holding Enter or adding Ctrl, Alt, Shift, or Meta does not repeat these actions. Commit rows support continuous Up/Down navigation and Shift selection; ordinary Enter opens the commit's diff.

Scrolling to a boundary loads additional history; use Load more or newer-record controls when shown. Wide graphs can be inspected horizontally. The graph column is another presentation of the same commits.

If the initial history query or a filter fails, the filter bar stays available so you can correct the condition, clear it, or use **Retry** in the error area. The failed view does not present old commits as current results. Retry uses the current input conditions and returns focus to the message filter.

**Log list mode** selects a flat list or branch-oriented tree. **Rebuild index** rebuilds a local index used for filtering; it does not create or rewrite commits. If filters return nothing, Clear them and check the revision scope.

While a history query is running, **Loading commit history…** appears and the bottom-left task queue identifies the repository. The task disappears only after the query settles; only a genuine empty response shows no matches. While rebuilding, the button shows **Rebuilding…** and the bottom-left task queue identifies the repository's index task. You can keep filtering and browsing. Returning to the same repository does not start a duplicate rebuild. Completion updates the index status; after a failure, read the error and retry with the enabled button.

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

**Restore** writes the selected historical file into both your working tree and staging area. Verify the revision, path, and any local content that may be overwritten before confirming. Review and commit the restored changes. Reading a revision and restoring it are separate actions.

Save or close unsaved editor tabs for the affected files first, and finish or close their merge editors. Restore keeps these drafts intact. Wait for file loading, saving, or other file operations to finish before retrying. Affected editors become temporarily read-only and show **Restoring file…**. Successful writes close their old content tabs; reopening reads the disk version. Failure keeps the file tabs and text; resolve the reported cause and retry.

Binary or oversized content, invalid revisions, and unreadable objects produce messages. Retry or select the revision again; an error does not mean the file is empty.
