# Git 进程取消与管道生命周期（2026-11-09）

本次单独提取进程生命周期修复，保留现有 WSL 路由和认证配置逻辑。

GitRunner 在启动前检查取消令牌，读 stdout/stderr 与写 stdin 同时进行，使超时和取消覆盖输入写入阶段。Windows 使用设置了 KILL_ON_JOB_CLOSE 的 Job Object，进程以挂起状态创建，加入后恢复执行，防止后代在纳管前逃逸；取消、超时、I/O 错误及调用 Future 被丢弃均能清理后代。子进程另启用 kill_on_drop，避免早期错误遗留根进程。

- 基线三项中两项失败：已取消任务仍尝试启动可执行文件；根进程退出后后代仍持续写心跳。双向 2 MiB 管道样例在本机基线已通过，不将它记为已复现死锁。见 runner-lifecycle-before.log。
- 修复后五项通过：上述三项，加上不消费 8 MiB stdin 的超时、丢弃调用后的后代清理。三个 ignored 用例是由这些测试明确启动的子进程 fixture。见 runner-lifecycle-after.log。
- gitx-core + gitx-git 全 targets 共 21 组/136 项通过，3 个 ignored fixture；见 runner-lifecycle-all.log、runner-lifecycle-summary.json。
- 本次生产库及新增测试的严格 Clippy（--no-deps）通过；不排除依赖时被 testkit 原有 derivable_impls 建议阻断，原始记录保留。应用 cargo check -p gitx 通过。见 runner-lifecycle-clippy*.log、runner-lifecycle-app-check.log。

证据位于 E:/IDEAproject/gitx/test-results。本轮在 Windows 执行；未声称完成 WSL/Linux 实机进程树验收。原安装程序未替换。
