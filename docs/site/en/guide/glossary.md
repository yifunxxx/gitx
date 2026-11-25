# Git glossary

| Term | Meaning in gitx |
| --- | --- |
| Repository | A project with Git history and references; a workspace can contain several |
| Workspace | The open folder and the browsing scope of File |
| Working tree | Files currently being edited on disk |
| Index / Staging area | Content prepared for the next ordinary Git commit |
| Commit | A snapshot in Git history, with a message, author, and other metadata |
| HEAD | The currently checked-out commit or branch position |
| Branch | A movable reference to the current commit on a development line |
| Upstream | The remote-tracking branch used for synchronization; also a common parent-remote name, depending on context |
| Remote | A named server-repository configuration, such as origin |
| Fetch | Download commits and refs without automatically integrating them |
| Pull | Retrieve and integrate remote changes |
| Push | Send commits to a remote and update its refs |
| Diff | Differences between two versions |
| Hunk | A contiguous block of differences |
| Changelist | A gitx grouping of local changes by task, not a Git branch |
| Stash | A Git-managed record of temporarily saved changes |
| Shelf / Shelve / Unshelve | A gitx saved record, and the operations to save/apply it |
| Patch | A file describing text/binary changes, importable into Shelf |
| Merge | Integrate another history into the current branch |
| Rebase | Replay commits on another base, normally producing new hashes |
| Cherry-pick | Apply the changes from selected commits to the current branch |
| Conflict | Content Git cannot combine automatically and needs you to resolve |
| Amend | Replace the latest commit's content or message |
| Revert | Create an inverse commit while retaining the original history |
| Reset | Move a branch position and handle index/working files according to a mode |
| Detached HEAD | A commit checked out directly without a local branch; create a branch before continuing development |
| Tag | A name for a commit, often a version; not the same as publishing an installer |
| Worktree | Another independent working directory for the same repository |
| Submodule | A separate Git repository and specific commit referenced by a parent |
| Hook | A project script run around Git operations that may reject a commit |
| Force with lease | Replace remote history subject to an expected remote state; still requires coordination |

Start with your [first commit](./getting-started), or see [troubleshooting](./troubleshooting) for recovery.
