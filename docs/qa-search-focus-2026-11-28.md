# QA137：搜索窗口焦点恢复

日期：2026-11-28。开始前读取台账、fetch并检查master及交付分支，干净基线`722f84205a7ea72f0adb8ee1513bfc3bca024780`包含master`50a4802dd23f61055668e165f6fe7c0b93b17680`，版本0.1.56。全程主线程。

## 现象与修改

QA136原生复查时，Search again完成后一次Escape没有关闭弹窗。随后以真实焦点事件复现：已聚焦按钮在刷新/停止/读取时被卸载或禁用，焦点变为body或不可用控件，键盘事件没有继续送到搜索窗口的处理器。文件名搜索的停止/重试存在相同缺口；自然扫描结束、用户仅Tab聚焦停止按钮时也会发生，不只是鼠标点击。

两个搜索窗口共用轻量的组件更新钩子：更新前只记住当前弹窗实际拥有的焦点；更新后仅当原控件已移除或禁用、焦点没有转移到其他控件且本弹窗仍属于当前导航/顶层时，恢复到搜索框。写入替换期间搜索框不可用，则恢复到可编程聚焦的弹窗容器，使Escape继续被写入保护拦截；完成后可以正常关闭。

不添加全局键盘监听、MutationObserver、定时器或轮询。可用控件继续保留焦点；已在其他输入框输入、嵌套子弹窗、失效仓库导航和卸载后的结果不抢焦点。容器使用tabindex=-1，不增加Tab导航停靠点。

## 自动验证

新增10项组件回归在旧实现9失败/1子弹窗对照通过，修后相关3文件48项通过，包括真实DialogHost既有嵌套/Tab/恢复测试。新增覆盖刷新卸载、底部搜索禁用、自然扫描结束、停止禁用/结束、翻页禁用且不抢后续Include焦点、页重试、替换写入保护、子弹窗及文件名停止/重试。

完整前端206文件2232项通过，4项既有probe跳过；类型/Vite构建和相关Oxlint/格式检查通过，Vite保留既有大chunk提示。本项未改Rust，不重复Rust业务回归。

真实Chromium通过专用Vite测试页挂载当前搜索组件、真实DialogHost/Pinia和受控后端，同时加载修改前组件副本作对照，使用真实click/focus/键盘Escape验证。旧版9个操作都焦点落到body且Escape未关闭，修后9个操作全部通过；另2项验证后续Include输入不被抢焦点、子弹窗保留及关闭后恢复父窗口输入。无页面运行错误，浏览器/测试server已关闭。首次测试页因证据目录不在Vite允许路径中而未加载，补齐专用server allow后重跑；子弹窗最初使用runtime版Vue不支持的template，改为render后重跑。这些测试装配失败不计作产品缺陷。

证据目录：`E:/IDEAproject/gitx/test-results/qa137-search-focus-20261128`。旧实现失败保存在`before.log`，组件结果`focused.log`，完整`frontend-full.log`；浏览器脚本、受控页面和结果一并保留。

## 原生与交付

最终Windows debug/no-bundle构建通过。专用identifier `app.gitx.qa137focus20261128`，独立仓库含一个401匹配的文本文件；程序SHA256 `891426ada99131924a4cc60cb549342c53a035db8fb2681f337c2ca74f0b1791`。主进程PID20040、创建UTC `2026-11-27T17:00:41.2109981Z`，独立WebView profile。

原生完成两条直接验证：搜索401匹配后点击Search again，刷新正常结束、按一次Escape关闭窗口；重开搜索、点击Next page到第2页后，不再点击输入框，直接Down将第二行高亮，再Enter打开focus.txt第202行。搜索框目视焦点与键盘实际处理一致；UIA focused_element只报告RootWebArea，未把该字段当作精确DOM焦点证据，精确焦点归属以浏览器对照为证。

原生证据为`native-refresh-focus.json`、`native-refresh-escape.json`、`native-page-arrow.json`及`native-page-enter.json`，截图在本轮工具记录中。停止/重试/替换写入和子弹窗精确时序保留真实浏览器与组件证据，不声称这些全都重跑了Windows原生。

8个观察进程身份均已退出；文件SHA256、HEAD、索引树和干净status与基线一致。个人settings仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，专用settings归档移除，用户安装版未更新。中英文Pages教程已补焦点及Escape行为并构建通过。

提交前再次fetch及master/交付分支检查无新提交。本轮新增编号0，解决既有QA137一项，回到原9项持续验收/归因事项；整体七项目标保持进行。功能独立提交推送结果在统一台账补记。
