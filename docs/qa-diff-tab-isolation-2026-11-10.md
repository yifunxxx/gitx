# Diff tab isolation — 2026-11-10

Background diff results no longer rebuild the active DiffViewer or its editor panes. Each tab receives a content version only when its visible result changes. Identical normal and soft refreshes retain the existing result and editor; changed content of the same length still repaints immediately. Structural comparison replaces the serialized content key, avoiding a retained duplicate of the entire diff text.

Historical comparison cache IDs now encode the full tuple of revisions, destination path and original rename path. Different rename sources and colon-containing tuple components cannot alias another comparison. An unchanged original path is normalized to the omitted-path case.

## Verification

- New regression tests against the previous implementation: **6 failed / 6 passed**, reproducing the remount and cache issues.
- Main worktree: **46 frontend files / 377 tests passed**; production build and typecheck passed.
- Integration checkout: **71 frontend files / 544 tests passed**; production build and typecheck passed. Only this feature's changes were synchronized.
- Component tests exercise the real EditorTabs and DiffViewer with a selectable textarea replacing CodeMirror. They verify DOM identity, selection, focus, scroll position, unchanged refreshes, equal-length changes, retry after failure and cached switching.
- Changed-file Oxlint and `git diff --check` passed. Existing production bundle-size warnings remain.
- Native build passed with `cargo build -p gitx --locked --features tauri/custom-protocol`.

Logs are under the integration checkout's `test-results/diff-isolation-*.log`.

Native QA executable: `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-diff-isolation-qa.exe`.

SHA256: `1b582341dc10ea555ac867194ed50e401a98fd38e181b4058b7e6dcc0bce8f2d`.

## Native interactive verification

Opened the two-file `diff-isolation-gui-20261110` fixture through the native folder dialog. Double-clicked B, then A, scrolled A to show lines 16–39 and selected text across lines 25–27. Replaced all 200 `modified` strings in B with the equal-length `REFRESH!` marker. A retained exactly the same selected text and visible line positions; activating B showed the refreshed marker. Replacing A's text with equal-length `LIVEEDIT` markers updated the active view without a tab switch. Staged entries remained identical to the baseline. Evidence: `test-results/diff-isolation-gui-before.json` and `test-results/diff-isolation-gui-after.json`.

Switching away and back still reset the reading position in this build; that finding led to the subsequent per-tab position restoration work. The QA process was closed. Shelf diff preview remains pending; this change fixes the shared diff infrastructure only.
