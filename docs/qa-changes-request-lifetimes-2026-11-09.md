# Changes 刷新与变更列表顺序（2026-11-09）

- 仓库切换同步清空状态、选择、勾选及仓库版本号，低版本号的新仓库不再被旧仓库挡住。
- 状态/变更列表读取同时核对请求序号与导航 token；A→B→A 和导航已启动但路径尚未变更时的旧数据不回填。
- 刷新在 settings.load 之前捕获请求身份，旧设置加载完成后不会重新发起状态读取并抢占新刷新。
- 变更列表写请求按用户顺序串行，写入期间失效旧读取，错误可恢复；过期排队请求不执行。即使导航没有改变路径，过期写也会释放读抑制计数。
- 切到 staging 模式后，旧 changelist 读取不会重新显示列表；后台刷新保留已有内容，避免不必要的加载闪烁。

证据根 E:/IDEAproject/gitx/test-results：原 15/15 失败（changes-lifetime-extract-before.log），修复后 15/15 通过（changes-lifetime-extract-after.log）。最终独立前端全量 26 文件/207 项、集成目录全量 56 文件/397 项均通过；两者 vue-tsc 与生产构建也通过（changes-lifetime-*-all.log / changes-lifetime-*-build.log），已有 chunk 大小提示保留。

本项用可控 Promise 验证竞态与队列顺序，没有新增 GUI 声明；跨窗口/跨进程元数据互斥和仓库写操作调度继续单独整理。
