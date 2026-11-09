# Shelf recently deleted and restore — 2026-11-10

The Shelf panel now exposes the existing deleted-Shelf storage and restore commands. Restoration returns a saved patch to the active Shelf list; it does not apply the patch to the worktree or index. The web demo now retains deleted entries and implements the same list/restore lifecycle.

## Interaction and request safety

- Recently deleted is opt-in and can be hidden again. Hiding clears the deleted selection and invalidates outstanding list requests.
- Active/deleted selections are exclusive. Rows support click, arrows, Home/End and keyboard context menus. Double click only selects.
- Active context menus offer Unshelve, Rename and Delete; deleted entries offer Restore. F2/Delete apply only to active entries, with the existing confirmation and mutation guards.
- Menus capture stable IDs and repository/navigation tokens. Navigation, removed targets and busy operations cannot submit stale actions.
- Restore uses the existing per-repository write guard through refresh. A late result cannot change another repository or override a newer selection. Successful selected restores focus the corresponding active row.

## Automated verification

- Main worktree: 43 frontend test files, **347 tests passed**; production build and typecheck passed.
- Integration checkout: 68 frontend test files, **514 tests passed**; production build and typecheck passed.
- Added 23 tests: 9 store cases, 11 interaction cases and 3 mock-backend cases. Includes rapid show/hide/show, duplicate restore during refresh, navigation/A→B→A, failures, hidden targets, changed selection, menu lifetime, focus and keyboard behavior.
- Changed-file Oxlint: no errors; one pre-existing `no-useless-spread` warning elsewhere in `mock.ts` in each checkout. Builds retain existing chunk-size and mixed-import warnings.
- Standalone native build passed with `cargo build -p gitx --locked --features tauri/custom-protocol` using the isolated target directory.
- Integration synchronization preserved its independent improvements and additional tests.

## Native verification

Executable: `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-shelf-restore-qa.exe`.

SHA256: `dcba383b236a51e95917a6f2d5473d6e42009efcaf60771b964e52156e95e2aa`.

Disposable fixture: `E:/IDEAproject/gitx/test-results/repos/shelf-restore-gui-20261110`.

Two deleted entries were prepared directly in disposable fixture storage, including one using `patchFile` and a retained older patch. The repository had different staged and unstaged contents in `local.txt`.

Verified in the actual desktop window:

1. Show recently deleted loads both entries; double click selects without restoring.
2. Arrow/Home navigation and Shift+F10 work; Escape closes the menu and returns focus.
3. Restore button moves the first entry into the active list.
4. Right click on the second entry exposes only Restore; Enter restores it.
5. The restored row has keyboard focus, demonstrated by immediately opening its active Shelf menu with Shift+F10.
6. The deleted list becomes empty and can be hidden. The original pane height was restored and the QA window closed.

Before/after evidence: `test-results/shelf-restore-gui-before.json` and `test-results/shelf-restore-gui-after.json` in the integration checkout. Assertions verified identical SHA256 for every metadata/patch file (including the older patch), identical worktree files, identical staged entries, and identical cached/uncached diffs. Both entries moved from `.deleted` to active storage.

This change exposes the existing restore behavior. It does not add patch preview/export, per-file Shelf expansion, retention policies, or alter backend reference retention.
