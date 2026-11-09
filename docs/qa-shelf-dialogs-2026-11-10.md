# Shelf dialog safety QA — 2026-11-10

Shelf creation previously read repository/selection state after an asynchronous prompt, allowing a stale dialog to operate on a different repository or selection. Rename could similarly use a newly selected Shelf. Creation/deletion prompts also bypassed the shared pending-operation guard.

Creation now captures paths before opening its options dialog and holds the shared write guard through input, execution and refresh. The dialog adds an explicit keep-local-changes option. The changes context menu and global Shelve action use this same path. Empty creation has its own localized message; backend errors refresh the saved Shelf list even when cleanup failed.

Deletion holds the guard while awaiting confirmation, and rename captures the Shelf ID/message at invocation. Both reject stale repository navigation, including A → B → A. Rename continues to target the original Shelf if only the current row selection changes. The existing guarded direct rename method is retained.

Automated checks:

- Full main frontend suite: 41 files / 318 tests pass.
- Full integration frontend suite: 66 files / 485 tests pass.
- Both frontend builds/typechecks pass, as do changed-file Oxlint and diff whitespace checks.
- Tests cover creation selection snapshots, overlapping dialogs, navigation invalidation, cancellation, keep-local options, cleanup errors, empty work, deletion confirmation, captured rename identity and stale rename prompts.
- Evidence: `test-results/shelf-dialog-{main,integration}-{tests,build}.log` in the integration checkout.

The integration checkout retains its independent Shelf keyboard navigation and other improvements. Native GUI validation uses its compiled executable and is recorded below; this change does not claim WSL coverage.

## Native Windows verification

Built with `cargo build -p gitx --locked --features tauri/custom-protocol`. Launched the uniquely named `gitx-shelf-dialog-qa.exe` and checked its actual process path. SHA256: `8A45F02DCF74FE3C098A636022A1DF0E945A9A1C1A12BE91904AAC2EC076C958`.

- Opened the disposable `unshelve-safety-20261110` repository. README had different working and staged content.
- Opened Shelve from the changed-file context menu. The selected count, description and keep-local option were visible without clipping. Escape closed the dialog on its first lazy mount.
- Reopened the dialog, entered `QA keep local changes`, checked keep-local and submitted. The Shelf list opened/refreshed and showed the new entry. A filesystem/Git comparison confirmed both working and staged bytes were unchanged and the new patch contained the captured working version.
- Renamed the new Shelf with Enter; the same ID persisted with its new name.
- Opened the deletion confirmation, cancelled it with Escape, and verified both Shelves and both local versions remained present.
- Closed the test window normally and verified the process exited.

Evidence: `test-results/shelf-dialog-gui-before.json`, `shelf-dialog-gui-created.json`, `shelf-dialog-gui-final.json`. The new test Shelf ID is `3af00a54-3e44-420e-aaed-81c0b2423064`. The five store mutation functions exercised by the integration app were compared with the current branch for exact source equivalence.
