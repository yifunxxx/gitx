# File viewer loading QA — 2026-11-10

## Reproduction and correction

The native Changes interaction check found that F4 created a file tab with its header but no document body. The file viewer watched loading state before Vue replaced the loading placeholder with the editor host. Initialization therefore returned without creating an editor, and no later update retried it. Switching to another loading tab also retained the detached old editor until another successful initialization or unmount.

The viewer now observes both the host element and the displayed tab's identity/content/loading/editability after DOM updates. It releases the previous editor before creating a replacement and clears its reference on disposal. This covers initial asynchronous loads, cached empty documents, failures and switching tabs while loading.

The main branch also updated a raw tab object outside Vue reactivity. Tabs are now created as reactive objects, and repository changes synchronously clear file tabs. Integration already used a reactive array entry and repository reset; those behaviors were preserved when syncing the feature hunks.

## Automated validation

`FileViewer.test.ts` uses the actual component, real CodeMirror editor, Pinia store and deferred backend replies. Before the fix, four of five cases failed in the main worktree and three of five failed in integration. All five now pass, covering first-load publication, visible errors, empty files, release during loading/unmount, repository A → B → A and close/reopen with late replies. The existing change-highlight test also passes.

- Main worktree: 62 test files / 448 tests passed.
- Integration checkout: 87 test files / 615 tests passed.
- TypeScript and production builds passed in both directories.
- Changed-file Oxlint and `git diff --check` passed. Existing bundle warnings remain.

## Native verification

Native custom-protocol build passed. Executable:

`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-file-viewer-20261110.exe`

SHA256: `02D0A44CD1BA7F94DD52F139A31884AAA22E1C20B9B4C36705EEE3F4A5708B8A`

In the disposable `changes-interaction-gui-20261110` repository, F4 on `a.txt` immediately rendered all three lines (`base`, `staged`, `working`) and the final empty line, including the two added-line highlights. F4 on `b.txt` also rendered its document. Switching back through A's file tab retained a visible document; closing A and reopening with F4 loaded its document again. No extra click was needed to make the text appear.

Alt+F4 closed the test app, and a fresh window inventory confirmed its absence. Both file hashes, index entries and status still matched `test-results/changes-interaction-gui-before.json`; the final comparison is saved as `test-results/file-viewer-gui-after.json`. The installed executable was not replaced.

Separate observations: the file viewer's line-number gutter still uses CodeMirror's light default in the dark theme. Injected Ctrl+backquote still did not visibly open the terminal from the Changes row; this does not establish whether the shortcut itself or native key injection is responsible. These remain separate follow-ups, not claimed as fixed by the file loading change.
