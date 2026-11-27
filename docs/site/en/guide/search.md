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
2. Enter text. Toggle **Aa** for case sensitivity, **ab** for whole words, and **.\*** for regular expressions. With regex disabled, the query is literal.
3. Narrow the scope with comma-separated include/exclude globs, such as `src/**, *.vue` and `dist/**, *.lock`. `**` spans directories; bare names match at any depth and directory names include descendants.
4. Toggle hidden and ignored files if needed. Initial values come from File settings; changes here affect this search only.
5. Results arrive while scanning, with paths, line/column positions, highlighted snippets, and every occurrence on a line. Pages contain 200 matches; paging does not restart the scan. Click a match or use Up/Down and Enter from the query field to open it.

Content search has no file-size, total-volume, elapsed-time or match-count cutoff. A background worker reads lines and spools results to temporary disk storage; the UI reads only the current page. Memory depends mainly on the longest line, and result storage needs free disk space. Cancel, change the query, close the dialog, or switch projects to stop scanning. The task queue shows scan progress.

Search reads saved UTF-8 text, not unsaved editor buffers. Binary, invalid-encoding and unreadable paths are reported with reasons (the first 20 reasons are displayed). Symlinks are not followed, and Git metadata is excluded. Global regex searches are line-based and support Unicode, character classes, groups, repetitions and captures. **Multiline matching, backreferences and lookaround are unsupported** and invalid expressions show an error.

## Replace in Files

1. Press `Ctrl+Shift+H`, or enable **Show replacement preview** in search.
2. Enter replacement text; empty text removes matches. Each result previews that individual replacement. Regex mode supports `$1` and `${name}` captures; `$$` inserts a dollar sign. Literal mode inserts the exact text.
3. All matching files are selected, including other pages. Unchecking any row excludes every match in that file and updates its other rows.
4. Wait for the scan, save/close unsaved file drafts, and finish or close merge editors. Click **Replace in N files**, review the count, then **Confirm replacement**.
5. Search again and review the changes in Commit.

Replacement writes to disk without committing. Content hashes for every selected file are checked before writing; files changed since search require a new scan. Each file is published through a sibling temporary file, preserving line endings, UTF-8 BOM and permissions. A failure stops further writes and reports the completed count and error. This is not a transaction across all files: completed files are not automatically rolled back. Use Git diffs and rollback to undo, or keep backups for non-Git files. Clean open tabs for changed files are invalidated and closed to prevent saving stale content; unsaved drafts are preserved.

## Find and replace in an editor

Focus an editor and press `Ctrl+F`. Selected text seeds the query. The bar starts as a single find row; use the left chevron to expand replace (`Ctrl+H` expands and focuses replace). The panel provides case, whole-word and regex options, previous/next, and select all matches. Editor regex uses JavaScript syntax, which differs from the global engine. The bar is anchored to the current editor content area and does not cover Settings or other global dialogs.

Editable files and conflict results also provide replacement text, Replace Current Match, and Replace All in File (`Ctrl+Alt+Enter`) once replace is expanded. Changes remain in the buffer and support undo with `Ctrl+Z`. Save ordinary files with `Ctrl+S`; use the conflict editor's save workflow for merge results. Read-only diffs and conflict source panes support searching only. Escape closes the panel.

## Other search tools

`Ctrl+P` finds fuzzy filenames without expanding directories. This filename search still displays at most 500 results and reports scan limits; those limits do not apply to workspace **content** search.

File's **Filter loaded files** filters loaded tree nodes. Log filters search history; `Ctrl+Shift+A` finds app commands. See [history](./history) and [workspace](./workspace).
