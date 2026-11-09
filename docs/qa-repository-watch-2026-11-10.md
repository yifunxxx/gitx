# 仓库自动刷新与监听资源生命周期（2026-11-10）

原独立分支的文件监听仍为占位实现。现接入原生文件通知，覆盖工作区、index、refs、操作状态、ignore 和 gitx 元数据。关联工作树同时监听私有 gitdir 与 common dir，统一 Windows/UNC 路径比较。忽略访问事件、锁文件、对象库、reflog 和日志索引写入，避免读取操作触发刷新循环。

原生队列最多容纳 1024 个事件，300ms 合并，连续事件最多延迟 1 秒。溢出会触发完整刷新，运行时监听错误会通知前端切换到可见窗口的 5 秒轮询。空闲 worker 阻塞等待事件；替换、卸载、关闭窗口时显式唤醒并回收线程和句柄。单调注册代次阻止旧窗口的注册/释放覆盖新窗口，关闭后拒绝迟到注册。

前端合并密集通知、隐藏时保留待刷新状态、恢复可见或获得焦点时补刷。Git 作业和 rewrite 仍在执行时等待；Log 正在跳转或翻页时保留待刷任务。切换仓库不会等待旧仓库慢请求，也不会接受旧结果或报错。Worktrees、Stash/Shelf、冲突和操作状态增加读取代次保护。应用事件订阅在异步注册完成后立即归属清理逻辑；作业列表按原生实际状态校正，取消“5 分钟即视为卡住”的错误清理。

验证证据位于 `E:/IDEAproject/gitx/test-results`：

- 刷新生命周期基线 5 项失败，四个 store 的 8 项竞态全部失败；修复后通过。见 `watch-lifetime-before.log`、`watch-lifetime-after.log`、`watch-stores-before.log`、`watch-stores-after.log`。
- 最终独立前端 37 文件 / 282 项通过；集成前端 62 文件 / 451 项通过。集成两个旧测试桩已补充实际 workspace 的 navigationToken 接口。两处最终生产构建通过，新增 TypeScript 文件 oxlint 通过。最终完整回归见 `watch-frontend-final.log`、`watch-integrated-frontend-final.log`。
- 补充复现“运行时错误早于注册 IPC 响应到达”时轮询被误关，调整为开始新注册时清除旧 fallback；11 项刷新测试全部通过。见 `watch-registration-race-before.log`、`watch-registration-race-after.log`。
- Rust watcher 9 项通过，覆盖真实文件事件、关联工作树 refs/index、持续写入最大延迟、队列溢出、失效注册、失败注册清理和同根目录回调替换。严格 Clippy 通过。独立应用 cargo check 和桌面 build 通过，集成桌面 build 通过。
- 实际运行集成调试程序的显式 Rust 导出，workspaceWatch(roots, generation) 和 workspaceUnwatch(generation) 与前端参数/返回值一致。见 `watch-generated-bindings.ts`。
- 独立资源探针 `crates/gitx-watch/examples/watch_resource_probe.rs` 完成 35 个采样：初始句柄 81 / 线程 4；监听空闲及连续 100 次替换后均为句柄 85 / 线程 6；shutdown 后句柄恢复 81、线程最终降至 1。空闲阶段 CPU 增量均为 0，连续替换后私有内存稳定于 1,011,712 字节。见 `watch-resource-samples.json`、`watch-resource-summary.json`。

桌面复验使用集成目录内嵌前端的调试构建，另命名 `gitx-watch-qa.exe`，进程 26692，未替换安装文件。测试仓库 `watch-refresh-qa` 中，在窗口保持打开时从外部修改 tracked.txt，Changes 自动出现；双击打开 Diff 后再次追加文本，右侧自动出现新行。随后外部提交 `3129aae` 并创建 `qa/external-branch`，无需点击刷新，变更列表恢复干净，Diff 变为无差异，Log 和分支同步更新，同时保留原先选中的 `620e59e` 及详情。现场截图已在会话展示，首次修改的可访问文本保存在 `watch-gui-external-modification.txt`。后续 UIA 只返回占位文本，Diff 与提交结果以现场截图为依据。最后的注册响应竞态修正发生在该桌面构建之后，已由两处最终完整前端回归及生产构建覆盖。

完整应用的自动化连接采样 64.67 秒时进程树 CPU 增量 31.28125 秒，不能作为纯空闲结果。重置自动化会话后独立再采样 66.41 秒 / 13 次，8 个进程保持一致，主进程 CPU 增量 0、进程树 CPU 增量 0.234375 秒；主进程句柄 695 → 689、私有内存 21,463,040 → 21,348,352 字节，进程树私有内存 252,801,024 → 252,780,544 字节。两组数据分别保存在 `watch-app-resource-connected-*.json` 与 `watch-app-resource-samples.json` / `watch-app-resource-summary.json`，观察到自动化连接显著影响采样。正常关闭窗口后按 PID 和创建时间检查全部 8 个进程均已退出，见 `watch-app-closed-processes.json`。

上述资源数据仅覆盖独立 watcher 约 35 秒和应用约 1 分钟，不代表完整应用长期资源验收。WSL 实机、真实 Ctrl 按住鼠标点击及更长时间主动操作仍未覆盖，六项总目标继续保持进行中。
