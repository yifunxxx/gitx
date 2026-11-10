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

Small menus/settings remain separate profiling surfaces. The Shelf and long-text follow-ups are recorded below. This change does not claim that every possible repository and view is free of frame spikes.

## Shelf follow-up

Shelf now uses the shared virtual list with known expandable row heights. Prefix offsets are rebuilt on data/expansion changes, and scrolling finds visible rows by binary search. The fixed-height path remains available for existing lists. Selection, context actions, restored entries and Home/End first mount the target row before focusing it; expanded state survives virtualization. Messages and saved times occupy two bounded lines, with the full message in the title.

Local Chrome headless, 1,280 × 800, GPU disabled for this controlled comparison, actual before/after Shelf components, 5,000 shelves with ten paths each and 120 animation-frame scroll steps:

| Measurement | Before | After |
| --- | --- | --- |
| Initial mount + two frames | 1,789.6 ms | 104.9 ms |
| Mounted Shelf rows at end | 5,000 | 13 |
| DOM elements | 50,006 | 140 |
| Scroll p95 frame interval | 33.4 ms | 16.7 ms |
| Frames over 33.4 ms | 7 | 0 |

Both reached Shelf 4999. Before used the 700px outer scrollport; after uses a 440px bounded section with 44px rows, preserving access to the section toolbar. These measurements are not native wheel-latency measurements. Evidence: `test-results/scroll-shelf-benchmark.json`; source archived in `test-results/scroll-benchmark-sources`.

Validation: main full suite 54 files / 408 tests, production build and typecheck passed. Integration feature-hunk sync preserved existing edits; 55 focused tests and typecheck passed. Tests cover 10,000 variable rows, expansion/collapse anchor preservation, 5,000 Shelf entries, offscreen keyboard focus, expansion persistence and correct context-action targets.

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

## Revision text and merge editor follow-up

Revision blob previews and all three merge panes now share a CodeMirror text viewport. This replaces the whole-file `pre`/`textarea` layout and adds line numbers. Scrolling and selection never serialize the document. Left/right merge text is computed separately so typing in the result does not rebuild it. The block list uses fixed 32px virtual rows in its existing 128px section. Empty revision files open as empty documents instead of showing the file-selection prompt.

The editable result emits its complete current text when content changes, including before a subsequent save click. Source line separators are stored in a mapped range set; CRLF, LF, lone CR, blank lines and absent final newlines survive edits and undo/redo. History stores separator information for deleted ranges rather than a full extra source copy on every keystroke. External conflict resolution remains undoable; switching merge files creates independent editors. Unmount destroys editors and disconnects resize observers. Integration-only i18n, exact merge token concatenation and save guards were preserved. Tab, arrows and Home/End mount an offscreen conflict action before focusing it; keyboard navigation can therefore reach the final block too.

Controlled headless Chrome test, development Vite build, GPU disabled, 1,280 × 800 window and 120 animation-frame-driven scroll steps. The text fixture has 50,000 lines; the merge fixture has 5,000 blocks with ten lines on each side. Before/after text scrollport heights and extents match (700px standalone, 515px merge, 1,000,016px content extent):

| Measurement | Before | After |
| --- | --- | --- |
| Standalone text initial mount + two frames | 225.4 ms | 66.2 ms |
| Standalone text scroll p95 | 16.7 ms | 16.8 ms |
| Merge initial mount + two frames | 2,652 ms | 143 ms |
| Merge DOM elements at end | 25,020 | 378 |
| Merge mounted buttons at end | 10,004 | 32 |
| Merge scroll p95 frame interval | 33.4 ms | 16.8 ms |
| Merge slowest frame | 283.4 ms | 16.8 ms |
| Merge frames over 33.4 ms | 10 | 0 |

All variants reached the final text line; both merge versions reached the final block. The new merge view mounted 124 text line elements across its three panes at the sampled positions. A `pre` has few DOM nodes even when it lays out all text, so DOM counts are not a useful standalone-text comparison. Standalone scroll frame timing was essentially unchanged in this run; its improvement is initial rendering and bounded layout. These results do not measure native wheel latency or guarantee identical frame timing on every machine.

Evidence: `test-results/scroll-text-benchmark.json`; harness sources archived in `test-results/scroll-benchmark-sources`, removed from the application tree. New tests cover mixed-EOL edits and grouped undo/redo, source preservation through external replacement, a 50,000-line viewport, save-time read-only behavior, 5,000 merge blocks with correct final-block actions, and cleanup when changing files. Full frontend suites passed: worktree 60 files / 429 tests; integration 85 files / 596 tests. Both production builds/typechecks passed. The final keyboard-navigation adjustment passed focused merge tests and production builds in both checkouts. Changed-file Oxlint passed.
