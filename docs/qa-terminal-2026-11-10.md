# Integrated terminal — 2026-11-10

## Behavior

- A Terminal tab sits beside Console in the bottom Git panel. Ctrl+` toggles it; panel maximize/restore also applies.
- New sessions start in the current repository or open folder. Existing sessions keep their own working directory when the selected repository changes.
- Windows supports PowerShell and Command Prompt profiles. Other platforms use the user's login shell. Multiple sessions remain alive when switching tabs or hiding the bottom panel.
- xterm.js renders ANSI colors, Unicode, selection and a bounded 5,000-line scrollback. Copy, paste, select all and clear are available through the toolbar/context menu. Ctrl+Shift+C/V are handled explicitly; Ctrl+C copies a selection or reaches the shell when nothing is selected.
- The terminal loads on first use. Browser mode explains that native desktop execution is required.

## Resource and performance controls

`portable-pty` owns a real PTY for each window-scoped session. Blocking I/O runs off the WebView thread. The backend output queue is limited to 128 KiB; each read drains at most 64 KiB. The frontend requests more output only after xterm's write callback completes, and serializes bounded input writes. Resize updates are coalesced. At most 16 sessions can be open.

Closing a tab or the window releases PTY handles and stops its shell. Closing during startup, while waiting for output, or with a full output queue is covered. ConPTY output is drained separately from process exit so final screen updates and exit codes arrive before EOF. Frontend disposal disconnects observers, event subscriptions and scheduled animation frames.

## Validation

- Worktree full frontend suite: 56 files / 417 tests passed before the final context-menu/parser additions. Final terminal component/transport tests: 10 passed; the additional real-xterm parser test passed separately.
- Integration checkout full frontend suite: 81 files / 584 tests passed before those additions. Final terminal/layout/locale subset: 13 passed; real-xterm parser test passed separately.
- Final frontend production builds and TypeScript checks passed in both checkouts. Existing large-chunk warnings remain. The lazy terminal chunk is approximately 342 KiB raw / 88 KiB gzip.
- Five Rust terminal tests passed in both checkouts: output order/backpressure, waking blocked producers, validation/shutdown, real shell cwd/output/resize/exit code/ownership, and closing a live shell with a pending reader. The cwd fixture includes spaces and Chinese characters.
- Changed-file frontend lint passed. Strict Rust Clippy was blocked by an existing `unnecessary_lazy_evaluations` warning in `src-tauri/src/commands/sync.rs:197`; no terminal-specific diagnostic was emitted.
- Native custom-protocol build of the integration checkout passed with the final frontend assets.

The actual-xterm parser regression verifies split UTF-8 Chinese/emoji, ANSI parsing, cursor-position replies required by ConPTY startup, and bounded history after 5,000 output lines. Transport/component tests cover late startup disposal, read failure cleanup, serialized input, resize coalescing, retained sessions, clipboard controls and context-menu focus.

## Native observations and limits

The first native QA build displayed the Terminal tab beside Console, opened two real PowerShell sessions in the disposable branch QA repository, and expanded correctly when the panel was maximized. Closing its window removed app PID 33616 and shell PIDs 28152/26472. That run exposed a missing reactive session-status update; it was fixed and protected with a regression test before the final builds.

After the user unlocked Windows, the final executable opened two PowerShell sessions in the disposable repository. The ready controls updated without another interaction, the right-click menu displayed correctly, Escape dismissed it, hiding/reopening the Git panel retained the original session, and maximize filled the available area. Closing the final app removed PID 12452 and shell PIDs 15416/13348; their PTY console hosts 27632/32536 also disappeared.

The injected Ctrl+backquote chord did not visibly toggle the native panel in this QA run. Shortcut detection/propagation passes component tests, but native keyboard verification remains incomplete; the visible Git stripe successfully hides/reopens the panel. Shell commands were exercised through the Rust PTY tests, not through GUI automation. Native Ctrl+C/paste behavior and terminal wheel frame timing are not claimed as manually verified.

Final integration QA executable:

`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-terminal-final-20261110.exe`

SHA-256: `9BFCA597C63DFCB9DA9ECF037E19A43C4B2DCACFFA4CD057DD69849F72D8F56B`

The installed `D:/gitx/gitx.exe` was not replaced. Integration checkout changes unrelated to this feature were preserved.
