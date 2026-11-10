# Welcome page overflow

Native QA reproduced a clipped Welcome page with 20 recent repositories. The
fixed-height root centered a panel taller than its available height and had no
scroll container, putting the brand, introductory text and top actions above the
visible area.

The existing integration-checkout layout fix is now included in this branch.
The page scrolls, and automatic margins center short content without moving tall
content above its scroll origin. Grid columns and recent rows can shrink, long
paths have full-path tooltips, and a container query chooses one or two columns
using the editor pane's width rather than the entire application window.

The change is confined to Welcome layout and path tooltips. The component passes
Oxlint, the frontend TypeScript/build checks pass, and the standalone Tauri
custom-protocol build succeeds. No implementation-mirroring DOM class tests
were added for this visual change.

Native verification with the existing 20-entry recent list passed:

- At the normal 1280 × 800 window size, the brand, introduction, recent heading
  and all three action buttons are visible at the top; the list scrolls to its
  last entry without horizontal overflow.
- Dragging the Commit/editor divider to narrow the editor switches Welcome to
  one column. Its title remains reachable at the top; the full recent list and
  Open / Clone / Create buttons remain reachable at the bottom.
- Hovering a truncated recent path displays its full-path tooltip.
- The original pane width was restored after QA and the test app was closed.

Test executable SHA-256:
`c0fa2c4abae67b1dff38dcfcd612f6a15cd05972cf120476c554d3ca1185c95c`.
No installed executable was replaced.

Local build evidence: `E:/IDEAproject/gitx/test-results/welcome-overflow-*`.
