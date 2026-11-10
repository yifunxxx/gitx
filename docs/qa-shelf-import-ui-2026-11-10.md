# Shelf import entry points QA — 2026-11-10

The backend exposed patch import, but the Shelf tab and action registry had no import entry point. The Shelf/combined toolbar, Git menu and VCS operations palette now offer Import Patch. A successful global action opens the Shelf tab; successful imports select the saved entry and use the patch filename as its editable message.

The shared mutation guard spans native file selection, backend import and related refreshes. It blocks overlapping Stash/Shelf operations and rejects a picker result after navigation starts or after A → B → A. Late backend results cannot change another repository's selection or feedback. Native dialog cancellation leaves storage unchanged; failures remain visible and release the guard. Browser preview uses the existing path prompt convention. English and Chinese labels are provided.

Automated validation:

- Main frontend: 41 files / 323 tests pass; integration frontend: 66 files / 490 tests pass.
- Both frontend builds/typechecks pass. Existing large-chunk/dynamic-import warnings remain.
- Changed-file Oxlint and whitespace checks pass.
- Five new cases cover picker requests, duplicate operations, original repository capture, cancellation, errors, late results, selected import identity, and toolbar visibility/disabled state.
- Integration edits preserve its existing Shelf keyboard navigation, action entries, translations and additional tests.

Evidence: `test-results/import-ui-main-tests.log`, `import-ui-integration-tests.log` in the integration checkout. Backend correctness is covered separately in `qa-shelf-import-2026-11-10.md`; partial-file application/consumption remains pending.

Native validation uses the integration build. The main worktree's existing debug startup unconditionally exports bindings relative to the process directory and fails on standalone launch; integration already has an explicit export-only startup path. That independent startup fix remains to be brought onto this branch separately. Import store and backend sources were checked for exact equivalence between both worktrees.

## Native Windows results

Built integration with `cargo build -p gitx --locked --features tauri/custom-protocol` and launched a uniquely named `gitx-import-ui-qa.exe`. SHA256: `F53E497FD4732FD1E188AE1C548F0B24453AFEE7E23CE79F12E55A0111C5B5CA`.

- Opened the existing disposable `unshelve-safety-20261110` repository, whose index and working README contain distinct versions.
- Shelf toolbar displayed Import Patch and opened the native single-file picker with `.patch` / `.diff` filter. Stash/Shelf toolbar operations were disabled while it was open.
- Escape cancelled the picker, restored the buttons, and preserved the exact index/worktree hashes and original two Shelf IDs.
- Reopened and selected `test-results/import-ui-qa.patch`. Exactly one Shelf appeared, selected, with filename-derived message `import-ui-qa` and path `imported-ui.txt`. The patch file was preserved byte-for-byte; the index and working README were unchanged, and `imported-ui.txt` was not created in the worktree.
- Find Action search for `导入补丁` displayed the localized `Git.Shelf.ImportPatch` action.
- Closed the test window and verified the process exited.

Evidence: `test-results/import-ui-before.json`, `import-ui-after.json`; saved Shelf ID `326617cf-365b-4932-8754-be833f7fca20` remains in the disposable repository. No installed executable was replaced, and no WSL validation is claimed.
