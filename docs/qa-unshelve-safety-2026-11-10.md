# Unshelve safety QA — 2026-11-10

## Problem and behavior

The previous Unshelve implementation retried failed application and ultimately reconstructed files from the saved base and copied them over the working tree. This could overwrite local edits. A Git conflict could also be treated as success and consume the saved Shelf.

Unshelve now makes one cancellable `git apply --3way` invocation with the saved patch on stdin. Failed or conflicted application returns an error and retains the Shelf. Git conflict state is left available for resolution. Empty patches are rejected. Successful application retains the Shelf by default; removal is an explicit checkbox and occurs only after Git reports success.

The frontend blocks duplicate submissions, refreshes local changes, conflicts, operation state and the Shelf list on completion, and suppresses feedback after repository navigation. A response reporting failed paths is not announced as success.

## Automated checks

- Two real Git regressions reproduced the original overwrite and conflict-as-success bugs before the implementation changed.
- Six Rust integration tests pass: local edit/index preservation; conflict preservation; successful keep/remove and deleted-Shelf recovery; empty/malformed/cancelled patches; untracked-file collision; binary application with unrelated staged changes.
- Main worktree frontend: 40 test files, 309 tests pass.
- Integration worktree frontend: 65 test files, 476 tests pass.
- Both frontend production builds/typechecks pass.
- `cargo clippy -p gitx-git --lib --locked -- -D warnings` passes. The test target also passes Clippy with the existing testkit `derivable_impls` lint allowed.
- `cargo check -p gitx --locked`, changed frontend Oxlint, Rustfmt checks and diff whitespace checks pass.
- Integration desktop embedded build passes with `cargo build -p gitx --locked --features tauri/custom-protocol`.

## Native Windows verification

Tested the newly built integration executable, copied to `gitx-unshelve-qa.exe`; verified its running process path. SHA256: `1996D8B64775E9F4ED8650C2ED923B7DE2D26A4B8E7EBF7FDB64D10A4A663290`.

Fixture: `test-results/repos/unshelve-safety-20261110`, Shelf `053155af-62ee-4323-b696-3f31da23dfbe`. Its saved patch changes README from `base` to `shelved version`; the working file initially contains `local unsaved version`.

1. Opened the fixture and selected the Shelf. “Remove Shelf after successful application” was unchecked by default.
2. Applied it with local edits present. Buttons were disabled while processing, then the UI displayed `README.md: does not match index`. Compared file content, staged content and patch SHA256 with the saved pre-operation evidence: all unchanged, and the Shelf remained listed.
3. Restored only this disposable fixture's README to its exact staged bytes, then retried through the UI. Application succeeded, both working file and index contained the saved version, and the Shelf metadata/patch remained intact. The previous error cleared and local changes refreshed.
4. Closed the QA window normally and verified the QA process exited.

Local evidence: `test-results/unshelve-gui-before.json`, `unshelve-gui-failed.json`, `unshelve-gui-applied.json`, and the `unshelve-{main,integration}-{tests,build}.log` files in the integration checkout.

The integration checkout contains other changes; its Rust Unshelve and frontend store Unshelve functions were compared with this branch for equivalence. The native test covers failure and retry with the default keep option. Actual Shelf removal/recovery and conflicts are covered by real Git integration tests, not a GUI deletion in this pass.

## Remaining scope

Shelf creation, partial staging, literal path selection, metadata path validation and atomic storage are separate follow-up work. This change does not make Git application transactional: a conflict may leave conflict markers/index entries for the user to resolve, while retaining the original Shelf.
