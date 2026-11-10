# Scroll performance audit — 2026-11-10

## Confirmed causes and changes

- Branch popup and Log reference panes mounted every reference. Commit 9cfddf8 introduced flattened virtual rows, retaining search, favorites, folders and context menus.
- File history, revision directories, comparison commit lists, Update Info, Stash, merge branch choices and push/branch comparison previews also mounted their entire result sets. They now use fixed-height virtual rows with full text available in titles. Stash keyboard navigation first scrolls the target into the mounted range before focusing it.
- Log and file history constructed Intl.DateTimeFormat repeatedly during row rendering. A formatter is reused. The integration checkout already had locale-aware cached Log formatters, which were retained.
- FileViewer's decorations callback converted and split the full document and rescanned hunks on editor updates. A StateField now computes decorations on load, reuses them for selection/viewport updates and maps them through text edits.
- Console rendered up to 5,000 wrapped entry elements. It now uses CodeMirror's viewport rendering, preserving wrapping, stream colors and text selection. Output bursts update once per animation frame; append/eviction changes preserve the existing editor.
- Combined Diff mounted one full CodeMirror editor per changed file. Editors now mount only within a 240px viewport margin and release when outside it. A compact position/selection snapshot is restored on return and invalidated when content changes. A 60ms dwell with a bounded text preview avoids constructing every editor passed during fast scrollbar dragging.

## Shared-path audit

The existing VirtualList already coalesces passive scroll events with requestAnimationFrame, keeps a stable phantom height, preserves anchors on ref refresh, skips clamp changes during thumb dragging and disconnects observers/listeners. No global wheel handler, smooth-scroll override, disabled GPU flag or confirmed repository-refresh storm was found. No blanket GPU/CSS workaround was added.

Small menus/settings and variable-content Shelf cards, merge editor and blob text previews remain separate profiling surfaces. This change does not claim that every possible repository and view is free of frame spikes.

## Regression coverage

- Main full frontend suite: 54 files / 404 tests passed before the final dwell addition; the final four ViewportDiff tests also passed (405 tests in the resulting suite).
- Integration: 570 tests passed in the full run; one new auxiliary-list test needed the integration view's i18n mock. After that correction and the dwell addition, focused reruns passed, covering all 572 resulting tests. Push/Update Info/Rewrite dialog regression run: 26 passed.
- 10,000-entry tests reach and interact with the final history/directory/comparison/update rows while bounding mounted rows. A 5,000-stash test verifies End/Home navigation and offscreen focus.
- Console tests use a real EditorView with 5,000 entries, checking bounded rendered lines, multiline stderr decoration, selection mapping through eviction, burst coalescing and clear without recreation.
- Diff tests cover viewport mount/release, restored snapshots, content invalidation, absent IntersectionObserver, fast-pass cancellation and unmount cleanup.
- Both frontend production builds/typechecks passed; changed-file Oxlint passed. Full Oxlint reported only existing warnings outside this change. Production builds retain the existing large-chunk warning.

## Browser measurements

Local headless Chrome, development Vite build, 1,280 × 800 window, 120 requestAnimationFrame-driven scroll steps. History uses the actual component from 47c0952 for the baseline; the console baseline reproduces its former wrapped-entry renderer. These are controlled browser measurements, not native wheel latency or a guaranteed FPS.

| Fixture | Initial render before / after | Elements before / after | Scroll p95 before / after |
| --- | --- | --- | --- |
| 10,000 history commits | 2,918 / 40 ms | 30,013 / 108 | 14.0 / 7.1 ms |
| 5,000 wrapped console entries | 231 / 45 ms | 5,001 / 49 | 7.1 / 7.0 ms |
| 120 combined files, 200 added lines each | 4,513 / 103 ms | 18,625 / 1,151 | 13.9 / 7.2 ms |

Combined Diff retains 5 editors instead of 120 at the sampled settled viewport, with the same 26,100px scroll extent. The first immediate-mount implementation worsened scrolling p95 to 20.9ms; the dwell/preview change reduced it to 7.2ms. One 41.6ms frame remained in that fast traversal. Initial-render measurements include two animation frames; final combined editor readiness was allowed another 150ms before/after traversal. Individual values vary with system load.

Local evidence: `test-results/scroll-browser-benchmark.json`, `scroll-combined-benchmark.json`, `scroll-combined-final-benchmark.json`; harness source is preserved in `test-results/scroll-benchmark-sources` and removed from the product tree.

## Native QA

Final combined build: `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-scroll-final-20261110.exe`, SHA256 `14a3083ad3d657ec9c44e8d8e8d08dda333e4d7370f0cbc90d5c81bb5f5844c0`.

Update Project and panel maximize/restore were checked in the earlier combined build; see their separate QA documents. The final build includes the additional fast-pass Diff behavior. Native interaction checks use disposable fixtures, never the user's project-teamwork repository.

Final native build: the 6,001-reference fixture rendered the branch pane correctly; wheel scrolling advanced rows and dragging the thumb to the end showed v/1999 with no blank viewport. Console opened with readable wrapped command/output text. These are interaction observations, not a native frame-rate measurement.
