# Worktrees, roots & submodules

## Work on several branches with worktrees

A worktree shares a Git repository's objects and references while providing another independent working directory. Keep development intact while opening a separate folder for a fix or review.

1. Open **Show Worktrees** through Find Action, or run **New Worktree** directly.
2. Enter a starting reference such as `HEAD`, `main`, `origin/feature/search`, or a commit SHA.
3. Enter a new branch name if needed and choose whether to Track.
4. Inspect the suggested directory or choose another. Avoid overwriting an existing working directory.
5. Choose whether to open it after creation, then create it. Check its path, branch, and HEAD in the list.

A local branch normally cannot be checked out in two worktrees at once. If it is already checked out, use a new branch or open the existing worktree.

## Manage worktrees

| Command | Purpose |
| --- | --- |
| Open Here | Open the selected working directory in this window |
| Lock / Unlock | Lock a record with a reason, or release the lock |
| Remove | Remove the selected worktree; verify its path and pending edits. Current/main/locked entries have protections |
| Prune | Clean stale management records; this does not mean deleting all branches |
| Refresh | Reload the list |

Save or commit work before removing its directory, and read the confirmation. A failure can mean local modifications, an occupied path, or a changed record.

## Open a remote ref or PR head

Run **Open Ref in Worktree**. Choose the remote, enter a refspec or PR number, and set the review name and directory. A number such as `123` is interpreted as GitHub's `refs/pull/123/head`. For another host, provide a supported full ref, such as `refs/merge-requests/123/head`.

Check the resulting directory and branch/HEAD. This feature retrieves Git references; it does not provide hosting-platform comments, review approvals, or PR merging.

## Multiple repositories in one workspace

Open a parent folder containing recognized repositories and switch the active root with the repository selector. File retains the workspace tree. Ownership labels use the deepest matching repository, while Commit and Log follow the active root.

Files owned by another repository can be read as disk text. Switch the active repository before using their Git Diff/History. Unsaved drafts can block switching; handle them first.

**Execute branch operations on all roots** affects multi-repository operations, particularly checkout. When enabled, do not assume only the active root is affected. Inspect each repository's result and failure/rollback messages. Disable it when intending to operate only on the active repository. Multi-root work can partly complete, so check more than the visible branch label.

## Update existing submodules

Run **Update Submodules** through Find Action. Wait for completion and review updated, skipped, and failed counts and paths. Update Project can also update related submodules according to its existing policy.

A submodule is a separate Git repository whose commit is recorded by its parent. Commit changes inside the submodule, then commit the updated pointer in the parent. One parent commit does not automatically commit every submodule.

This guide covers updating existing submodules. Dedicated graphical add/register and recursive-clone wizards are not part of the current UI; use Git tools where needed, then refresh gitx.
