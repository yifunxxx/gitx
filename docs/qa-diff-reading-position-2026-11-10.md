# Diff reading position — 2026-11-10

Switching from one Diff tab to another, or temporarily returning to the workspace, previously recreated the editor at the top of the file and lost the text selection. Each open tab now stores a compact snapshot for its visible panes and restores the scroll anchor and selection when the same content is reopened.

Snapshots contain a CodeMirror scroll effect, selection offsets, document length and selection ownership. They do not retain EditorView, EditorState, DOM nodes or a second copy of the file. Outgoing editors still disconnect their scroll, resize and selection listeners and are destroyed. Closing a tab, navigating to another repository, receiving changed content or changing display layout clears the corresponding snapshots. An outgoing pane cannot repopulate a snapshot after its content version has become stale.

Selection ownership follows the last selected diff pane. A file-list double-click can select the file name before unmounting the old pane; that incidental native selection no longer erases the previous diff selection. Restoring the native selection leaves keyboard focus on the control used to navigate. Native selection rendering is restored when both endpoints are in the rendered viewport; an off-screen selection retains its CodeMirror offsets without moving the reading viewport to it.

## Automated verification

- Main worktree: **48 files / 388 frontend tests passed**; production build and typecheck passed.
- Integration checkout: **73 files / 555 frontend tests passed**; production build and typecheck passed. Only feature hunks were synchronized, retaining independent integration changes.
- Store tests cover independent panes, unchanged refresh, background completion, changed content, close/reopen, repository round trips and layout invalidation.
- Component wiring checks cover passing the outgoing snapshot back into the correct pane after tab reactivation.
- Actual CodeMirror component tests cover snapshot capture and selection restoration in a fresh editor, destruction, cancellation of a queued mount, selection ownership between panes and navigation that selects a file name.
- Changed-file Oxlint and `git diff --check` passed. Existing bundle-size warnings remain.

Logs are under the integration checkout's `test-results/diff-view-state-*.log`.

## Native verification

The preceding isolation QA build reproduced the lost reading position. The first restoration build retained the viewport at lines 104–128 and the selection across lines 110–112 when switching through tab buttons. Its file-list double-click limitation was fixed before final validation.

Final executable: `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-diff-view-state-final-qa.exe`.

SHA256: `f126cfbdeb7431f7275fb4ada2a8872dd01283d0652f3ff8f741cdc919f26c11`.

The final native build passed with `cargo build -p gitx --locked --features tauri/custom-protocol`. In the two-file fixture:

- Scrolled A's side-by-side view to lines 104–127 and selected right-side lines 110–112. Double-clicked B in the file list and returned through A's tab. The viewport and selected text were restored exactly.
- Selected left-side lines 114–116, opened the workspace tab and returned to A. The left selection was restored; the previous right selection did not overwrite it.
- Switched A to unified mode, scrolled to the added lines 80–104 and selected lines 85–87. Switching to B and back restored both that viewport and the exact selected text.
- Closed A and reopened it. It started at line 1 in the default side-by-side mode, without resurrecting the closed tab's selection or scroll position.

The two working-file hashes and staged entries were unchanged during this round of QA. Evidence: `test-results/diff-view-state-gui-before.json` and `test-results/diff-view-state-gui-after.json`. The standalone QA process was closed after validation.

Follow-up finding: with focus in the Changes tree, Alt+F4 opened a source viewer instead of closing the window. `ChangesTree.vue` handles `F4` without checking modifiers. The title-bar Close button exited normally. Shortcut modifier handling remains a separate fix.
