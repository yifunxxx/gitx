# Shelf storage safety QA — 2026-11-10

## Reproduced problems

Six regression tests failed against the previous storage implementation: IDs could traverse outside the Shelf directory; deletion replaced an existing deleted backup; restoring corrupt metadata moved it before returning failure; one corrupt entry prevented listing healthy entries; deleted-list enumeration exposed staging directories; concurrent renames raced on the same temporary filename.

Creation also published `meta.json` before writing the patch, allowing readers or an interrupted process to leave a visible but incomplete entry.

## Changes

- Storage operations validate canonical UUID IDs, metadata/directory identity, and plain directories/files. Symlinks and Windows reparse points cannot redirect Shelf access.
- Creation writes and flushes patch and metadata inside a hidden staging directory, then publishes the complete directory with one rename. Failed writes clean their temporary directory; interrupted staging directories remain excluded from lists.
- Shelf storage uses the existing per-repository metadata lock. Renames use unique temporary files and atomic metadata replacement.
- Delete and restore refuse destination collisions, preserving both backups. Restore validates the source before moving it.
- Lists skip incomplete/corrupt entries with a diagnostic warning while leaving their files intact for recovery and returning healthy entries.
- Successful whole-Shelf application moves the complete saved entry to deleted storage. The unused helper that removed metadata paths without rewriting the patch was removed; it did not implement correct partial consumption.

## Validation

All 19 `gitx-meta` tests pass, including nine Shelf tests. Coverage includes path traversal, active/deleted collisions, corrupt/missing/mismatched entries, deletion/restore, 16 concurrent rename workers, interrupted staging, external readers observing 16 published 512 KiB patches, and link redirection. Windows link tests executed successfully (no privilege skip).

Baseline and fixed evidence: `test-results/shelf-storage-baseline.log`, `shelf-storage-tests.log` in the integration checkout. Real Git Shelf creation/application regressions are recorded in `shelf-storage-main-git-tests.log`.

Final checks: main worktree `cargo clippy -p gitx-meta --all-targets --locked -- -D warnings`, `cargo check -p gitx --locked`, focused Rustfmt, and `git diff --check` passed. The integration checkout passed all 20 of its metadata tests and all 35 related Git tests (18 local-changes, 11 creation-safety, six Unshelve-safety). Its unrelated changes were preserved; Git regression output is in `test-results/shelf-storage-integration-git-tests.log`.

## Limits and remaining work

The lock serializes this process's metadata access. It is not a cross-process transaction or protection against a malicious concurrent directory swap. File flushing plus directory rename prevents normal partial publication; this test does not simulate sudden disk/controller power loss or assert durability on every filesystem.

The development plan's partial-file application/consumption behavior still needs patch-aware implementation; this storage change does not claim that behavior. Imported-patch validation and base-object retention are the next checks. No new GUI behavior is introduced here.
