# gitx

[English](./README.md) | 简体中文

基于 dbx 技术栈（Tauri 2 + Vue 3 + Rust）的桌面 Git GUI。默认界面语言为 **English (en)**；可在「设置 → 外观」切换为简体中文（zh-CN）。支持浅色 / 深色 / 跟随系统主题，并会持久化。

## 环境要求

- Node ≥ 22.13（见 `.nvmrc`）
- pnpm 10
- Rust 1.90（见 `rust-toolchain.toml`）
- 系统 `git` ≥ 2.31
- 各平台 WebView 依赖（[Tauri prerequisites](https://tauri.app/start/prerequisites/)）

### Windows 11 额外依赖

- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（多数 Win11 已预装）
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 **Desktop development with C++** / MSVC
- Git for Windows

## 开发

```bash
pnpm install
pnpm dev:web          # UI 走 mockBackend（无 Rust 窗口）
pnpm tauri:dev        # 完整桌面壳
```

常用检查：

```bash
pnpm typecheck
pnpm test
cargo test -p gitx-git -p gitx-testkit
cargo build -p gitx-helper
```

### 导出 IPC bindings

常规构建与启动不会改动已入库的 TypeScript bindings。
若要显式导出：先编出 debug 可执行文件，再设置 `GITX_EXPORT_BINDINGS` 为输出路径后运行。导出成功后才会替换目标文件，且不会打开窗口。父目录必须存在。替换入库文件前请审阅生成签名；`pnpm bindings:check` 只检查文件是否存在。

```powershell
cargo build -p gitx
$env:GITX_EXPORT_BINDINGS = Join-Path $env:TEMP 'gitx-bindings.ts'
try {
  .\target\debug\gitx.exe
  if ($LASTEXITCODE -ne 0) { throw 'Binding export failed' }
} finally {
  Remove-Item Env:GITX_EXPORT_BINDINGS
}
```

### 主题与语言

- 工具栏太阳/月亮图标在浅色 ↔ 深色间切换（写入应用设置）。
- **设置**（`Mod+,`）→ **外观 / Appearance**：主题（system/light/dark）、语言（en / zh-CN）、圆角、配色。
- **快捷键**页：搜索操作、重绑快捷键、重置覆盖项。

## Windows 11 — 本地运行与构建

在 PowerShell 或 Git Bash 中（先装好上述依赖）：

```powershell
# 启用 corepack 或安装 pnpm 10，然后：
pnpm install
pnpm tauri:dev        # 运行桌面应用
pnpm tauri:build      # 产出 NSIS .exe + MSI，位于 target/release/bundle/
```

安装包路径（Cargo workspace 根目录下的 `target/`）：

- `target/release/bundle/nsis/*-setup.exe`
- `target/release/bundle/msi/*.msi`

未签名构建可能触发 SmartScreen — 选择 **更多信息** → **仍要运行**。

## 下载 Windows 安装包

### GitHub Releases（推荐）

打标签（`v*`）的构建会发布 [GitHub Release](https://github.com/yifunxxx/gitx/releases)，并附带两种安装包：

| 资源               | 内容         |
| ------------------ | ------------ |
| `*-setup.exe`      | NSIS 安装包  |
| `*.msi`            | MSI 安装包   |

1. 打开 **[Releases](https://github.com/yifunxxx/gitx/releases)**。
2. 选择最新的 `v*` 发行版（例如 `v0.1.24`）。
3. 下载 NSIS `.exe`（多数用户）或 `.msi` 后运行 — 直接是安装文件，不是 zip。

应用 / 包版本为 `0.1.24`，对应标签 `v0.1.24`。构建未签名 — SmartScreen 可能提示；选择 **更多信息** → **仍要运行**。

发布方式：推送版本标签（workflow 已在 `master` 上）：

```bash
git checkout master && git pull
# 在 Cargo.toml / package.json / tauri.conf.json / README 中 bump 工作区版本。
# Cargo.lock 中只改名为 gitx / gitx-* 的 [[package]] 块 — 切勿对整个文件 sed
# （可能误改第三方 crate，例如 serde_repr）。
git tag -a v0.1.24 -m "gitx v0.1.24"
git push origin v0.1.24
# 关注：Actions → Release Windows；然后 https://github.com/yifunxxx/gitx/releases
```

可选：**Actions → Release Windows → Run workflow**，输入 `version`（`0.1.24` 或 `v0.1.24`），无需本地推标签即可创建同样的 Release。

### CI Artifacts（master / 调试）

每次成功的 **Release Windows** 运行也会上传 Actions Artifacts（保留 30 天）：

| Artifact 名称       | 内容      |
| ------------------- | --------- |
| `gitx-windows-nsis` | NSIS `.exe` |
| `gitx-windows-msi`  | MSI         |

1. 打开 [Actions → Release Windows](../../actions/workflows/release-windows.yml)。
2. 打开绿色 run → **Artifacts** → 下载、解压、安装。

```bash
gh workflow run release-windows.yml --ref master
gh run list --workflow=release-windows.yml --limit 3
```

## 目录结构

- `apps/desktop` — Vue 3 前端
- `src-tauri` — Tauri 应用 crate + IPC 命令
- `crates/*` — git 引擎 / meta / helper
- `docs/` — 产品与开发计划

## 里程碑

**M8 Settings, Polish & Release**（在 M0–M7 之上）— 声明式设置（可搜索）、快捷键覆盖、默认英文 + 可选 zh-CN、浅色/深色主题持久化、Welcome 文案打磨、并发/toast Busy 加固。详见 `docs/dev-plan/08-milestones.md`。
