# Files & editing

File shows the workspace's files, including unchanged ones. It also works with ordinary folders that are not Git repositories.

## Browse and edit

1. Click **File** on the left stripe or press `Alt+1`.
2. Expand directories using their arrows. Loading is on demand; unopened subdirectories are not all scanned in advance.
3. Single-click to select. Double-click or press Enter to open a text editor. Edit and press `Ctrl+S`; the unsaved marker clears when saving completes.
4. The editor context menu provides Undo, Redo, Cut, Copy, Paste, Select All, and Save.

![The File tree and text editor](/screenshots/files-en.jpg)

Git markers show changes. Parent-directory markers summarize changed descendants. With compact directories enabled, a loaded single-child directory chain can appear as `src/components/ui`.

## Create, rename, copy, move, and delete

| Operation | Steps |
| --- | --- |
| New file or directory | Select the destination directory, use a toolbar button or **New File / New Directory**, enter a name, and confirm |
| Rename | Select one item and press F2 or choose Rename; enter its new name. Open editors follow the new path |
| Copy To | Select items, choose **Copy To**, enter the destination directory, and confirm; originals remain |
| Move To | Choose **Move To**, enter the destination directory, review the list, and confirm |
| Delete | Press Delete or choose Delete, review the scope, and confirm; items go to the system recycle bin |

Existing destinations are not silently overwritten. A batch can partly succeed; inspect each result. Failed recycling preserves the source instead of falling back to permanent deletion. Restore files through Windows Recycle Bin, then refresh gitx.

A directory cannot move into itself or a descendant. Repository roots, conflicted files, destinations outside the workspace, and some link or cross-volume operations have restrictions. Read the failing path and reason before retrying a partly completed operation.

## Select and drag items

Ctrl-click toggles individual items; Shift extends a range. Dragging to a directory normally moves the selection. Hold Ctrl or Alt to copy. Dropping in the root background targets the workspace root. Review the confirmation after dropping.

Hover over the Commit stripe entry while dragging to switch panels, then drop on a changelist to assign eligible changes. Dragging an unchanged file does not create a Git commit.

## Useful context-menu commands

- **Copy Path / Copy Relative Path** copies absolute or workspace-relative paths; multiple items can be copied together.
- **Reveal** shows the target in the system file manager.
- **Open in Terminal** starts terminal work in the target directory.
- **Show Diff / History** applies to eligible files in the active Git repository. Files in another repository or an ordinary folder generally open as text.

**F4 in File opens Diff**. Use Enter or double-click to edit. See the [shortcut reference](./shortcuts).

## Hidden and ignored files

Open **Settings → Project Files** to show hidden files, show ignored files, or compact directories. These settings are independent of Commit's ignored-file setting. `.git` metadata is not treated as an ordinary editable project tree.

**Filter loaded files** filters only nodes already loaded. Use `Ctrl+P` or `Ctrl+Shift+F` for a workspace-wide search. See [search](./search).

## Text editing limits

File text opening and saving supports UTF-8 text up to 5 MiB per file. Binary, invalid UTF-8, and oversized files produce a message. Resolve conflicts before saving through the normal editor. Unsaved drafts are not on disk and are not included in content search. If a draft blocks repository navigation, save or handle it first.
