# Partial Shelf application and safe consumption

## Behavior

Unshelve now applies independent Git patch sections even when another file
cannot apply. A successful file is reported separately from failed/conflicted
paths. When removal is requested, only complete successful sections disappear
from the active patch and its file list. A later retry applies the remainder.
Without removal, the original patch remains byte-for-byte unchanged.

Git parses the forward and reverse path records. Rename swaps, copies sharing
their source, and file/directory transitions are grouped so dependent sections
cannot be consumed separately. Binary payloads and quoted Unicode paths retain
their original bytes. Clean Shelves use a direct index/worktree precheck and one
write, including the 128-file regression fixture. A failed direct check uses
three-way application of the independent groups. Three-way `--check` is not
used as proof of a clean merge: a real conflict test showed it can return 0 when
the subsequent application conflicts.

The UI reports both applied and failed counts, then refreshes Shelf, changes,
conflicts and operation state. Cancellation, timeouts and non-application
failures retain the complete backup. An error while publishing the remainder
explicitly reports that files applied but the saved Shelf was preserved.

## Storage

Existing `meta.json` + `changes.patch` entries remain readable. Partial
consumption writes a new immutable `changes-<uuid>.patch`, flushes it, then
atomically updates metadata including an internal `patchFile` pointer. File
paths and patch bytes switch together. Metadata and patch reads use one locked
snapshot; consumption rejects an obsolete patch snapshot.

Original and older patch generations remain available for recovery and readers
that already loaded earlier metadata. Rename preserves the pointer. Delete and
restore move the entire entry, including its active remainder and backups.
Invalid generation paths, missing files and storage links remain rejected.

## Validation

- `gitx-meta`: 24 tests pass, including five new consumption/storage tests.
- Real Git Shelf suites: 40 tests pass, including eleven new partial-application
  tests covering local edits, conflicts, retry, retention, rename swaps,
  failed renames, copies, file/directory transitions, mode-only changes, binary
  data, quoted Unicode paths, index locks, metadata write failure and 128 files.
- Relevant Git and metadata Clippy checks pass, allowing the existing
  `derivable_impls` warning in the fixture builder.
- Main frontend: 41 test files / 324 tests pass; build and changed-file Oxlint
  pass. Integration frontend: 66 test files / 491 tests, build and changed-file
  Oxlint pass. Integration backend: 25 metadata tests and the same 40 real Git
  Shelf tests pass after synchronizing only this feature's changes.
- Native Windows mouse interaction on `shelf-partial-gui-20261110`: selected
  `QA partial apply` and applied it with removal disabled. The pane correctly
  reports one applied file and one failed file. Disk checks confirm that
  `good.txt` is applied and staged, `conflict.txt` retains its local content and
  original index content, and the complete Shelf patch and file list survive.
  Removal-enabled consumption is covered by the real Git regression tests.
- Native executable SHA-256:
  `6cbf908cbccfb562231bf1e8e8fdf6e73d2bddafbbf87aa572eb468fbe4e9538`.
  The removal checkbox wording was subsequently clarified to refer to applied
  files rather than the entire Shelf; both frontend builds were rerun.

## Scope and remaining work

Plain unified, mail-prefixed and mixed patches whose section boundaries cannot
be matched safely to Git's records are applied as one group. Failure keeps the
entire patch; independent consumption is supported for standard Git diffs.
Related rename/copy groups also remain intact if any part fails.

Older gitx versions do not understand `patchFile`; after consuming part of a
Shelf, use this version or newer to avoid reapplying its original backup.
Immutable older generations occupy storage until the Shelf itself is purged.
Cross-process metadata writer serialization is not introduced by this change.

Recently Deleted/Restore UI and the Welcome page's long-list layout remain
separate follow-ups. Local evidence is under
`E:/IDEAproject/gitx/test-results/shelf-partial-*` and
`shelf-consumption-meta.log`.
