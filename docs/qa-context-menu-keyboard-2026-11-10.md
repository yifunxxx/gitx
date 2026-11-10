# 通用菜单键盘与焦点

日期：2026-11-10。台账 QA-003。

## 发现

独立分支 `ContextMenuSurface` 只有鼠标关闭和位置计算，Changes、Log、分支等菜单缺少统一的键盘导航与焦点恢复。VCS 主菜单还有独立容器。集成目录已有一版全局捕获 keydown 的处理，但不校验修饰键、IME 或按键来自哪一层，输入框和其他弹层也会受到影响；全禁用菜单没有焦点，卸载时只移除监听，没有恢复来源。

12 项初始回归在两处旧实现分别有 9 项失败。这些失败包含缺失的行为与新增约定，并不等于 9 个独立缺陷。

## 修改

- 将键盘处理限定在当前菜单面板内，取消全局捕获。上下键循环跳过禁用/隐藏项，Home/End 定位首尾；Escape、Tab、Shift+Tab 关闭并返回来源。
- Enter/空格激活当前项，屏蔽重复和带修饰键的激活；修饰导航和 IME 不执行普通菜单命令。菜单内的其他按键不泄漏到全局 Git 快捷键，编辑控件和嵌套弹窗保留自身的按键处理。
- 统一菜单角色、菜单项角色、标签、键盘焦点样式和鼠标指向时的焦点。全禁用菜单仍可聚焦关闭；项目动态禁用、隐藏或移除时恢复到可用项。
- 关闭/卸载时回收观察器；异步挂载通过代次校验，避免关闭后再次抢焦点。焦点已经转移到其他输入或弹窗时不强行恢复。
- 激活命令前恢复来源，使随后弹出的对话框记住原始控件，避免记录即将移除的菜单项。
- 收敛 Stash、Shelf、终端的重复菜单键盘处理，保留各自的仓库/会话目标校验和行定位。移除全局 Changes 菜单宿主重复 Escape 监听。
- VCS 主菜单复用集成目录的统一容器和可见/禁用状态处理；原 Reka 编辑器标签菜单不改动。
- 首轮原生检查发现 Ctrl+Home 虽不移动活动菜单项，浏览器默认行为仍会把长菜单滚到顶部，使活动项不可见；已拦截这类修饰导航的默认滚动，并补充回归断言。

## 自动验证

- 通用组件 14 项测试，覆盖首尾/循环导航、禁用/隐藏/动态项、两种关闭键、修饰键和 IME、重复激活、外部输入/嵌套弹窗隔离、卸载竞态，以及命令打开对话框后返回原始控件。
- VCS 主菜单 2 项测试覆盖无仓库时跳过不可用命令、键盘激活、仓库命令可用及 Escape 不执行动作。
- 已有 Stash/Shelf/终端/分支交互定向回归通过；集成目录已有菜单/对话框交互回归也通过。
- 完整前端：独立分支 70 文件 / 536 测试，集成目录 94 文件 / 698 测试通过；两处有重叠，不能相加。
- 上述完整回归在最后的修饰导航默认滚动补丁之前完成；补丁后 16 项菜单定向测试、两处类型检查和生产构建、集成目录原生构建全部通过。变更文件 Oxlint 与 `git diff --check` 通过。Vite 既有分块大小提示仍存在。
- 日志在集成目录 `test-results/menu-keyboard-{baseline-main,baseline-integration,focused,integration-focused,final-focused,main-tests,integration-tests,main-build,integration-build,native-build,main-final-build,integration-final-build,final-native-build}.log`。

## 原生验证和交付

首轮程序 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-menu-keyboard-20261110.exe` 验证了无仓库时的禁用命令、菜单首项焦点、End 导航；Enter 打开设置后搜索框聚焦，Escape 关闭设置并恢复 VCS 工具栏焦点。Changes 文件菜单的 Down/空格打开文件正确展示 base/staged/working 内容；Log 菜单 End 定位末项，Tab 关闭后返回提交行。此轮还复现了 Ctrl+Home 的浏览器默认滚动问题，随后修复。

最终程序 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-menu-keyboard-final-20261110.exe` 的 SHA256 为 `607A91B503944F4A15F8B2188134766B64A68E1EC8824FD492E053F97242269F`。原生复查确认：End 后 Ctrl+Home 保持活动“设置”命令及滚动位置；Up 跳过两个连续禁用项；Shift+Tab 返回 VCS 工具栏；浅色主题的文字、禁用态和焦点轮廓可辨，Escape 关闭正常。检查后恢复深色主题，两次测试程序均已关闭。

测试仓库 `E:/IDEAproject/gitx/test-results/repos/changes-keyboard-gui-20261110` 的前后快照为 `test-results/menu-keyboard-gui-{before,after}.json`；状态、索引和 86 个文件的内容哈希差异均为 0。GUI 检查没有执行 Git 写操作。

QA-003 已完成代码、自动回归与原生复查，功能提交/推送待本轮落库后补记。原安装版 `D:/gitx/gitx.exe` 未替换。菜单目标随仓库切换失效的问题仍按 QA-004 单独处理；本轮菜单主题抽查不等于 QA-009 的全部控件核查完成。
