# Changes tree interaction QA — 2026-11-10

## Corrected behavior

- Only plain, non-repeated F4 opens a file. Modified F4 and IME composition are left untouched, including the native Alt+F4 window-close shortcut.
- Ctrl/Meta clicks extend or toggle a selection only inside its existing section. Moving to another section starts a new selection, including when the same path has both staged and unstaged changes.
- Right-click preserves a multi-selection only when the clicked path and section both match. Context-menu actions therefore use the selected row's actual version and paths.

## Automated validation

The new `changesInteraction.test.ts` mounts the actual Changes tree with the real Pinia store and virtual list. Before the fix, 12 of its 14 cases failed; all 14 pass after the fix. It covers plain/modified/composing/repeated F4, same-section toggles, cross-section Ctrl/Meta clicks, same-path context menus, same-section multi-selection preservation and other section types.

- Main worktree: 61 test files / 443 tests passed.
- Integration checkout: 86 test files / 610 tests passed.
- TypeScript and production builds passed in both checkouts; existing bundle-size/dynamic-import warnings remain.
- Changed-file Oxlint and `git diff --check` passed.
- Native integration build passed with `cargo build -p gitx --locked --features tauri/custom-protocol`.

## Native verification

Executable: `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-changes-interaction-20261110.exe`

SHA256: `A4F2B3769A95043D115855DFC2059572DFCB927F6927245CFC50AE29F6393A9A`

Fixture: `E:/IDEAproject/gitx/test-results/repos/changes-interaction-gui-20261110`. Both `a.txt` and `b.txt` have staged and unstaged edits.

Selecting staged `a.txt`, then right-clicking unstaged `a.txt`, moved the visible selection to the unstaged row. Choosing Show Diff opened the index-to-worktree comparison containing the `working` addition, rather than the previous HEAD-to-index comparison containing only `staged`.

Plain F4 opened a file-viewer tab. After restoring the original changelist-mode setting and focusing a Changes row, Alt+F4 exited the QA window. A fresh window inventory confirmed that the QA executable had no remaining window.

The fixture status, index entries and SHA256 of both working files were identical before and after GUI testing. Evidence is saved in `test-results/changes-interaction-gui-before.json` and `test-results/changes-interaction-gui-after.json` in the integration checkout. The installed executable was not replaced; integration changes outside the feature hunks were preserved.

Follow-up finding: the native F4 file-viewer tab displayed its header but no document body. The shortcut did dispatch correctly; file-viewer loading/render timing requires a separate fix. Native Ctrl/Meta mouse multi-selection was covered by component tests, not claimed as manually verified.
