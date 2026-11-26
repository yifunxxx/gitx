# QA-109 任务队列键盘操作与任务名称

日期：2026-11-26。开始前读取统一台账，fetch及主分支/交付分支快进检查成功；基线`9922754c3f889384ad631a73e5a3e819d0477c01`包含master`e2e33d96e3bc0aed8c206fe22562ab9432c8d27a`（0.1.48）。全程主线程。

## 问题与修改

JobsPopup复用右键菜单，但任务内容并不是菜单命令。不可取消任务没有可导航项，菜单的End/方向键处理阻止原生滚动；多个取消按钮同名，进度条没有任务名称；点击取消会把焦点恢复到面板外，尽管任务面板仍然打开。

真实JobsPopup、StatusBar、stores和生产CSS的Chromium验证：40任务面板高568px、内容高1893px，深浅主题按End后scrollTop均仍为0；三个取消按钮同名Cancel，三个progressbar名称为空，取消等待期间焦点离开面板。首批新增5项回归全部失败。

共享ContextMenuSurface增加显式dialog模式，仅任务队列启用，既有菜单默认行为保持。任务面板自身可聚焦，方向/Home/End/Page键使用浏览器原生滚动，Tab/Shift+Tab在内容和可用取消按钮之间循环；取消按钮禁用或任务行移除时，焦点保留在面板。Escape关闭后恢复入口；输入法组合、修饰及长按按键不触发重复取消/关闭，指针移动不抢键盘焦点。

取消按钮及进度条名称包含任务标题和现有详情（包括后台Fetch仓库路径），状态栏入口声明dialog弹层。固定面板宽度并限制于视口，增加键盘焦点轮廓，减少动态效果设置下关闭进度宽度动画。App全局快捷键使用冒泡监听；面板隔离按键，既有dialog识别也兼容该模式。

## 自动与浏览器验证

- 最终新增6项回归通过：原生滚动按键、任务名称、Tab循环、取消中及行移除焦点、hover/长按保护、IME/修饰Escape及后台快捷键隔离。既有取消成功/失败/重开/旧错误和共享菜单回归继续通过。
- 完整前端196文件2024项通过，4个既有probe默认跳过；类型检查、Vite生产构建、Windows独立程序构建和相关Oxlint通过。保留既有chunk大小提示。Rust源码、依赖与绑定未修改，不重复宣称本轮执行了完整Rust测试。
- 900×600浏览器深浅主题：End滚动到1325，达到40任务末尾；反向滚轮正常，面板不超出视口，Escape恢复入口。三个可取消任务的Tab顺序为三个按钮和内容面板，Shift+Tab反向循环。
- 取消等待时按钮禁用、焦点仍在面板；失败后可重试；取消和进度的可访问名称逐项对应。最终after-final.json的allPassed=true，无pageerror，最终浅色长列表和深色取消焦点截图已复核。

证据目录：`E:/IDEAproject/gitx/test-results/qa109-jobs-accessibility-20261126`。包含before.json、after-final.json、测试日志、截图及测试壳；临时浏览器入口已归档，从产品源码目录移除。浏览器模拟取消IPC，不代替原生任务取消或屏幕阅读器朗读测试。

## 原生验收与交付边界

Windows构建耗时1分57秒，独立identifier为app.gitx.qa109，程序SHA256为`1B1038F9933B4D02845A01E1A87888CB3B98A99FB1C0FD48A0A12A621D37A21E`。专用fixture只有一个README提交，origin指向本地空bare仓库；专用Git代理仅阻塞该fixture的fetch，不执行网络传输，也不修改产品超时。

首次从VCS菜单执行普通Fetch。实际是不可取消的前台任务，故只验队列显示、Tab聚焦内容和Escape恢复入口；截图显示面板与入口的焦点轮廓。UIA focused_element在该环境只返回宿主pane，不作为DOM精确焦点证据。95.441秒后显式释放代理，任务正常回到Idle，不计为取消测试。

随后仅将专用测试settings改为深色、autoFetchMinutes=1，重开同一程序，等待真实后台Fetch进入代理：

1. 队列面板在Windows无障碍树中为具名dialog，取消按钮名称为“Cancel — Auto Fetch · 仓库路径”。Tab进入取消按钮，截图中有清晰焦点框。
2. 按空格调用原生取消，任务从队列移除、状态栏回到Idle，面板显示No running processes并保留焦点轮廓。Git代理PID 29060已退出，release和released.txt均不存在，排除正常释放/300秒超时导致的假通过。
3. Escape关闭面板，入口出现焦点轮廓。没有把瞬时Cancelling禁用状态算作原生已观察；该等待状态由受控浏览器与组件回归证明。原生只覆盖一个实际后台任务，40任务长列表/滚轮及多按钮Tab顺序仍以浏览器证据为准。

两次实例合计18个记录PID/创建时间的程序、WebView、代理和控制台进程全部退出；fixture HEAD、index tree、status、refs和README字节与baseline完全一致。用户settings SHA256保持`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。专用settings已归档移除，用户安装版未更新。

提交前再次fetch及两分支快进检查成功，master仍e2e33d9，交付仍9922754，无新增远端提交。新增并解决QA109，回到原11项已知未关闭；整体七项目标继续。提交和推送状态以统一台账为准。
