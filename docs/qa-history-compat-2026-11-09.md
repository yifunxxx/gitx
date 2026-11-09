# Git 2.34 历史改写兼容验证

日期：2026-11-09。环境：Windows、Git 2.34.1.windows.1、Rust 1.90。

## 问题与修改

基线 `aa668b3` 的旧提交改消息、Squash、Drop 和内存交互式 Rebase
调用 `merge-tree --write-tree --merge-base`，本机 Git 返回 129，M5 的 7 项中 4 项失败。

本次仅在该命令返回 129 时启用兼容重放：使用自动清理的临时目录和独立
`GIT_INDEX_FILE`，从仓库根目录生成二进制补丁，三方应用到临时 index 后写出 tree。
用户的 index 和工作文件不参与该过程；发生冲突时返回 `RewriteConflict`。
其他 Git 错误仍按原有路径返回。

内部补丁显式固定前缀、颜色、行标记和子模块格式，关闭 textconv、外部 Diff 及相对路径。
新增回归先复现了自定义 Diff 显示配置导致 `unrecognized input`，固定格式后通过。
子模块引用即使被用户的 Diff 设置隐藏，也会包含在重放结果中。

## 验证

- M5 历史改写 7 项通过，原来的 4 项失败均已修复。
- 新增 9 项真实 Git 回归通过：直接测试兼容方法，保证新 Git 的 CI 也会覆盖它。
  场景含子目录内外文件、双方独立修改、冲突、二进制、重命名、删除、执行位、
  空补丁、Diff 显示设置、textconv、子模块引用，以及主/Linked Worktree 的公开改消息接口。
- 兼容方法测试逐字节比较操作前后的真实 index 和工作文件，核对 HEAD 与 symbolic HEAD。
  公开接口测试另核对提交树、改写后的消息和主工作树隔离。
- 普通 Clippy 通过，仍有两条基线告警：testkit 可派生 Default，status 测试空字符转义有歧义。
- 扩大的 gitx-git all-targets 检查中，其余已运行测试通过；M7 的 Worktree 列表测试
  因另一项基线问题 `worktree list -z` 不受 Git 2.34 支持而失败，不能将该次全量记为全绿。
- 格式与补丁空白检查通过。

证据保存在原工作区的 `test-results/`：
`checkout-baseline-history-tests.log`、`history-compat-config-before.log`、
`history-compat-unit-after.log`、`history-compat-nested-reword.log`、
`history-compat-all.log`、`history-compat-clippy.log`。

本次未执行新的桌面 GUI 流程或 WSL 实机验证；此前集成构建的 GUI 历史改写证据
记录在 `qa-2026-11-08.md`，不能当作本独立提交的二进制验收。
