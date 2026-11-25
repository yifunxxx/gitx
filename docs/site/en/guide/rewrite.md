# Rewriting & undoing history

Rewriting changes commit IDs and is usually appropriate for work you have not shared. Verify the range in Log and create a backup branch from the original HEAD when needed. Prefer Revert for shared commits.

## Choose an operation

| Goal | Command | Result |
| --- | --- | --- |
| Change the latest commit | Commit → Amend | Replace HEAD, adding content or editing its message |
| Edit an older message | Log → Edit Commit Message / F2 | Rewrite that commit and affected descendants |
| Combine several commits | Squash Commits | Select at least two commits and supply a combined message |
| Fold local fixes into an older commit | Fixup / Squash Into | Fold local changes into the target; Squash Into allows a combined message |
| Remove commits | Drop Commits | Omit selected commits from rewritten history |
| Undo the latest commit but retain changes | Undo Commit | Soft-reset HEAD, leaving changes staged |
| Undo published changes | Revert Commit | Create an inverse commit without removing the original history |
| Move the current branch to a commit | Reset Current Branch to Here | Handle index and working files according to the chosen mode |

## Reword, squash, or drop

1. Select the target in Log. Use Ctrl/Shift for multiple commits.
2. Choose the operation and verify hashes, messages, and count.
3. Preserve any required message body. A squash message should describe the combined change.
4. Wait for completion and inspect the new Log. If conflicts interrupt it, follow [conflict resolution](./conflicts).

The backend validates the range. Arbitrary cross-branch, noncontiguous, or merge-history selections are not necessarily valid for direct rewriting.

## Interactive rebase

Select a starting commit in Log and open **Interactively Rebase from Here**. Wait for the generated plan. Read its range, order, and preview; Log's newest-first display is not necessarily the execution order.

| Action | Meaning |
| --- | --- |
| pick | Keep and replay the commit |
| reword | Replay and edit the message |
| edit | Pause at the commit so you can modify it before continuing |
| squash | Combine with the preceding commit and edit the message |
| fixup | Combine with the preceding commit and discard this message |
| drop | Do not replay the commit |

Set the action for each row. Use **Reset actions** if needed, then **Start Rebasing**. If a generated plan contains merge-control rows, follow the dialog's explanation instead of treating them as arbitrary movable commits. Continue, Skip, or Abort after a pause; Skip omits the current commit.

## Extract or drop selected files from a commit

Select one commit and open **Extract Selected Changes** or **Drop Selected Changes**. Search and check paths in the file dialog. Extraction also requires a new commit message. Verify and apply. This selection is **file-level**, not an arbitrary line selection in Diff. See [Diff](./diff) for partially staging local changes.

## Reset modes

Select a target commit, open Reset, and review the affected commit count and local-change warning.

| Mode | Effect |
| --- | --- |
| Soft | Move HEAD and retain the index and working files; changes remain ready to commit |
| Mixed (default) | Move HEAD and reset the index, retaining working edits as unstaged changes |
| Hard | Move HEAD, index, and working files, discarding affected local content; requires an additional confirmation |
| Keep | Attempt to move HEAD while retaining local changes; reject overlapping edits |

Preserve needed work before Hard reset. It does not have the same recovery behavior as deleting files to the recycle bin.

## Revert and recovery

Revert creates a new commit that reverses an earlier change, making it useful for shared history. If it conflicts, inspect the state banner, resolve the files, and use the available continuation path. Use **Abort Revert** to cancel.

**Undo Last History Rewrite** is available when a supported undo record exists. It returns to before the most recent supported rewrite, not arbitrary file deletions or every Git operation performed outside the app. Preserve current work first. If unavailable, inspect backup branches, Git reflog, or saved records rather than repeating an uncertain rewrite.
