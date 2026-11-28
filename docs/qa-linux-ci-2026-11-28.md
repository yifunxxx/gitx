# QA162：交付分支与 Linux 应用层持续验证

日期：2026-11-28。开始前读取台账，fetch 并整合 master 与交付分支；基线 `c159bd975b3a15b2d086ea9e541dc01fac04f436` 包含 master `50a4802dd23f61055668e165f6fe7c0b93b17680`，无新提交。全程主线程。

## 覆盖缺口与修改

检查 QA023/032 的既有记录与当前 Shelf 锁、路径解析及 Smart 取消链，没有取得新的历史根因，未重复相同条件的回归。检查 Unix 验收环境时，本机 `wsl --list --quiet` 返回空列表；现有 GitHub CI 只在 master/main/docs/cursor 分支推送或 PR 时触发，当前 codex 交付分支直接推送不运行 CI。

此外 Linux Rust job 的工作区测试排除了 `gitx` 应用 crate，末尾只有 `cargo build -p gitx`。终端真实 PTY、应用内搜索、文件系统等测试虽然存在，也不能由编译成功证明其行为。本项属于测试覆盖改进，不把缺少覆盖称作产品运行故障。

修改 `.github/workflows/ci.yml`：加入 `codex/**` 推送触发，并在已安装 WebKit 依赖、构建和准备 helper 后执行 `cargo test -p gitx --lib --locked`。保留已有前端检查、工作区 Rust 测试、Clippy 和应用编译。应用测试使用原有临时 fixture，不需要启动图形桌面；最终是否可在无桌面的 CI 完成以实际运行结果为准。

## 当前验证与限制

远端运行待推送后核对。已有 master SHA `50a4802` 的 CI run `45971081977` 为成功；其覆盖为修改前配置，不能用于证明本次应用层测试或当前交付代码通过。

本项不宣称 GUI 操作、旧 Windows、所有 Unix 平台、历史滚动断档或 Shelf/Smart 偶发根因已验收。用户安装版未更新，原9项与七项目标继续。

证据目录：`E:/IDEAproject/gitx/test-results/qa162-linux-ci-20261128`。后续保存实际运行 ID、完整 SHA、步骤结果和日志；提交/推送状态见统一台账。
