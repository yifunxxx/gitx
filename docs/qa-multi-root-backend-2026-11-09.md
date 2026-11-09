# 多仓库检出与恢复后端（2026-11-09）

从集成目录按功能提取到 codex/checkout-target-safety；不包含集成目录的其他未提交修改。

## 修复

- 每个工作树记录原始和检出后的提交 SHA、完整 symbolic ref，恢复 detached HEAD 时不猜测分支。
- 逐根保存 skipped、rolledBack、checkout error、rollbackError；恢复失败不再误报全部完成，重试保留原检出错误。
- 恢复前核对当前 HEAD 与原分支 tip，拒绝覆盖后续用户检出；Git 的普通检出检查保留暂存、未暂存和未跟踪文件。
- 路径别名和子目录按实际工作树去重。多仓库检出/恢复显式禁止隐式递归子模块，避免在采样子仓库之前改变它。
- post-checkout hook 失败后仍采样真实 HEAD；取消后使用独立恢复 token。
- 完整本地引用 refs/heads/shared 正规化后检查并切换，空引用和选项形式拒绝。
- Rust 类型与前端恢复数据契约同步；mock 恢复保留原错误并明确每步恢复状态。

## 验证

证据位于 E:/IDEAproject/gitx/test-results。

- 原实现 12 项真实 Git 测试中 11 项失败：multi-root-extract-before.log。
- 首轮修复后 12/12；新增完整引用用例先复现误报 skipped：multi-root-full-ref-before.log。
- 最终 cargo test -p gitx-core -p gitx-git --all-targets：18 组、113 项全部通过，包含多仓库 14 项与单仓库检出目标 8 项（multi-root-extract-rust-all.log / multi-root-extract-rust-summary.json）。
- 集成目录共享 HEAD 读取器移动及新边界：14/14（multi-root-integrated-after.log）。
- 独立 Rust Specta exporter 编译运行成功；MultiRootOpResult、MultiRootOpStep、RewriteHead 与前端声明一致（multi-root-types-export.log / multi-root-types-verified.json）。临时导出示例已移除，生成结果保留在证据目录。
- 前端 vue-tsc 与生产构建通过（multi-root-extract-frontend-build.log）；已有大 chunk 提示保留。
- 生产库严格 Clippy 通过（multi-root-extract-clippy-lib.log）。all-targets 严格检查被既有 gitx-testkit FixtureBuilder 的 derivable_impls 阻挡（multi-root-extract-clippy.log）；没有将其记为通过。

## 范围

本提交完成逐根检出/恢复语义。前端正确反馈与持久重试、Tauri 写操作统一调度仍需后续独立提交。没有新增 GUI、WSL 实机或跨命令并发覆盖声明；原集成目录 GUI 记录不是本独立版本的 GUI 证据。
