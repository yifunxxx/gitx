# Terminal shortcut compatibility QA — 2026-11-10

## Reproduction and correction

Native `Control_L+grave` input on a Changes row reached the QA WebView's capture and bubble handlers with `key: "\u0060"`, `code: ""`, `ctrlKey: true`, and no composition, repeat or other modifier. The existing helper only accepted `code: "Backquote"`, so it ignored the event. This establishes a failure for the tested native injection path; it does not prove that an ordinary physical keyboard has the same behavior.

The helper still prioritizes the physical Backquote key. Only when `code` is empty does it accept the backquote character. A different nonempty code cannot be overridden by its character. Shift, Alt, composition and repeated input remain excluded. App and xterm use this same helper.

## Validation

- The new shortcut cases and actual TerminalView propagation test produced three failures before the correction and pass afterward.
- Nineteen helper cases cover physical keys, non-US physical-key output, Ctrl/Meta fallback, other keys, modifiers, composition and repeat. TerminalView tests cover both event representations, including xterm handling and bubbling to the app.
- Targeted terminal/file regression suites: six files / 37 tests passed in both the main and integration checkouts. TypeScript and production builds passed in both; changed-file lint and diff checks passed.
- Native custom-protocol build passed. Test executable: `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-key-theme-20261110.exe`.
- SHA256: `14164AAEA995AF3F4841D9F92304AEE0DD7F1F95E0AF648E8C8B7214A84B85D8`.

The same native chord now opens the terminal from Changes, hides it while xterm's input textarea is focused, then reopens the retained PowerShell session. Event records show the same empty code and the app's default prevention after the correction. The prompt remained intact; no shell command was typed. The shortcut did not toggle the background panel while the settings dialog's search input was focused.

Temporary bounded event listeners were removed, the QA app was closed, and its PowerShell/conhost processes exited. Fixture file hashes, index and status remained unchanged. The installed executable was not replaced.

Local evidence is in `E:/IDEAproject/gitx/test-results/terminal-key-diagnostic-{before,open,hide,reopen,dialog}.json`, `key-theme-processes-{before,after}.json`, and `key-theme-fixture-after.json`. This closes the shortcut follow-up in the earlier terminal and file-loading QA reports.
