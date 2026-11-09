# gitx

Focused desktop Git GUI built on the dbx stack (Tauri 2 + Vue 3 + Rust). Default UI language is **简体中文 (zh-CN)**; English is available in Settings → Appearance. Light / dark / system themes are supported and persisted.

## Requirements

- Node ≥ 22.13 (see `.nvmrc`)
- pnpm 10
- Rust 1.90 (see `rust-toolchain.toml`)
- System `git` ≥ 2.31
- Platform WebView deps ([Tauri prerequisites](https://tauri.app/start/prerequisites/))

### Windows 11 extras

- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on most Win11 machines)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** / MSVC workload
- Git for Windows

## Develop

```bash
pnpm install
pnpm dev:web          # UI against mockBackend (no Rust window)
pnpm tauri:dev        # full desktop shell
```

Desktop development and packaging automatically build and stage the matching
`gitx-helper` sidecar. To launch `target/debug/gitx.exe` directly after a source
change, build **both** binaries with `cargo build -p gitx -p gitx-helper`.

Useful checks:

```bash
pnpm typecheck
pnpm test
cargo test -p gitx-git -p gitx-testkit
cargo build -p gitx-helper
```

Starting the debug app does not rewrite frontend bindings. To explicitly export
the current IPC types to a review file in PowerShell:

```powershell
cargo build -p gitx
$env:GITX_EXPORT_BINDINGS = "$PWD/test-results/bindings.generated.ts"
./target/debug/gitx.exe
Remove-Item Env:GITX_EXPORT_BINDINGS
```

The export process exits without opening a window. Review the generated types
before replacing the checked-in frontend adapter.

### Theme & language

- Toolbar sun/moon toggles light ↔ dark (persisted in app settings).
- **Settings** (`Mod+,`) → **外观 / Appearance**: theme (system/light/dark), language (zh-CN / en), corner style, palette.
- **Keymap** page: search actions, rebind shortcuts, reset overrides.

## Windows 11 — local run & build

In PowerShell or Git Bash (after installing the prerequisites above):

```powershell
# Enable corepack or install pnpm 10, then:
pnpm install
pnpm tauri:dev        # run the desktop app
pnpm tauri:build      # produce NSIS .exe + MSI under target/release/bundle/
```

Installers land at (Cargo workspace root `target/`):

- `target/release/bundle/nsis/*-setup.exe`
- `target/release/bundle/msi/*.msi`

Unsigned builds may show SmartScreen — choose **More info** → **Run anyway**.

## Download Windows installer

### GitHub Releases (recommended)

Tagged builds (`v*`) publish a [GitHub Release](https://github.com/yifunxxx/gitx/releases) with both installers attached:

| Asset              | Contents            |
| ------------------ | ------------------- |
| `*-setup.exe`      | NSIS installer      |
| `*.msi`            | MSI installer       |

1. Open **[Releases](https://github.com/yifunxxx/gitx/releases)**.
2. Pick the latest `v*` release (e.g. `v0.1.12`).
3. Download the NSIS `.exe` (most users) or the `.msi`, then run it — direct installer files, not zip packages.

App / package versions are `0.1.12`, matching tag `v0.1.12`. Builds are unsigned — SmartScreen may warn; choose **More info** → **Run anyway**.

Publish a release by pushing a version tag (after the workflow is on `master`):

```bash
git checkout master && git pull
git tag -a v0.1.12 -m "gitx v0.1.12"
git push origin v0.1.12
# Watch: Actions → Release Windows; then https://github.com/yifunxxx/gitx/releases
```

Optional: **Actions → Release Windows → Run workflow** with a `version` input (`0.1.12` or `v0.1.12`) to create the same Release without a local tag push.

### CI Artifacts (master / debugging)

Every successful **Release Windows** run also uploads Actions Artifacts (30-day retention):

| Artifact name       | Contents    |
| ------------------- | ----------- |
| `gitx-windows-nsis` | NSIS `.exe` |
| `gitx-windows-msi`  | MSI         |

1. Open [Actions → Release Windows](../../actions/workflows/release-windows.yml).
2. Open a green run → **Artifacts** → download, unzip, install.

```bash
gh workflow run release-windows.yml --ref master
gh run list --workflow=release-windows.yml --limit 3
```

## Layout

- `apps/desktop` — Vue 3 frontend
- `src-tauri` — Tauri app crate + IPC commands
- `crates/*` — git engine / meta / helper
- `docs/` — product & development plan

## Milestone

**M8 Settings, Polish & Release** (on top of M0–M7) — declarative Settings (searchable), Keymap overrides, zh-CN default + en, light/dark theme persistence, Welcome copy polish, concurrency/toast Busy hardening. See `docs/dev-plan/08-milestones.md`.
