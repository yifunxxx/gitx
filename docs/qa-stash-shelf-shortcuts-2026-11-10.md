# Stash/Shelf keyboard scope QA — 2026-11-10

Stash and Shelf row handlers previously accepted modified Delete/F2 and navigation keys as ordinary row commands. Ctrl+Delete, for example, invoked the selected entry's deletion flow. Holding a context-menu shortcut also reopened the menu repeatedly. Stash consumed navigation/Delete without stopping propagation to application shortcuts.

Rows now ignore composing input and Ctrl/Alt/Meta combinations. Shift is reserved for Shift+F10; other modified row commands remain untouched. Plain Delete/F2 and navigation retain their existing behavior. ContextMenu and Shift+F10 open once, while held navigation can still repeat. Stash stops propagation for commands it handles, without swallowing unrelated global shortcuts such as the terminal toggle.

## Verification

- Added component tests failed in ten cases before the correction. They now cover modifiers, composition, active/deleted Shelf sections, selection/expansion preservation, default prevention, context-menu repeats and propagation.
- Existing tests still cover busy-state guards, plain Delete/F2, both context-menu shortcuts, focus restoration and virtualized navigation through thousands of rows.
- Main frontend suite: **63 files / 481 tests passed**.
- Integration frontend suite: **88 files / 648 tests passed**.
- TypeScript and production builds passed in both checkouts, along with changed-file lint and diff checks. Existing bundle warnings remain. Integration changes were retained using targeted source/test patches.
- Native custom-protocol build passed. Executable: `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-stash-keys-20261110.exe`.
- SHA256: `C4E4B0EAB41AE1344D05FF1E12C644CAD629954B4A3998AF97F73C8C3D8CA2FF`.

In the 10,000-file Shelf fixture, Ctrl+Delete and Ctrl+F2 did nothing, while plain F2 opened the expected rename dialog. Escape cancelled it; Shift+F10 opened the Shelf menu, Escape restored focus, and Right expanded the file list. In the four-entry Stash fixture, Ctrl+Delete left the list intact and Ctrl+Down retained the second entry. Plain Down selected the third entry, and Shift+F10/Escape opened/closed its menu correctly. No delete or rename was confirmed during native QA; plain destructive dispatch is covered by component/store tests.

The QA apps were closed. Before/after snapshots matched exactly for both fixtures: working files, status, index, Stash identities, Shelf metadata and patch contents. Local evidence is saved in `E:/IDEAproject/gitx/test-results/stash-keys-gui-{before,after}.json` and `stash-keys-{main,integration}-{tests,build}.log`.
