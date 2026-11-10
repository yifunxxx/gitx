# Git panel maximize / restore — 2026-11-10

The workspace now retains two stable panes and uses one layout state for the toolbar, tab double-click and divider double-click. Maximizing sets the editor pane to zero and the Git pane to the available height; restoring uses the last user-dragged split. Programmatic resize events do not overwrite that saved height. Hidden editor content is inert and does not remount during maximize/restore. Opening a file diff, comparison, history or revision browser from the Log makes the editor visible again.

The exact screenshot symptom did not reproduce consistently on the earlier integration build. The source audit found separate Splitpanes and application maximize mechanisms, unstable pane add/remove sizing, and missing drag-size persistence. This change consolidates that behavior rather than claiming a reproduced single root cause.

Validation:

- Two component tests use real Splitpanes, exercise repeated maximize/restore with a 44% saved bottom height, content mount counts, inert state, divider double-click and hide/reopen.
- Native build `gitx-scroll-qa-20261110.exe`: toolbar expanded the Git panel to the full workspace and restored it; after dragging the divider, a second cycle restored the dragged height. Double-clicking the Log tab maximized it. Opening `history.txt` from the maximized Log revealed its two-sided diff and restored the split.
- Native divider double-click was inconclusive with injected pointer input; the component event path is covered by the real Splitpanes test. Toolbar and tab interaction were observed directly.
- Main frontend full suite passed (404 tests at that point); integration full run plus corrected test setup/focused reruns covered 571 passing tests. Both production builds passed.
- Native checks used a disposable repository, with no changes to the user's project-teamwork repository.
