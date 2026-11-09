# 收藏原子切换与迟到请求（2026-11-09）

- 收藏按钮改为发送仓库路径和单个完整引用名；后端取得仓库许可后按 Git 实际 git-dir 原子切换，不再提交前端过时的整份收藏列表。
- 保留当前视图没有显示的收藏；快速点击两个星标或同一星标两次均保留每次操作。立即反馈，写入结束后刷新；写入期间废弃旧刷新。
- 失败还原星标、显示持久错误并允许重试；切换仓库、A→B→A、相同路径但新的导航均使旧结果失效，计数最终释放。
- 读取收藏错误继续返回，不把损坏内容当作空收藏。分支重命名前先解析元数据位置，成功后原子迁移收藏。

8 项前端回归在旧实现全部失败（favorites-extract-before.log），修复后全部通过（favorites-extract-after.log）。独立分支前端全量 27 文件/215 项通过，含 vue-tsc 的生产构建通过（favorites-frontend-all.log、favorites-frontend-build.log）。

从实际 Rust 结构定义提取的 Specta 导出与前端 FavoritesToggleReq 一致，命令名 favorites_toggle 核对通过（favorites-type-export.log、favorite-type.generated.ts、favorites-types-verified.json）。完整原生命令导出程序编译成功但本机启动遇到 STATUS_ENTRYPOINT_NOT_FOUND，故改用仅类型导出程序；不将原生导出程序记为运行成功。临时 example 已移除。应用 cargo check 结果见 favorites-app-check.log。

集成目录合并残留的重复声明/属性和旧 Log 测试 mock 另行修复后，全量 59 文件/413 项、类型检查和生产构建通过（branch-merge-final-all.log、branch-merge-final-build.log）。集成修复与本功能分开提交。没有新增 GUI 或 WSL 实机验收声明；前端 chunk 体积提示继续保留。所有证据位于 E:/IDEAproject/gitx/test-results。
