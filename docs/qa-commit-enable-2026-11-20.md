# QA-036：提交面板启用 Git 的共享等待与导航保护

日期：2026-11-20。基线产品为 `f36a25f`（0.1.40），交付分支文档 HEAD 为 `4d58d90`。

## 来源与已复现问题

继续补原生初始化验收时，核查发现 `CommitToolWindow.vue` 的非仓库空态按钮仍直接调用 `workspace.enableVcs("main")`，完成后无条件提示并刷新 Changes。此前欢迎页、标题栏、全局 `Git.Init` / `Start.Use.Vcs` 和 Clone 后打开已统一，但这个组件内入口遗漏，不能据此前审查宣称所有入口都已接入。

实际组件、Pinia workspace/layout 与真实共享控制器回归在修改前 **6 项全部失败**，日志 `E:/IDEAproject/gitx/test-results/commit-enable-before-20261120.log`：

- 连续点击会重复初始化，没有加载或防重反馈。
- 成功后只刷新 Changes，没有共享的 Log/Branches 首读与等待。
- 异路径或同路径新导航后，旧初始化仍显示成功并刷新当前页面。
- 初始化失败冒泡到 Vue 事件错误处理，没有可读失败反馈与受控重试。
- 其他入口已打开目录选择器时，该按钮仍可执行初始化。

作为 QA-036 已有范围续查，不重复创建编号。后端已经发起的初始化不会因导航被回滚；修复范围是新请求防重、反馈、读取及导航归属。

## 修改与自动验证

提交面板接入 `useWorkspaceOpen().enableVcs`，删除直接调用及重复后处理。按钮与欢迎页、标题栏、全局动作共享 pending；显示 Loading、旋转图标、disabled、aria-busy，减少动态效果偏好下停止图标旋转。初始化或首读失败沿用共享错误提示，过期结果不能影响新的导航和等待状态。

新增 **8 项组件回归**通过，追加验证旧失败不能清除新等待、初始化成功后首读失败明确归类为刷新失败。相邻 **7 文件 / 111 项**通过，类型、6 个文件 Oxlint、diff-check 通过。四个旧组件测试增加 log/branches store 替身；第一次集成的77项失败属于原测试装配未提供新增依赖，修正后通过，不登记为产品缺陷。

证据均在 `E:/IDEAproject/gitx/test-results/`：`commit-enable-after-20261120.log`、`commit-enable-typecheck-20261120.log`、`commit-enable-lint-20261120.log`。首次装配日志另存 `commit-enable-integration-20261120.log`。

最终完整前端 **140 文件 / 1239 项**、类型检查、Vite 生产构建、Windows 原生构建通过，日志 `commit-enable-final-{tests,web,native}-20261120.log`。Vite 的 chunk 体积/动态导入警告保留；本次前端入口修复未改 Rust，无需将上一轮定向 Rust 结果写成本轮重新执行。

测试中首读次数只针对该入口直接调用；全局刷新器在导航/注册后仍可能安排读取，不能宣称全应用只有一次后端首读。独立审阅确认未新增计时器、原生订阅或持久组件监听，共享状态按 workspace 保存在 WeakMap 中。

## 原生创建仓库补验（修复前程序）

使用此前最终程序 `gitx-lifetime-live-0140-20261119.exe`，SHA256 `896FEF96DC1139A551B39336EE491742B06B96838C626DC34414E93EE1BE4CF7`。欢迎页 Create Repository 打开目录选择器，背后入口和标题栏显示等待/禁用；取消后恢复，可以再次发起。选择专用目录 `E:/IDEAproject/gitx/test-results/repos/init-create-20261120` 后，观察到包含目标路径的 Loading；最终显示 Repository=yes、main 和未跟踪的 sample.txt，Git status 确认 `No commits yet on main` / `?? sample.txt`。

目录选择器的 accessibility 索引一次返回缓存错误；重新观察后使用可见坐标完成取消与输入，未当作产品失败。焦点树误报搜索框，截图确认光标位于目录输入框，输入后路径可见且正确。

该流程补齐既有创建仓库正常/取消路径，程序不包含本次提交面板修复。未执行远程鉴权，也未把原生创建成功当作克隆取消/交叉导航验收。

## 修复后按钮的原生验收

最终程序 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-commit-enable-0140-20261120.exe`，SHA256 `E18693E2ABB4A1FE583DE474FDED1AE5FD7E8CB2C7B1B3EA3BC6738376A6F2DD`。

首先准备的 test-results 子目录位于集成仓库内部，打开后按 Git 向上查找规则识别到父仓库，因此未在那里执行 Enable VCS；改用 `C:/Users/Yifun/AppData/Local/Temp/gitx-init-enable-20261120`，操作前 `git rev-parse --show-toplevel` 确认不属于仓库。此为测试目录选择修正，不登记为产品缺陷。

新程序打开独立目录后显示 Repository=no、非仓库空态和 Enable Version Control Integration 按钮。打开标题栏目录选择器时，按钮变为 disabled/Loading，取消后恢复。点击该按钮，标题栏和按钮同时显示 Loading 与旋转图标；完成后显示 Repository=yes、main、未跟踪 sample.txt 及空历史，磁盘 status 与界面一致。

该流程覆盖正常启用、跨入口等待和取消恢复；真实初始化失败/重试、同路径竞态仍是受控组件回归证据，没有以人工点击尝试制造难以稳定复现的导航时序。

## 交付边界

本轮初始化专用目录为新建测试数据，保留完成后的仓库作为证据。两目录都为 main、仅 sample.txt 未跟踪，内容逐字节符合 `initial sample\n`；两个专用程序已退出。设置比较确认只有 recentWorkspaces 因测试变化，按备份 `init-settings-before-20261120.json` 恢复后 SHA256 为 `F160603B7BCE0F5CF7D07D6D1EAA088B6B69B79BB2F1FF83B855FB00E4F245C7`。结束汇总 `init-native-end-20261120.json` 位于 test-results。

此功能、回归和报告已独立提交推送 `1f25a44ae37cb6408cd8a205bdf5b185cd4c0a25`，远端完整SHA核对一致。安装路径 `D:/gitx/gitx.exe` 仍为0.1.35，未更新。QA-036 继续保留原生克隆取消/交叉导航边界，整体目标未完成。
