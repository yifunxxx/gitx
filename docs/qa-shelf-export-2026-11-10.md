# Shelf patch export — 2026-11-10

Active Shelf entries now offer **Export Patch…** from their toolbar and context menu. The native save dialog selects a destination and handles overwrite confirmation. Export reads the saved metadata/patch snapshot, including its current generation after partial application; it does not recompute a diff from the working tree. Deleted entries can be restored before exporting.

The backend stages complete bytes in a sibling temporary file, flushes them and replaces the destination. Failed reads, cancellation, locked targets and failed publication preserve existing destination contents. Git metadata destinations are rejected, including linked worktrees, separate Git directories and directory junction aliases. Existing destination links, directories, read-only files, relative paths and Windows alternate data streams are rejected. Filesystem work runs in a blocking task, outside the async worker pool, and the command uses the existing repository scheduler.

The frontend retains the original Shelf ID across selection changes, guards duplicate dialogs, abandons submission after repository/navigation changes or entry removal, and suppresses late feedback. Export does not refresh working changes or alter selection. Browser demo mode reports that export requires the desktop app rather than claiming to have created a file.

## Automated verification

- Main worktree: **44 frontend files / 364 tests passed**; production build and typecheck passed.
- Integration checkout: **69 frontend files / 531 tests passed**; production build and typecheck passed. Feature hunks were synchronized without replacing independent improvements.
- **9 Rust integration tests passed**: exact binary/rename/Unicode patch round trip, current generation, missing/deleted/damaged sources, metadata/invalid destinations, linked worktree access, cancellation, separate Git directories, Windows directory junctions and locked destination cleanup.
- Standalone native build passed with `cargo build -p gitx --locked --features tauri/custom-protocol`. Integration `cargo check -p gitx --locked` passed.
- Changed-file Oxlint reported only the existing unrelated `no-useless-spread` warning in `mock.ts`. Rustfmt passed for the new Rust files and Shelf command file. Existing frontend bundle-size warnings remain.
- Exported Specta bindings to `test-results/shelf-export-generated-bindings.ts` explicitly. Added the generated request/signature through each checkout's existing raw-invoke adapter (`invoke` in main, `TAURI_INVOKE` in integration); no wholesale binding replacement.

Logs are under the integration checkout's `test-results/shelf-export-*.log`.

## Native verification

Executable: `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-shelf-export-qa.exe`.

SHA256: `1c207f4ca45add8dafb1e801d096691291c8b15d04a89fd8975df5088426d8ca`.

Used the existing `shelf-files-gui-20261110` fixture and Shelf `016e6b29-fff1-4994-abe0-8fd5ef90bbe6` containing 10,000 files. Opened the toolbar export dialog, cancelled with Escape and observed the action controls becoming available again. Opened the context menu and exported through its action to `test-results/shelf-export-gui-20261110.patch`.

The exported **2,410,405 bytes** match the saved patch byte for byte (SHA256 `71e11ab4eb5b9e060102bdd5956805267a7a891e5c324d1588501e79daca8498`). Git parsed all 10,000 paths with `git apply --numstat -z`. The working file hash, staged entries, Shelf metadata and saved patch hash were unchanged. Evidence: `test-results/shelf-export-gui-before.json` and `test-results/shelf-export-gui-after.json`.

Also completed the previous file-list follow-up: Tab entered the expanded list, End rendered the final paths including the long final path in accessibility text, Home returned to the first file, and Escape collapsed the list and returned the row's focus outline. The compact pane clipped the last visible row until outer scrolling; a hover tooltip was not verified. The standalone QA window was closed after testing.

Patch diff viewing and target-changelist controls remain follow-ups; this completes saved-patch export only.
