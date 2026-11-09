# Standalone debug startup and explicit binding export

## Problem and change

Debug startup used to export IPC bindings unconditionally to a path relative to
the process working directory. A standalone launch could exit before creating a
window. The dependency's direct exporter also truncates the destination before
rendering its types, which risks losing an existing file on generation failure.

Startup now exports only when `GITX_EXPORT_BINDINGS` explicitly names a file.
The generator renders into memory, writes a unique sibling temporary file and
replaces the destination only after writing completes. Export exits before GUI
initialization. Windows replacement contention has bounded retries (360 ms of
total delay); permanent errors retain the original file and clean the temporary
file. Normal startup never calls the exporter.

The explicit generator uses the existing numeric IPC representation and exports
its two generated helpers so its output passes `noUnusedLocals`. The checked-in
bindings were not regenerated. The bindings-check script is still a presence
check, not a signature parity check; README and diagnostics now state this.

## Validation

- Seven Rust integration tests pass: ordinary startup, empty destination,
  generator failure, UTF-8 replacement, directory collision, eight concurrent
  exporters, and a permanently locked Windows destination.
- The same seven tests pass in the integration checkout after applying only
  this feature's changes, preserving its independent work.
- Clippy passes with two pre-existing lint categories allowed:
  `derivable_impls` in the fixture builder and `unnecessary_lazy_evaluations` in
  `src-tauri/src/commands/sync.rs`. Strict Clippy is not claimed as clean.
- `cargo build -p gitx --locked --features tauri/custom-protocol` succeeds.
- The real executable exports from an unrelated temporary working directory,
  exits with code 0, and produces 73,865 bytes. Eight simultaneous exporter
  processes all exit with code 0 and produce the identical complete output.
- Empty destination, missing parent, and a directory collision all exit with
  code 1; the directory's sentinel file survives and no export temporaries remain.
- Generated output passes standalone strict TypeScript checking, including
  `noUnusedLocals` and `noUnusedParameters`.
- Native Windows GUI: `gitx-startup-qa.exe` opens independently, loads the
  `stash-safety-20261110` fixture and displays its changes and commit graph.
- Checked-in bindings remain unchanged after export and native startup:
  SHA-256 `31c1689bdc3fb664ab7e75673f9ad942dcce041d9f7f202379d0b4155f4f761b`.

Executable SHA-256:
`b895e0d92070af4d76331709c9adfc7738d15d640d02cdffadd6f51a9ec39143`.
Local evidence is under `E:/IDEAproject/gitx/test-results/startup-bindings-*`.
No installed executable was replaced.

## Remaining observations

The Welcome page clips its upper content when the recent repository list grows
long. This was observed during native QA and remains a separate layout issue.
