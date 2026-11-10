# 元数据事务与原子替换（2026-11-09）

- Settings、Favorites 读写和 Changelist 完整读取/修改/保存共用按规范化目录选择的进程内锁，防止并发操作丢失更新。
- 用唯一临时文件替换完整 JSON；失败自动清理临时文件，读者只看到完整版本。
- Favorites 提供 toggle_favorite/rename_favorite 原子更新方法，保留未出现在当前分支视图中的条目；损坏或不可读数据返回错误并保留原文件。
- Weak 锁表在后续操作中回收空闲项。没有引入最近仓库去重或 Shelf 行为修改。

基线 4 项中 3 项失败：16 路并发创建、16 路并发移动和替换失败后的临时文件清理（metadata-extract-before.log）。修复后 gitx-meta --all-targets 2 个单元测试与 8 个集成测试全部通过（metadata-extract-after.log），包含目录别名、收藏切换奇偶性、损坏数据保留、并发读取和设置完整版本。严格 Clippy --all-targets -D warnings 及 cargo check -p gitx 均通过（metadata-extract-clippy.log、metadata-extract-app-check.log）。证据位于 E:/IDEAproject/gitx/test-results。

锁在本进程内生效；不承诺跨进程读取/修改/写入互斥或断电持久化。本提交新增收藏原子接口但前端仍使用旧的整份列表保存；入口接入和异步反馈继续单独修复。
