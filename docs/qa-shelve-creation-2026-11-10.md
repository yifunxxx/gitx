# Shelf creation safety QA — 2026-11-10

## Reproduced failures

Seven real Git regression tests failed against the previous implementation:

- Shelving a clean file created an empty Shelf and unnecessary keepalive refs.
- Clearing a file with different staged and working versions discarded the intermediate staged content, including when the working file matched HEAD.
- A staged deletion followed by an untracked replacement could overwrite that replacement.
- Cleanup failures such as an existing index lock were silently reported as success.
- Brackets in selected filenames could act as pathspec patterns; metadata listed selected untracked files that the patch did not contain.
- Shelving before the first commit failed because the diff still used HEAD and the fallback empty-tree hash was invalid.
- User diff prefix/color settings could produce a saved patch that Unshelve could not apply.

## Behavior after the fix

Shelf creation uses an explicitly formatted binary patch with literal repository-relative paths. Metadata paths come from the exact captured patch. Empty changes are rejected, and only an unborn symbolic HEAD may use an empty tree computed by Git.

Clearing partially staged files is rejected before publishing a Shelf or altering local data. The user can stage/unstage the file first or request `keepChanges`; that mode saves working-tree changes while leaving both local versions intact. It does not separately encode the staged version in the Shelf.

Cleanup restores only saved paths, including staged additions/deletions and initial files before the first commit. Untracked/ignored replacements are protected. Base-reference failures prevent cleanup. A successfully saved Shelf remains available if cleanup fails, and cleanup errors identify the saved Shelf instead of reporting success.

Before cleanup, the captured working-tree and index patches are checked again. If a hook/editor changed either while the Shelf was being published, cleanup stops and both the saved snapshot and current data remain available.

## Automated coverage

Eleven new real Git tests cover the seven regressions plus keep-local mode, backup-reference failure/cancellation, hook-triggered working-file and index changes, and binary additions/deletions with Unicode filenames. The main worktree also passes the existing six Unshelve tests and seven local-changes tests (24 total).

Evidence: `E:/IDEAproject/gitx/test-results/shelve-creation-main-tests.log`.

The integration checkout passes the same 11 new creation tests and its local-changes suite. Library Clippy passes with warnings denied; the new test target passes with the existing testkit `derivable_impls` lint allowed. Desktop Cargo check, Rustfmt and diff whitespace checks pass. This backend-only change does not require rerunning the unchanged frontend suite.

## Scope and limits

The creation implementation and new tests are synchronized into the integration checkout without replacing its other Shelf changes. These are backend Git tests; this feature does not claim new native GUI coverage. Native Unshelve failure/retry coverage is recorded separately.

The application serializes its own repository writes. Rechecking snapshots catches changes during capture/publication, but it is not an atomic lock against arbitrary external Git/editor writes between the final check and restore. Shelf metadata storage, imported patch validation and frontend creation-dialog navigation are follow-up work.
