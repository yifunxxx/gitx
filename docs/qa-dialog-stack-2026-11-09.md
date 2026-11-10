# 嵌套弹窗与键盘焦点（2026-11-09）

原单一弹窗槽位在打开认证或确认子窗口时会卸载父窗口，使父窗口的 Promise 无法完成；后台请求的迟到关闭也可能关掉后来打开的窗口。

现在按独立 ID 保存弹窗栈，子窗口显示时保留父组件和输入，关闭指定窗口只结算它自己的 Promise。DialogHost 将焦点限制在最上层，支持 Tab/Shift+Tab 循环、关闭后的焦点恢复、中文输入期间 Escape 保护，避免子窗口自行处理 Escape 后同一事件再次关掉父窗口；宿主卸载会结算所有待处理窗口。

- 基线四项回归全部失败：父窗口恢复、后台窗口定向关闭、焦点循环/卸载结算、Escape 双重关闭。证据 dialog-stack-before.log。
- 修复后补充父表单实例及输入保持、顶层关闭后恢复入口焦点、Shift+Tab 和组合输入 Escape，共六项通过。
- 独立前端全量 29 文件/221 项通过，vue-tsc 和生产构建通过，git diff --check 通过。证据 dialog-stack-all.log、dialog-stack-build.log，位于 E:/IDEAproject/gitx/test-results。

此项为组件和状态生命周期回归；未把模拟 DOM 键盘事件记为本轮真实桌面操作。生产构建保留既有 chunk 体积提示。
