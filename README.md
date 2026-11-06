# gitx

Desktop Git GUI aligned with IntelliJ IDEA’s built-in Git UI, built on the dbx stack (Tauri 2 + Vue 3 + Rust).

## Requirements

- Node ≥ 22.13 (see `.nvmrc`)
- pnpm 10
- Rust 1.90 (see `rust-toolchain.toml`)
- System `git` ≥ 2.31
- Platform WebView deps ([Tauri prerequisites](https://tauri.app/start/prerequisites/))

## Develop

```bash
pnpm install
pnpm dev:web          # UI against mockBackend (no Rust window)
pnpm tauri:dev        # full desktop shell
```

Useful checks:

```bash
pnpm typecheck
pnpm test
cargo test -p gitx-git -p gitx-testkit
cargo build -p gitx-helper
```

## Layout

- `apps/desktop` — Vue 3 frontend
- `src-tauri` — Tauri app crate + IPC commands
- `crates/*` — git engine / meta / helper stubs
- `docs/` — product & development plan

## Milestone

**M3 History & Compare** (on top of M0+M1) — Log filters / graph options / indexing, File History, Compare revisions/branches/commits, Diff whitespace modes + CodeMirror, Repository at Revision, blame backend. Host-agnostic only; parallel with M2. See `docs/dev-plan/08-milestones.md`.
