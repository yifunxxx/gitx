# Search and replace

| Task | Windows / Linux default | Scope |
| --- | --- | --- |
| Jump by filename | `Ctrl+P` | Fuzzy workspace paths |
| Find in Files | `Ctrl+Shift+R` | Saved UTF-8 text |
| Replace in Files | `Ctrl+Shift+H` | Selected matching files |
| Find in File | `Ctrl+F` / editor toolbar | Current buffer, including unsaved edits |
| Replace in File | `Ctrl+H` / editor toolbar | Editable file or conflict result |
| Next / previous match | `F3` / `Shift+F3` | Current editor |

macOS uses Cmd; Replace in File uses `Cmd+Option+F`. These actions, plus Replace Current Match and Replace All in File, are available in **Settings → Keymap** for rebinding. See [shortcuts](./shortcuts).

## Workspace search

1. Open a project or ordinary folder and press `Ctrl+Shift+R`.
2. Enter text. Inside the find field, toggle **Aa** for case sensitivity, **.\*** for regular expressions, and **W** for whole words. With regex disabled, the query is literal.
3. Narrow the scope with comma-separated include/exclude globs, such as `src/**, *.vue` and `dist/**, *.lock`. `**` spans directories; bare names match at any depth and directory names include descendants.
4. Toggle hidden and ignored files if needed. Initial values come from File settings; changes here affect this search only.
5. Results arrive while scanning, with paths, line/column positions, highlighted snippets, and every occurrence on a line. Pages contain 200 matches; paging does not restart the scan. Click a match or use Up/Down and Enter from the query field to open it.

Content search has no file-size, total-volume, elapsed-time or match-count cutoff. A background worker reads lines and spools results to temporary disk storage; the UI reads only the current page. Memory depends mainly on the longest line, and result storage needs free disk space. Cancel, change the query, close the dialog, or switch projects to stop scanning. The task queue shows scan progress.

When an exclude pattern matches a directory, search skips that directory and its descendants to avoid traversing dependencies or build output. Excluding `node_modules` skips that name at any depth; `build/**` only covers build output under the workspace root. Include patterns still traverse parents to find matching files. Exclusions take precedence over inclusions and remain active when hidden or ignored files are enabled.

Click **Cancel** beside the scan progress to stop scanning. Once it settles, results from fully scanned files remain available for paging. Provisional matches from an unfinished file are removed, so the total may decrease. Stopped results cannot be replaced: choose **Search again** and wait for completion first. Changing conditions, closing the dialog, or switching projects releases the old results.

While a page loads, the current page number and rows remain visible with a loading indicator; opening rows and paging are temporarily disabled. A successful read switches to the requested page. A failed read keeps the current page and offers **Retry**, which reads the failed target page without rescanning.

When refresh, stop, paging or retry makes the focused button unavailable, focus returns to the query field. Continue typing, select results with Up/Down, or press Esc to close. Esc does not interrupt an active replacement write; the dialog can be closed once writing finishes. Filename search also keeps keyboard focus inside the dialog after stopping or retrying.

Search reads saved UTF-8 text, not unsaved editor buffers. Binary, invalid-encoding and unreadable paths are reported with reasons (the first 20 reasons are displayed). Symlinks are not followed, and Git metadata is excluded. Global regex searches are line-based and support Unicode, character classes, groups, repetitions and captures. **Multiline matching, backreferences and lookaround are unsupported** and invalid expressions show an error.

LF, CRLF, CR and mixed line endings use the same line/column positions as the editor. Replacement preserves each original separator. Empty files and the final empty line after a separator also participate in regex searches; for example, `^$` matches these empty lines.

## Replace in Files

1. Press `Ctrl+Shift+H`, or select **Replace** above the search fields. Find and replacement fields align, and the title follows the selected mode.
2. Enter replacement text; empty text removes matches. Each result previews that individual replacement. Regex mode supports `$1` and `${name}` captures; `$$` inserts a dollar sign. Literal mode inserts the exact text.
3. All matching files are selected, including other pages. The footer shows the selected file count. Unchecking any row excludes every match in that file and dims its other rows.
4. Wait for the scan, save/close unsaved file drafts, and finish or close merge editors. Click **Replace in N files**, review the count, then **Confirm replacement**.
5. Search again and review the changes in Commit.

Replacement writes to disk without committing. Content hashes for every selected file are checked before writing; files changed since search require a new scan. Each file is published through a sibling temporary file, preserving line endings, UTF-8 BOM and permissions. A failure stops further writes and reports the completed count and error. This is not a transaction across all files: completed files are not automatically rolled back. Use Git diffs and rollback to undo, or keep backups for non-Git files. Clean open tabs for changed files are invalidated and closed to prevent saving stale content; unsaved drafts are preserved.

If the project changes during a write, the old search dialog closes and requests cancellation of further replacements. The task queue retains the source project's task until it settles. A notification identifies the source folder, completed count and any error; completed writes are not rolled back. Other file operations and saves are temporarily unavailable while the write finishes; retry them afterward.

## Find and replace in an editor

Focus an editor and press `Ctrl+F`. Selected text seeds the query. The bar starts as a single find row; use the left chevron to expand replace (`Ctrl+H` expands and focuses replace). Aa / .* / W inside the find field control case, regex, and whole-word matching. The up/down arrows navigate matches; **Find All** selects every match. Find and replace share the same field width, with actions moving below the fields in narrow panes. Focus and enabled options have distinct highlights. Editor regex uses JavaScript syntax, which differs from the global engine. The bar sits in the editor content area and does not cover Settings or other global dialogs.

Editable files and conflict results also provide replacement text with **Replace** / **Replace All** (`Ctrl+Alt+Enter` for replace-all) once replace is expanded. Changes remain in the buffer and support undo with `Ctrl+Z`. Save ordinary files with `Ctrl+S`; use the conflict editor's save workflow for merge results. Read-only diffs and conflict source panes support searching only. Escape closes the panel.

The **Find in Files** dialog shows the workspace and Find/Replace mode above the fields. Include/exclude have fixed labels; each result separates its path, line/column, matching text, and replacement preview. Scope fields stack in narrow windows, while the middle area scrolls and the footer keeps Cancel and Search/Replace available. The second replacement step highlights the file count and explains that confirmation writes to disk.

## Other search tools

`Ctrl+P` finds fuzzy filenames without expanding directories. This filename search still displays at most 500 results and reports scan limits; those limits do not apply to workspace **content** search (`Ctrl+Shift+R`).

File's toolbar **Locate current file** (crosshair) expands parents, scrolls to, and selects the active editor or Diff file. When nothing is open or the path is not in the tree, the control is disabled or shows a tip. **Filter loaded files** only filters loaded nodes. Log filters search history; `Ctrl+Shift+A` finds app commands. See [history](./history), [files](./files), and [workspace](./workspace).
