# Log 定位、窗口翻页和选择保留（2026-11-09）

跳转框通过 Git 解析提交哈希、分支和标签，在相同筛选与排序下取得目标位置，只加载目标附近 150 条提交详情。原实现找不到已加载目标时会改成提交消息筛选，不能真正定位远处提交。目标被筛选排除时保留现有列表和选择，并提供显式“清除筛选并跳转”。

历史窗口支持加载较新提交、继续加载较旧提交和返回最新提交。前后翻页重新定位边界提交，减少新增提交引起的错页；后台刷新保留已加载历史、选择和详情，小量新增提交不会挤掉原窗口底部。大批新增历史保持原窗口。刷新失败保留可用列表，迟到的仓库、筛选、选择和跳转结果不再覆盖当前操作。

支持 Ctrl/Cmd 多选、Shift 范围选择、方向键、Home/End 和父子提交导航。虚拟列表前插时保留可见提交，显式定位优先于等待中的滚动恢复；释放滚动条或窗口失焦时清理拖动状态。筛选草稿与实际条件同步，“清除”及删除筛选标签不会重新应用旧草稿。中文组合输入中的 Enter 不触发跳转。

后端定位和分页共用筛选参数，默认展示各引用可达历史，排除应用内部备份引用；分支、哈希输入使用参数边界。空历史与无效引用分别处理，十六进制提交消息不会被错误当作引用，日志输出不受签名、补丁、notes 等展示配置干扰。

验证记录位于 `E:/IDEAproject/gitx/test-results`：

- 原前端 13 项导航回归中 9 项失败；补充的 5 项刷新/竞态测试全部复现问题，修复后通过。见 `log-navigation-before.log`、`log-navigation-races-before.log`、`log-navigation-races-after.log`。
- 组件测试覆盖定位居中、未知引用提示、无结果时显示筛选排除提示、组合输入、Ctrl/Shift 选行和键盘选行。虚拟列表覆盖前插定位、显式导航优先及拖动结束事件目标。此为自动化组件覆盖，不等同桌面 Ctrl 按住单击验收。
- 独立前端 33 文件、258 项完整回归及最终类型检查通过；生产构建通过。见 `log-navigation-frontend-final.log`、`log-navigation-typecheck-final.log`、`log-navigation-build.log`。
- 集成目录前端 59 文件、430 项全部通过，生产构建通过。见 `log-navigation-integrated-frontend.log`、`log-navigation-integrated-build.log`。
- Rust core/git 全部目标 23 组、144 项通过，3 个子进程测试夹具忽略；新增 3 项真实 Git 回归通过。2 万条提交中定位靠近根部的标签并加载 150 条上下文，最后一次测试约 0.76 秒；此为本机样本，不是性能保证。见 `log-navigation-rust-full.log`、`log-navigation-rust.log`。
- 本次库及导航测试的严格 Clippy（`--no-deps`）和应用 `cargo check` 通过。实际 Rust 请求结构及领域类型通过临时 Specta 导出器生成，与前端声明逐字段核对一致；临时导出器已移除。见 `log-navigation-clippy.log`、`log-navigation-app-check.log`、`log-navigation-types-verified.json`。

边界与待办：各次 Git 查询之间不构成历史快照；目标窗口中目标消失时提示刷新。后台刷新 API 已验证，独立分支的仓库事件监听仍需后续接入。保留既有构建大 chunk 提示及 mock 文件旧 lint 警告。本轮电脑操作工具无法可靠确定浏览器地址并终止 UI 操作，因此没有新增 GUI、WSL 或桌面 Ctrl 按住单击验收结论；安装程序未替换。总体测试优化目标仍未完成。
