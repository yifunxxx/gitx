# 仓库写操作调度（2026-11-09）

提交 bdab9e5，已推送 codex/checkout-target-safety。

- 92 个 Tauri 写入口持有仓库调度许可，覆盖提交、索引、冲突、分支/标签、同步、历史改写、Shelf/Stash、Changelist、Worktree、clone/init 和多根检出/恢复。
- 根据实际 Git common-dir、规范化路径和父项目识别互斥范围；关联 Worktree、目录别名、普通/吸收式/旧式子模块共享写锁。独立仓库及读取继续执行。
- 成组锁排序去重；取消释放已取得的部分许可；排队期间仓库被替换后重新解析身份；预留新目录及其 .git，覆盖创建过程。
- Weak 引用清理空闲锁，1000 个仓库不会永久累积信号量。

验证：旧实现的空闲锁回收和 Windows 路径别名两项基线失败（scheduler-extract-before.log）。最终 cargo test -p gitx-core -p gitx-git --all-targets 共 20 组、131 项通过（scheduler-full-rust.log、scheduler-full-rust-summary.json）；其中调度器单元 5 项、仓库级 9 项、子模块 4 项。cargo check -p gitx 与改动文件 rustfmt、git diff --check 通过。92 个处理器逐项记录在 scheduler-handler-audit.json。日志位于 E:/IDEAproject/gitx/test-results。

仅约束本应用内部写操作，不约束外部 Git 进程。此提交不包含收藏原子切换接口、任务取消 UI 或 WSL 实机验证；没有新增 GUI 验收声明。
