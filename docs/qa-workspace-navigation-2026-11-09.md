# Workspace navigation ordering — 2026-11-09

Opening folder A and then B could finish in reverse order, returning the UI to
A. The same problem affected initialization, enabling VCS, root discovery and
the recent-folder list. Enabling VCS also read the current folder again after
the request, combining the old result with a new folder path.

Workspace operations now carry request generations. Only the latest applicable
response updates the visible workspace. Root discovery checks both its request
generation and the folder navigation identity, so A → B → A cannot revive a
response from the first visit. Initialization and VCS enablement capture their
original target. Changing the active root clears old branch information and
advances the exposed navigation token; selecting the same root does not.

Eight deterministic tests use deferred backend promises to force reverse
completion. Six reproduce stale data in the old implementation; two cover the
new navigation-token contract. All eight failed before extraction of the
integrated fix and pass afterward. These tests cover asynchronous ordering
without requiring timing-dependent desktop clicks.

The implementation was extracted from the integrated workspace without
including its unrelated edits. The new test file is also present there.
The independent full frontend suite passed 22 files / 162 tests; the integrated
full suite passed 54 files / 366 tests. Both production builds passed, including
TypeScript checks. The existing bundle-size warning remains.

Evidence: `test-results/workspace-navigation-before.log`,
`workspace-navigation-after.log`, `workspace-navigation-full-isolated.log`,
`workspace-navigation-full-integrated.log` and corresponding build logs.

This changes frontend result publication. It does not cancel filesystem work
already started by a backend initialization request, nor claim new WSL desktop
coverage. The remaining branch checkout/recovery feature additionally depends
on the richer multi-root backend result and will be extracted separately.
