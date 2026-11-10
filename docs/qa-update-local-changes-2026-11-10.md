# Update Project with local changes — 2026-11-10

Merge, Rebase and Reset now fetch first, save staged/unstaged and untracked changes in a uniquely identified stash, update, and restore with --index. Clean repositories never apply or pop an existing stash. Recovery uses the saved object ID, not stash@{0}. A cancelled update still completes its recovery using a separate cancellation token.

A failed operation with no merge/rebase in progress restores automatically. If the operation is paused on a genuine conflict, the saved copy remains in Stash; the error identifies its SHA and instructs the user to finish/abort the update before restoring it. A restoration conflict or untracked collision also keeps the saved copy and does not retry a partially applied patch. Successful restoration drops only that stash, with the existing backup mechanism retained.

The frontend refreshes status, refs/log, operation state, conflicts and Stash after failures. Refresh errors do not hide the original recovery message, and non-authentication failures no longer offer an Enter Credentials action.

## Validation

- Seven real Git integration tests passed in both the isolated and integration checkouts. They cover all three update methods, partial staging, untracked binary bytes, existing stashes, same-file nonoverlapping changes, restoration conflicts, untracked collisions, rebase conflicts with manual recovery after abort, fetch failures and pre-cancellation.
- Two additional GitRunner tests passed: command failure restores automatically; cancellation after the save and operation start still restores local changes.
- Existing m2_branches_sync suite: three tests passed.
- Two frontend recovery tests passed in both checkouts; typecheck passed in both; changed-file Oxlint passed.
- Tests use temporary local bare repositories. No update was run against the user's project-teamwork repository.
- Native end-to-end update verification is pending the combined QA executable; no frame-rate or native UI validation is claimed here.
