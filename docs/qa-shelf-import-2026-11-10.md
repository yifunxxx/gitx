# Shelf patch import QA — 2026-11-10

## Reproduced problems

Seven of the initial eight import tests failed on the previous implementation. It accepted empty/malformed/truncated patches and binary notices without payload, omitted deleted/binary/quoted/renamed files from metadata, accepted paths outside the repository, used an invalid hardcoded empty-tree ID before the first commit, ignored the absence of backup references, and lost imported base objects after history replacement and Git garbage collection.

A separate test proved that retaining only the current HEAD still loses patch preimages that exist locally but are unreachable from HEAD.

The final reference audit reproduced a symbolic backup ref unexpectedly moving a user branch. Shelf ref creation/deletion now uses `--no-deref` so it operates on its own reference rather than following an alias into another branch.

## Changes

- Use Git's patch parser and NUL-delimited statistics in both directions to validate syntax and collect source/destination paths. Deletions, copies, mode-only changes, binary content, Unicode names and literal brackets are covered.
- Reject empty patches, missing binary payloads, traversal/absolute paths and paths addressing `.git`. Both rename/copy sides are validated. Import never applies the patch to validate it.
- Use the existing unborn-HEAD detection and Git-computed empty tree; cancellation and repository/process errors stay errors.
- Preserve the current base plus locally available old blobs identified in Git patch index headers. A synthetic tree retains preimages independently of their original filenames. Base and preimage references are published in one Git ref transaction before the Shelf is exposed.
- Keep those base references across soft deletion so restored imports remain usable after history replacement, reflog expiration and garbage collection. Per-Shelf references follow the existing naming scheme.

## Validation

The new real-Git suite has 12 tests. Besides malformed/unsafe inputs, it covers exact patch-byte preservation, index-byte preservation, distinct staged/worktree content, real copy/rename/binary application, a first-commit-free repository, reference lock failures, cancellation, plain unified patches, missing external base blobs, available dangling preimages surviving `git gc --prune=now`, and symbolic Shelf refs leaving user branches untouched during backup and deletion.

Baseline evidence: `test-results/shelf-import-baseline.log`, `shelf-import-preimage-baseline.log`, and `shelf-import-symref-baseline.log` in the integration checkout. Final related regression output: `shelf-import-main-tests.log`.

Main worktree: all 36 related tests passed (12 import, 11 creation, six Unshelve, seven local-changes), as did `cargo check -p gitx --locked`, focused Rustfmt and `git diff --check`. Clippy passed for the library and import suite with `-D warnings -A clippy::derivable_impls`; the allowance is for the existing manual `FixtureBuilder::default` in `gitx-testkit`, which blocked the initial unqualified warnings-as-errors run. No unrelated source was changed to silence it.

Integration checkout: all 47 related tests passed (12 import, 11 creation, six Unshelve, 18 local-changes). Only verified Shelf source changes and the new import suite were synchronized; unrelated integration work was preserved. Evidence: `test-results/shelf-import-integration-tests.log`. These tests ran with Git 2.34.1.windows.1.

## Scope and remaining work

Import preserves syntax-valid patches even when they cannot apply to the current checkout. It does not claim to reconstruct unavailable external preimages; three-way merging requires those objects, while Git may fall back to a direct apply. Mode-only or copy-only patches without object IDs preserve the current local base; they do not describe a recoverable external base object.

This change retains the existing conservative backup-ref lifetime. Coordinated expiry of permanently deleted Shelf data and its references remains a separate task. Partial-file application/consumption from the development plan also remains pending. No GUI, packaging or WSL validation is claimed for this backend-only change.
