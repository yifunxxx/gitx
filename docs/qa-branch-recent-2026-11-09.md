# Recent branch search and activation — 2026-11-09

The branch popup rendered its unfiltered recent-name list, while click
handlers resolved entries from the filtered local list. Searching therefore
left visible rows that silently did nothing. Deleted recent refs also remained
visible. Recent, remote and tag buttons dispatched checkout twice on a
double-click.

Recent rows now resolve against the filtered local map before rendering,
preserve recent order, discard missing/duplicate entries, and show a translated
section label. All popup ref buttons ignore the second click in a double-click
sequence; keyboard activation with detail 0 remains valid.

Five added regressions failed before the fix and passed afterward. The
independent component suite passed 15 tests. The integrated branch suite passed
21 tests across three files. Both production builds passed; the existing bundle
size warning remains. The earlier full-suite counts belong to the hierarchy
commit, not a rerun of this commit.

Desktop verification used `test-results/repos/branch-hierarchy-qa`. Searching
for `界面` left only `修复/界面/焦点` in Recent and Local. Double-clicking the
Recent entry checked out that exact branch and added exactly one checkout
reflog entry. Reopening the popup cleared the search; the Recent main entry
restored main. After asynchronous checkout settled, HEAD, symbolic HEAD, refs,
index tree, clean status and file hashes all matched the saved fixture baseline.

Normal window close ended all eight sampled processes, checked by PID plus
creation time. Evidence: `test-results/branch-recent-before.log`,
`branch-recent-after.log`, `branch-recent-integrated.log`,
`branch-recent-gui.txt`, `branch-recent-gui-verified.json`, and
`branch-recent-closed-process-tree.json`.

Remote/tag double-click dispatch was covered by component regressions; this
desktop pass used a local recent branch only.
