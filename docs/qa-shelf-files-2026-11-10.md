# Shelf file lists and saved times — 2026-11-10

Shelf rows now show their saved time and expose an expandable file list before applying or restoring a patch. Both active and recently deleted entries support this view. The recently deleted toggle also displays its active state.

File lists use the existing virtual list with a bounded height of eight rows. Paths remain selectable text, with complete paths in tooltips. Expanding selects the Shelf without applying changes; double-click behavior remains selection only. Left/Right expand or collapse, Tab enters the list, Home/End reach its ends, arrows and Page Up/Down scroll, and Escape/Left return focus to the Shelf row. Navigation and removed entries clear expansion state; refreshed paths update after partial application.

## Automated verification

- Main: 44 frontend test files, **355 tests passed**; typecheck, production build and changed-file Oxlint passed.
- Integration: 69 frontend test files, **522 tests passed**; production build (including typecheck) and changed-file Oxlint passed. Independent integration changes were preserved.
- Eight added cases cover active/deleted expansion, mouse and keyboard behavior, refreshed paths, navigation/removal, invalid dates, a 10,000-path list, shrinking a scrolled list and returning focus.
- The 10,000-path regression mounts fewer than 30 file rows, reaches both ends with Home/End, and verifies accessible position/size metadata.
- Standalone native build passed: `cargo build -p gitx --locked --features tauri/custom-protocol` with the isolated target directory. Existing bundle-size/mixed-import warnings remain.

## Native verification and scope

Executable: `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-shelf-files-qa.exe`.

SHA256: `3ba90dd6c73156aa427c6ffc523b73fd0701718349d00249d5bf8b371e89db1c`.

Fixture: `E:/IDEAproject/gitx/test-results/repos/shelf-files-gui-20261110`, containing a valid 10,000-file Git patch and an unrelated modified working file. Git parsed all 10,000 paths before the UI test.

Observed the saved time and count, expanded the file list with its disclosure button, and used Tab to enter it. The bounded list rendered the first paths and scrolled into view in the compact bottom pane. The QA window was subsequently unavailable; native Home/End and the long-path tooltip were not verified in this pass. Home/End behavior and path attributes are covered by automated tests.

Before/after evidence in the integration checkout: `test-results/shelf-files-gui-before.json` and `test-results/shelf-files-gui-after.json`. Worktree file hash, staged entries, Shelf metadata and patch hashes were identical after browsing.

Patch diff viewing, export and target-changelist controls remain separate follow-ups. This change adds file browsing, not per-file application.
