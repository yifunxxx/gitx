# Branch hierarchy and interaction QA — 2026-11-09

## Scope

The branch pane and branch popup were checked against the fixture
`E:/IDEAproject/gitx/test-results/repos/branch-hierarchy-qa`.
The fixture contains `main`, `feature/api/button`, `feature/ui/button`, and
`修复/界面/焦点`, with each nested branch pointing to a distinct commit.

## Implementation covered

- `buildRefTree` now has an iterative `flattenRefTree` pass, so every folder
  depth is rendered and no leaf branch is dropped.
- The pane and popup render folder rows and branch rows separately, indent
  nested levels, and expose the complete branch name in `title` and
  accessibility labels.
- Favorite and branch controls are sibling buttons. A favorite click cannot
  bubble into selection or checkout, and the second click of a double-click
  sequence is ignored.
- Pane single-click filters the log; pane double-click checks out; popup
  branch activation checks out once. Context menus remain independent.

## Automated validation

- Independent workspace: 21 test files, 149 tests passed; production build
  passed.
- Integrated workspace: 53 test files, 353 tests passed; production build
  passed.
- `buildRefTree` covers deep ordering, depth, duplicate leaf labels, and a
  2,000-branch no-loss/no-duplicate case.
- `BranchHierarchy.test.ts` covers pane and popup rendering, favorite
  double-click isolation, exact checkout, context menus, grouping, and search.

## Desktop validation

The debug desktop build was tested on November 9, 2026.

- All three nested levels and the Chinese branch were visible in both the pane
  and popup. Duplicate leaf labels remained distinguishable by full
  accessibility names.
- Clicking `feature/ui/button` filtered the log to that branch while HEAD
  remained `main`.
- Double-clicking the `feature/api/button` favorite toggled only its favorite
  state; HEAD stayed `main` and the log filter stayed unchanged.
- Right-clicking `feature/api/button` opened a menu naming that exact branch;
  Escape closed the menu and restored focus to the app surface.
- Tab + Enter on the popup's `feature/api/button` branch button checked out
  that exact branch once.
- Double-clicking `修复/界面/焦点` checked out the exact UTF-8 branch.
- The UI then checked out `main` again. HEAD, symbolic HEAD, all refs, index
  tree, clean status, and the `baseline.txt` SHA-256 matched the saved
  baseline. Favorite metadata was empty after the test.
- The sampled process tree contained 8 processes before closing. After a
  normal close, every PID and creation time was gone; no process remained.

Evidence is kept in `test-results/branch-hierarchy-gui.txt`,
`test-results/branch-hierarchy-gui-verified.json`, and
`test-results/branch-hierarchy-closed-process-tree.json`.

## Limits

The desktop tool cannot hold Ctrl while clicking, so that physical gesture
was not claimed as manually verified. WSL path round-trips and long-duration
resource trends remain separate follow-up work.
