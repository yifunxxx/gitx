# 克隆取消、认证重试与目标目录保护（2026-11-09）

克隆每次尝试由前端生成独立 UUID，后端在等待 Git 配置及目标目录写锁之前登记任务。取消使用该 ID 对应的令牌，成功或失败都会结束登记；重复的活动 ID 被拒绝，不会覆盖另一任务。认证后重试使用新 ID，连续提交被禁止。

弹窗显示持续错误并允许重试，取消 IPC 早于任务登记时保留取消意图，重试间隔由 50ms 逐步增加至最多 1s。窗口卸载后取消本次任务，结束时清理重试定时器；旧 URL 验证和迟到结果不再更新或关闭别的窗口。中文输入期间 Escape 不触发取消，浅克隆深度只接受正整数，关闭“克隆后打开”后成功也不会跳转。

后端在创建父目录之前检查预先取消。原取消分支按“开始时目录不存在”递归删除目标，实际会删掉运行期间其他写入者新建的文件；现在交给 Git 处理其自身回滚，不在应用层递归删除目标。

- 原前端四项回归全部失败；提取实现后均通过。额外边界回归复现了组合输入误取消及两秒内 41 次取消重试，修复后十项通过。见 clone-job-before.log、clone-job-edge-before.log、clone-job-edge-after.log。
- 四项真实后端测试基线两失败：预取消仍创建父目录、取消慢响应 HTTP 克隆删除外部写入文件。修复后四项通过，另覆盖非空目录保护及排队取消后锁释放。见 clone-cancellation-before.log、clone-cancellation-after.log。
- JobManager ID 隔离/重复登记测试通过，真实本地浅克隆成功回归通过。针对本次生产库及测试的严格 Clippy（--no-deps）、应用 cargo check 通过。
- 独立前端 30 文件/231 项通过，类型检查和生产构建通过；从实际 Rust CloneRunReq 提取并执行 Specta 导出，与前端声明一致。原有可空字段同步为生成器输出的必填 nullable 类型，随后类型检查再次通过。见 clone-frontend-*.log、clone-type-export.log、clone-type.generated.ts、clone-types-verified.json、clone-bindings-typecheck.log。
- 集成目录前端 59 文件/421 项与构建通过。集成 Rust 验证发现 13e3b11 既有合并残留使 gitx-diff 语法解析失败（clone-integrated-rust.log），另行修复；不将此轮集成 Rust 记为通过。

证据位于 E:/IDEAproject/gitx/test-results。本轮没有新增 GUI 或 WSL 实机验收声明；原安装程序未替换。既有大 chunk 提示继续保留。
