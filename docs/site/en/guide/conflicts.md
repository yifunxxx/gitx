# Merge, rebase & conflicts

## Choose the operation and direction

**Merge** integrates a target into the current branch. **Rebase** replays the current branch's commits on a new base. **Cherry-pick** applies selected commits to the current branch. Check the active repository, current branch, and unsaved files before starting.

## Merge

1. Open VCS → **Merge**, or choose merge into current from a branch menu.
2. Verify the current branch shown in the dialog and select the branches to integrate.
3. Configure options according to the project workflow, inspect the command preview, and run it.
4. Check Log afterward. With squash/no-commit, review Changes and commit as needed. If conflicts appear, follow the resolution workflow below.

| Option | Purpose |
| --- | --- |
| No fast-forward | Preserve a merge node |
| Fast-forward only | Accept only a fast-forward and stop on divergence |
| Squash | Combine the resulting changes for a subsequent ordinary commit |
| No commit | Stop for inspection when a merge commit would be created |
| Custom message | Supply the merge commit message |
| No verify | Skip applicable hooks |
| Allow unrelated histories | Permit histories without a common ancestor; use only intentionally |

## Rebase

1. Open **Rebase**, choose an upstream, and verify the current branch.
2. Enable **onto** to transplant onto another base; select a branch if you need to switch first.
3. Options include rebase-merges, keep-empty, root, update-refs, and autosquash. These affect merge topology, empty commits, root history, related refs, and automatic fixup/squash handling; inspect the preview.
4. Start an ordinary rebase, or choose Interactive to edit a plan as described in [rewriting history](./rewrite).

A rebase can stop at a conflict or a planned edit. Use **Continue** after handling it. **Skip** omits the commit currently being replayed; it does not postpone it. **Abort** stops the operation.

## Cherry-pick

Select one or more commits in Log and choose **Cherry-pick**. Their changes are applied to the current branch, potentially with new commit IDs. Resolve conflicts and use **Continue Cherry-pick**, or **Abort Cherry-pick** to stop. A setting can append the source commit identifier for protected sources.

## Local changes and Smart operations

A dirty working tree may trigger a **Smart Merge / Smart Rebase** prompt. After confirmation, gitx saves local changes, runs the operation, then restores that specific saved record when appropriate. Pauses, Squash, and pending commits can delay restoration.

If restoration fails, inspect Stash/Shelf, conflicts, and the state banner while keeping the saved record. Do not repeatedly pop unrelated old stashes. “Operation completed” and “local changes restored” are separate results to verify.

## Resolve conflicts file by file

1. Use the state banner or **Resolve Conflicts** to open the file list.
2. Select a text file and open the **Merge** editor.
3. The side panes are sources; the middle pane is the editable result. Read their branch/commit labels first. During rebase, Yours/Theirs can differ from your intuitive interpretation.
4. For each block, use the side arrow to **accept that side**, or X to **ignore that side**. Decisions are independent. To include both sides, accept them in the intended order and review the result.
5. Edit the middle result manually when needed. Replacing an existing manual result can require confirmation; you can keep manual content.
6. Navigate with Previous/Next or `Shift+F7` / `F7`. Undo/Redo reverses edits or choices.
7. Check the remaining-block count and the whole result, then click **Save and mark resolved**.
8. Return to the file list, verify all files are resolved, and continue the merge, rebase, or cherry-pick.

![The native three-pane conflict editor](/screenshots/conflicts-en.png)

**Accept Yours / Accept Theirs** in the file list normally chooses an entire file side. Use it only when that is the intended outcome. Binary and delete/modify conflicts need file-level decisions rather than text-block merging.

Closing an unapplied merge tab requires confirmation. A result that looks correct still needs to be saved as resolved before continuing the overall operation.
