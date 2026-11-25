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

This version displays hunks, but the desktop Diff does not currently expose separate per-hunk Stage/Unstage/Rollback buttons. For the available line-staging UI, see below. For pure deletions or interactive hunk selection, use standard Git in a repository terminal:

```sh
git add -p -- path/to/file
```

Choose hunks at Git's prompts, then refresh gitx and inspect Staged. To unstage hunks while retaining working files, use `git reset -p -- path/to/file`. Backend capability does not imply that a corresponding UI button exists.

## Stage individual lines

The current **Stage selected lines** command uses a line-number prompt:

1. Open a normal text diff comparing **Staged → Local**.
2. Click **Stage selected lines**.
3. Enter the actual added or modified line numbers on the right, such as `4, 7` or `4 7`, separated by commas or spaces.
4. Confirm and review the new staged diff. Arbitrary text selected with the mouse is not treated as a patch.

Only stageable new-side changed lines are accepted. Range syntax such as `4-7`, unchanged lines, and old-side deletion line numbers are not supported here. Use Git's interactive hunk selection above for pure deletions or complete replacements.

::: tip Verify the final commit
After partial staging, use Staging mode and inspect **HEAD → Staged**. Selecting a whole-file commit afterward may also include edits you intended to leave out.
:::

## Multiple files and large content

Choose files in Log or comparison views to inspect individual diffs. **Combined Diff** presents multiple changed files together; still check the direction for each comparison. Use Retry when loading fails. Binary or oversized content is reported as unsuitable for text comparison, not as identical; use an appropriate external tool.
