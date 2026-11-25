# Diff & partial staging

## Open and read a diff

Double-click a file in Changes, or select it and press `Ctrl+D`. First inspect the version labels:

| Direction | Meaning |
| --- | --- |
| HEAD → Staged | Last commit versus index: content already prepared for committing |
| Staged → Local | Index versus disk: content not yet staged |
| Revision → Revision / Local | Two commits, or historical content versus the working file; generally a reading view |

![A Staged-to-Local side-by-side diff](/screenshots/commit-diff-en.jpg)

Red marks removed content and green marks additions. Left-hand line numbers belong to the old version; right-hand numbers belong to the new version. Renames use the corresponding path on each side.

## Reading controls

Switch between **Unified** and **Side by side**, adjust **Whitespace**, and collapse or expand unchanged content in the toolbar. Ignoring whitespace changes the display; it does not format or save files. An end-of-line warning can indicate LF/CRLF differences even when visible text looks identical.

Diff views are read-only. To edit the working file, press **F4 in Changes** or open it from File, then save. Viewing historical content does not write it into your working file.

## Operate on a hunk

Each block has buttons in the right pane's gutter, or beside the block in Unified mode. Hover or use Tab to focus a button for its action name:

| Direction | Button | Result |
| --- | --- | --- |
| Staged → Local | **+ Stage block** | Put only this block in the index, keeping other local edits |
| HEAD → Staged | **− Unstage block** | Remove this block from the index, leaving the working file unchanged |
| Staged → Local | **↶ Roll back block** | Confirm to discard this block's unstaged changes, keeping other blocks and staged content |

These actions work in both layouts with unchanged content collapsed or expanded, including pure deletions. Rolling back the only block of a new file removes that working file; rolling back a deleted file restores it. Rollback cannot be undone, so check the path and block number.

Buttons stay disabled while the action runs, and the task queue shows the operation. Changes and the current Diff refresh afterward. If the write succeeds but refresh fails, the message distinguishes the two; use **Refresh and review** without repeating the write. If background or external edits change the preview, the old block is rejected. Refresh and review before retrying.

Block actions are available only for normal text files in the two comparisons above. Show all whitespace changes first; historical comparisons, rename comparisons, Combined Diff, binary and oversized files do not expose these actions. Per-hunk changelist assignment is still unavailable. The web demo cannot execute real Git block operations; use the desktop application.

## Stage individual lines

The current **Stage selected lines** command uses a line-number prompt:

1. Open a normal text diff comparing **Staged → Local**.
2. Click **Stage selected lines**.
3. Enter the actual added or modified line numbers on the right, such as `4, 7` or `4 7`, separated by commas or spaces.
4. Confirm and review the new staged diff. Arbitrary text selected with the mouse is not treated as a patch.

Only stageable new-side changed lines are accepted. Range syntax such as `4-7`, unchanged lines, and old-side deletion line numbers are not supported here. Use the block buttons above for pure deletions or complete replacements.

::: tip Verify the final commit
After partial staging, use Staging mode and inspect **HEAD → Staged**. Selecting a whole-file commit afterward may also include edits you intended to leave out.
:::

## Multiple files and large content

Choose files in Log or comparison views to inspect individual diffs. **Combined Diff** presents multiple changed files together; still check the direction for each comparison. Use Retry when loading fails. Binary or oversized content is reported as unsuitable for text comparison, not as identical; use an appropriate external tool.
