# Branch scrolling — 2026-11-10

Both the title-bar popup and Git Log branch pane used to mount every reference. They now share a flattened section model and the existing fixed-height VirtualList. Only visible rows plus overscan are mounted; directory labels, favorites, recent entries, remote branches and tags share one stable scroll range. Search changes return to the start; background ref refresh preserves the visible anchor.

## Validation

- Main frontend suite: 48 files / 390 tests passed. Production build, typecheck and changed-file Oxlint passed.
- A 6,000-reference component test for each list bounds mounted reference buttons below 40 at a 400px viewport, scrolls to remote entries and the final tag, checks selection/checkout and context menus, then shrinks the search results without a blank viewport.
- Existing nested names, Chinese search, favorites, double-click and checkout-failure tests passed.
- Integration suite: 555 tests initially passed; two older shallow tests required rendering the actual VirtualList. After adapting those tests, all 19 branch tests passed (557 integration tests total across the full run and focused rerun).
- Native executable: E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-branch-virtual-qa.exe, SHA256 599f1f19abf531bf759c35345ae53d3cecbe54c4fcdfb0422482bf39f7c9c00b.
- Native fixture: test-results/repos/branch-virtual-gui-20261110, 2,001 local branches, 2,000 remote refs and 2,000 tags. Wheel scrolling and dragging both scrollbars from the first branches to v/1999 rendered correctly without blank regions or thumb stalls. Searching 1999 showed the matching local/remote/tag entries. A subsequent small change explicitly resets search to the first result and passed focused tests/typecheck.
- This validates bounded rendering and interaction, not a measured frame-rate claim. Broader scroll profiling remains a follow-up requested by the user.
