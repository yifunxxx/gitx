# QA-066：终端异步粘贴归属与等待反馈

2026-11-20。修改前成功 fetch，基线16ffe1e6585539bcbf929a72c0584abcdae50c1f与交付分支一致，已包含master efc2a8afe17af6f4c937c8c95c8f7e58dc834b0a。本轮由主智能体独立完成。

提交前再次fetch发现master发布0.1.43；已快进整合e5c6b7667f0c5de15cd7a5bc94a473b7e31c6f30，仅五处版本文件变化，与本项修改没有冲突。同步后终端56项再次通过，类型/生产及原生构建另存0143日志。原0.1.42构建成功，但没有用它冒充最终0.1.43原生验收。

## 问题与修改

终端工具栏、右键菜单和Ctrl+Shift+V共用异步Clipboard API。旧实现读取完成后只检查会话仍然运行；用户切换会话、隐藏再显示、切换仓库或继续输入时，延迟返回的文本仍会发给原终端，并抢回焦点。多次请求也没有防重和等待反馈，过期的权限错误会显示在新上下文里。

增加单次粘贴请求代次及等待状态；会话切换、面板隐藏、工作区导航（包括同路径重开）、退出及卸载会取消旧请求。用户继续键盘输入、输入法开始、beforeinput或原生paste也使旧请求失效。终端的ANSI查询回复仍通过onData正常发送，不会误取消粘贴。返回时再次检查活动会话、运行状态和焦点归属，避免覆盖其他输入焦点；旧finally不清除后续请求的等待状态。

等待中工具栏显示旋转图标、aria-busy并禁用重复粘贴；菜单和快捷键同样防重。当前请求失败显示错误并恢复按钮，重试清除旧提示。已有PTY会话继续运行，本次没有改变后端传输或shell命令执行。

## 自动验证

- 旧实现新增11项失败，原11项通过；涵盖切换及切回、隐藏及显示、导航及重开、继续输入和过期失败。日志 `E:/IDEAproject/gitx/test-results/qa066-before-20261120.log`。
- 修复后终端4文件/56项通过，包含组件30项。新增19项中还覆盖旧请求不清理新等待、失败重试、关闭/卸载/退出/外部焦点、ANSI回复以及目录请求关闭旧菜单。
- 完整前端156文件/1555项通过，类型检查、Vite生产构建、相关Oxlint及diff检查通过。既有大chunk提示仍存在，不是本次新增失败。
- 日志 `qa066-terminal-20261120.log`、`qa066-full-20261120.log`、`qa066-typecheck-20261120.log`、`qa066-build-20261120.log` 位于上述test-results目录。

## 最终原生复查与清理

0.1.43 Windows custom-protocol构建通过。最终程序为 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-terminal-paste-0143-20261120.exe`，SHA256 `A42EB1DD9C0FA40C65393F581184B6336851C4FAA38581D90BAA7C4D9CCB8FD9`。日志为 `qa066-native-build-0143-20261120.log`。

在隔离仓库tree-actions-20261120观察到：首次终端先显示启动中省略号，随后就绪并出现正确目录的PowerShell提示符；新建第二个终端、切回第一个、隐藏再恢复面板时两会话保留；右键菜单无选区时复制禁用，Escape关闭菜单；关闭第一个会话后自动选中仍在运行的第二个会话。没有在GUI中输入或执行shell命令，没有触发剪贴板权限请求。

这只是原生会话/菜单/启动状态复查。延迟剪贴板竞态、粘贴等待图标、防重、失败重试仍以受控自动回归为证据，没有称为原生实测。Computer Use技能要求先读其guidance，其中明确“Do not run Windows terminal commands via UI automation directly or indirectly.”；因此QA-007的GUI Ctrl+C/命令粘贴验收保留，QA-046其他平台/系统关闭边界也未扩大声明。

证据目录 `E:/IDEAproject/gitx/test-results/qa066-native-20261120/` 保存程序身份、终端状态文本、进程和fixture核对。窗口退出后12个观测PID/创建时间身份（含两shell及ConPTY宿主）均已消失。五个测试文件哈希、HEAD、index tree和status全部保持；共享设置仅最近项目列表发生已知测试变动，核对后恢复启动时备份的精确哈希。用户安装版没有替换。

提交前再次fetch成功，master仍为e5c6b76且已包含；远端交付分支已删除，将按持续交付授权推送恢复同名分支，不修改master。提交和推送结果随后追加。
