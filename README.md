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

**M1 First Vertical Slice** — Welcome → Open/Init → Changes (staging) → Diff → Stage → Commit (hooks/amend) → basic Log. See `docs/dev-plan/08-milestones.md`.
