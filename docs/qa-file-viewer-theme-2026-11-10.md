# File viewer theme QA — 2026-11-10

The F4 file viewer inherited CodeMirror's white gutter in dark mode. Its editor, line-number gutter, border, cursor, selection and monospace font now use the app's theme variables, so an already-open file updates when the app theme changes.

In the native custom-protocol QA executable, opening `a.txt` with F4 showed the dark gutter alongside the complete file and its added-line highlights. Switching dark → light → dark updated the existing editor correctly without reopening the tab. Computed gutter/editor backgrounds were both `rgb(19, 20, 22)` in dark mode and `rgb(255, 255, 255)` in light mode; line-number foregrounds were `rgb(185, 187, 193)` and `rgb(85, 85, 85)` respectively. The final dark theme was restored before exiting.

The existing file-viewer and terminal suites passed in both checkouts (six files / 37 tests), both TypeScript/production builds passed, and the native build and changed-file lint passed. No CSS-implementation assertion tests were added for this visual change. The fixture's status, index and file hashes were unchanged.

Test executable: `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-key-theme-20261110.exe`.

SHA256: `14164AAEA995AF3F4841D9F92304AEE0DD7F1F95E0AF648E8C8B7214A84B85D8`.

Local evidence: `E:/IDEAproject/gitx/test-results/file-theme-{dark,light,dark-restored}.json` and `key-theme-fixture-after.json`. This closes the gutter follow-up in `qa-file-viewer-loading-2026-11-10.md`; the separate terminal shortcut correction is documented in `qa-terminal-shortcut-2026-11-10.md`.
