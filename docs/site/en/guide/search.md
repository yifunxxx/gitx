# File & text search

## Choose the right search

| What you need | Entry point | Scope |
| --- | --- | --- |
| A name in an expanded tree | File → Filter loaded files | Loaded nodes and necessary ancestors |
| A file anywhere in the workspace | `Ctrl+P` / Go to File | Workspace files allowed by visibility rules |
| Text inside files | `Ctrl+Shift+F` / Find in Files | UTF-8 text saved on disk |
| An application command | `Ctrl+Shift+A` / Find Action | App actions |
| Commit messages, authors, or branches | Log filters | Git history; see [history](./history) |

## Jump by filename

1. Open a workspace and press `Ctrl+P`.
2. Enter part of a name or path, such as `app.ts` or `src/app`. Matching is fuzzy; there is no need to expand directories first.
3. Check result paths to distinguish files with the same name.
4. Select with Up/Down and press Enter to open. Esc cancels; use Retry after an error.

## Search file contents

1. Save any editor changes you want to search, then press `Ctrl+Shift+F`.
2. Enter text such as `Search`. Matching is **literal text**, not a regular expression.
3. Toggle case sensitivity if needed and wait for the results.
4. Each result shows its path, line, column, and a snippet. Open it to focus the matching location.

![Workspace text search and matching locations](/screenshots/search-en.jpg)

Only the first match per line is shown. Columns use UTF-16 positions, so an emoji may occupy two columns. Existing unsaved editor drafts are preserved. Because search reads disk, check the position again if the open draft differs from the saved file.

## Missing or incomplete results

Search follows File's hidden and ignored visibility settings. To include a hidden file such as `.env.example`, check **Settings → Project Files**. Binary, invalid UTF-8, oversized, and unreadable files can be skipped; the UI reports skipping or truncation. Incomplete results do not prove a string is absent from the entire project.

Search returns at most 500 results. Scanning is bounded by 15 seconds, 100,000 entries, 10,000 directories, and a depth of 256. Content search reads at most 5 MiB per file and 100 MiB total. If a limit is reached, open a smaller workspace, refine the query, or adjust visibility rules.

You can cancel a running search. After changing the query or workspace, use the latest result set. Both filename and content search also work outside Git repositories.
