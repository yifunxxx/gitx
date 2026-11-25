# Feature index

This index connects the current desktop UI to task-oriented guides. Registered commands are checked against the source when documentation builds. Context menus and panel controls are covered in the chapter list as well.

## Browse by task

| Task | Guide |
| --- | --- |
| Install, open, create, clone, and make a first commit | [Read guide](./getting-started) |
| Panels, layouts, tabs, projects, and Find Action | [Read guide](./workspace) |
| Changelists, staging, commits, Amend, ignoring, and rollback | [Read guide](./commit) |
| Side-by-side/unified diffs, line staging, and limits | [Read guide](./diff) |
| File editing, batches, drag-and-drop, and path menus | [Read guide](./files) |
| Loaded-tree filtering, fuzzy jumping, and text search | [Read guide](./search) |
| Branch creation/checkout/rename/deletion, favorites, comparison, and tags | [Read guide](./branches) |
| Remotes, authentication, Fetch/Pull/Push, updates, and fork sync | [Read guide](./sync) |
| Log, filters, comparisons, file history, revision browsing, and restoration | [Read guide](./history) |
| Merge, Rebase, Cherry-pick, Smart preservation, and conflicts | [Read guide](./conflicts) |
| Interactive rebase, Reword, Squash, Drop, Fixup, Reset, Revert, and undo | [Read guide](./rewrite) |
| Create, apply, preview, delete, and restore Stash/Shelf records | [Read guide](./stash-shelf) |
| Local-change patches, Shelf export, and patch import | [Read guide](./patches) |
| Worktree creation/management, ref review, multiple roots, and submodules | [Read guide](./worktrees) |
| Interactive terminals, sessions, Console, and background jobs | [Read guide](./terminal) |
| Every settings field, appearance, language, keymap, and app updates | [Read guide](./settings) |

## Registered commands

Use Find Action (`Ctrl+Shift+A`) to search. Availability depends on repository state and selection. A blank default binding does not mean the feature is unavailable.

| Command | Windows default | Guide |
| --- | --- | --- |
| New Changelist | — | [Steps](./commit) |
| Commit | `Ctrl+K` | [Steps](./commit) |
| Create Patch… | — | [Steps](./patches) |
| Show Diff | `Ctrl+D` | [Steps](./diff) |
| Find in Files… | `Ctrl+Shift+F` | [Steps](./search) |
| Go to File… | `Ctrl+P` | [Steps](./search) |
| Open… | `Ctrl+O` | [Steps](./getting-started) |
| Save | `Ctrl+S` | [Steps](./files) |
| Add to VCS | `Ctrl+Alt+A` | [Steps](./commit) |
| Branches… | — | [Steps](./branches) |
| Accept Theirs | — | [Steps](./conflicts) |
| Accept Yours | — | [Steps](./conflicts) |
| Merge… | — | [Steps](./conflicts) |
| Cherry-Pick | — | [Steps](./conflicts) |
| Abort Cherry-Pick | — | [Steps](./conflicts) |
| Continue Cherry-Pick | — | [Steps](./conflicts) |
| Clone Repository… | — | [Steps](./getting-started) |
| Commit and Push… | `Ctrl+Alt+K` | [Steps](./commit) |
| Toggle Commit Controls | — | [Steps](./workspace) |
| Commit Tool Window: Docked | — | [Steps](./workspace) |
| Commit Tool Window: Float | — | [Steps](./workspace) |
| Commit Tool Window: Window panel | — | [Steps](./workspace) |
| Compare with Branch or Tag… | — | [Steps](./history) |
| Manage Remotes… | — | [Steps](./sync) |
| New Worktree… | — | [Steps](./worktrees) |
| Drop Commits | — | [Steps](./rewrite) |
| Drop Selected Changes | — | [Steps](./rewrite) |
| Fetch | — | [Steps](./sync) |
| Fixup into Selected Commit… | — | [Steps](./rewrite) |
| Ignore File… | — | [Steps](./commit) |
| Create Git Repository… | — | [Steps](./getting-started) |
| Extract Selected Changes… | — | [Steps](./rewrite) |
| Interactively Rebase from Here… | — | [Steps](./rewrite) |
| Compare with Local | — | [Steps](./history) |
| Merge… | — | [Steps](./conflicts) |
| Abort Merge | — | [Steps](./conflicts) |
| Commit Merge | — | [Steps](./conflicts) |
| Open .git/info/exclude | — | [Steps](./commit) |
| Pull… | — | [Steps](./sync) |
| Push… | `Ctrl+Shift+K` | [Steps](./sync) |
| Rebase… | — | [Steps](./conflicts) |
| Abort Rebase | — | [Steps](./conflicts) |
| Continue Rebase | — | [Steps](./conflicts) |
| Skip Current Commit | — | [Steps](./conflicts) |
| Refresh Status | `Ctrl+R` | [Steps](./workspace) |
| Reset Current Branch to Here… | — | [Steps](./rewrite) |
| Resolve Conflicts… | — | [Steps](./conflicts) |
| Abort Revert | — | [Steps](./rewrite) |
| Revert Commit | — | [Steps](./rewrite) |
| Edit Commit Message… | `F2` | [Steps](./rewrite) |
| Import Patch… | — | [Steps](./patches) |
| Shelve… | — | [Steps](./stash-shelf) |
| Show Stashes… | — | [Steps](./stash-shelf) |
| Show Worktrees | — | [Steps](./worktrees) |
| Show History | — | [Steps](./history) |
| Squash Commits… | — | [Steps](./rewrite) |
| Squash into Selected Commit… | — | [Steps](./rewrite) |
| Stage | — | [Steps](./commit) |
| Unstage | — | [Steps](./commit) |
| Stash… | — | [Steps](./stash-shelf) |
| Update Submodules | — | [Steps](./worktrees) |
| Undo Commit | — | [Steps](./rewrite) |
| Undo Last History Rewrite | — | [Steps](./rewrite) |
| Open Ref in Worktree | — | [Steps](./worktrees) |
| Sync Fork with Upstream… | — | [Steps](./sync) |
| Settings… | `Ctrl+,` | [Steps](./settings) |
| Enable Version Control Integration… | — | [Steps](./getting-started) |
| Show Commit Tool Window | `Alt+0` | [Steps](./workspace) |
| Show File Tool Window | `Alt+1` | [Steps](./workspace) |
| VCS Operations | — | [Steps](./workspace) |
| Show Repository at Revision | `Ctrl+Shift+O` | [Steps](./history) |
| Update Project… | `Ctrl+T` | [Steps](./sync) |

## Current UI boundaries

Per-hunk Stage/Unstage/Rollback controls, per-hunk changelist assignment, and per-file Unshelve selection are not exposed as complete workflows in this baseline. Some settings/backend primitives exist; the guides describe the actual available alternatives. Dedicated submodule registration, hosting-account management, PR Review, and platform MR tools are also outside this UI. Windows is the documented installer and screenshot platform; key definitions for other platforms do not establish published native packages.
