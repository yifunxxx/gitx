# QA162：交付分支与 Linux 应用层持续验证

日期：2026-11-28。开始前读取台账，fetch 并整合 master 与交付分支；基线 `c159bd975b3a15b2d086ea9e541dc01fac04f436` 包含 master `50a4802dd23f61055668e165f6fe7c0b93b17680`，无新提交。全程主线程。

## 覆盖缺口与修改

检查 QA023/032 的既有记录与当前 Shelf 锁、路径解析及 Smart 取消链，没有取得新的历史根因，未重复相同条件的回归。检查 Unix 验收环境时，本机 `wsl --list --quiet` 返回空列表；现有 GitHub CI 只在 master/main/docs/cursor 分支推送或 PR 时触发，当前 codex 交付分支直接推送不运行 CI。

此外 Linux Rust job 的工作区测试排除了 `gitx` 应用 crate，末尾只有 `cargo build -p gitx`。终端真实 PTY、应用内搜索、文件系统等测试虽然存在，也不能由编译成功证明其行为。本项属于测试覆盖改进，不把缺少覆盖称作产品运行故障。

修改 `.github/workflows/ci.yml`：加入 `codex/**` 推送触发，并在已安装 WebKit 依赖、构建和准备 helper 后执行 `cargo test -p gitx --lib --locked`。保留已有前端检查、工作区 Rust 测试、Clippy 和应用编译。应用测试使用原有临时 fixture，不需要启动图形桌面；最终是否可在无桌面的 CI 完成以实际运行结果为准。

## 实际远端验证与交付

修改已独立提交并推送：`01a5df2ecb730b647bf9ff8ffacc14026e481d29`，`ls-remote` 完整 SHA 与本地一致。GitHub Actions run `46145918885` 正是该提交，2026-11-28 北京时间20:41:30开始、20:45:33完成，结论 `success`。本地 YAML 解析、Pages 与差异检查通过；补记前再次 fetch、整合 master/交付分支成功，无新提交。

- 前端218个文件、2569项通过/4项既有跳过，类型、Vite生产构建与bindings检查通过。
- Linux应用库新增执行步骤实际运行72项，0失败、0忽略。终端5项全部通过，覆盖真实交互Shell工作目录/输出/resize/退出、活跃Shell关闭唤醒读并释放资源、队列有界与关闭唤醒、非法启动及shutdown后拒绝新会话。
- 原工作区Rust测试、fmt、Clippy、helper及桌面应用编译全部通过。日志中的Git版本为2.56.1，Rust工具链1.90.0。
- `e2e-web-placeholder` 仅执行echo，虽然job为绿色，也不计作浏览器端到端测试。

关闭QA162测试覆盖改进。此前master的run `45971081977` 仅保留历史意义，本次结论来自上述精确提交的实际日志。Linux证据补入QA010/046；平台条件编译导致数量与Windows不同，不能把Linux结果扩展到全部Unix环境或Windows ConPTY专用分支。

本项不宣称 GUI 操作、旧 Windows、所有 Unix 平台、历史滚动断档或 Shelf/Smart 偶发根因已验收。用户安装版未更新，原9项与七项目标继续。

证据目录：`E:/IDEAproject/gitx/test-results/qa162-linux-ci-20261128`，已保存`run-final.json`（完整SHA、jobs和steps）、`run.log`及`summary.json`。本报告只采用可独立核对的前端、应用lib和终端数量，不把日志中的嵌套测试摘要简单相加作为整体完成度。
