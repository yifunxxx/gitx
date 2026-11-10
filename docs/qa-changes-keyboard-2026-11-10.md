# Changes 文件树键盘交互

日期：2026-11-10。台账 QA-002。

## 发现与修改

原文件树仅处理 F4，不能用方向键导航、折叠目录、分页或连续选择；每个文件行、箭头和复选框分别进入 Tab 顺序。8 个初始组件回归在旧实现全部失败。

现在树只有一个 Tab 入口，活动行使用稳定的分区/路径身份。上下键、Home/End、PageUp/PageDown 定位并滚动；左右键进入子项、折叠或返回父项；Enter 打开 Diff 或展开/折叠，F4 打开文件，Shift+F10 / 菜单键请求当前文件菜单。IME 与不匹配的修饰键不执行命令，导航允许长按，菜单、勾选和打开禁止重复键触发。

Shift+上下键与 Shift+点击连续选择限定在当前分区，跨分区重新设定锚点；Ctrl/Meta+方向键仅移动活动行，Ctrl/Meta+空格切换该文件的选择。普通导航和单击延续即时 Diff；多选不反复打开 Diff。变更列表模式下空格切换提交勾选，暂存模式下只切换选择，不操作 Git 索引。

目录与分区均可折叠。构建和排序目录树只随文件数据变化，展开、滚动和选择不重复排序；行与控件仍按视口渲染。`VirtualList` 提供可见区查询和可选滚动区 Tab 设置；滚动卸载活动行时不引用不存在的无障碍节点，键盘导航会重新显示目标。

刷新插入文件保留活动身份，删除活动文件后选择相邻位置，仓库或模式切换清理展开与连选锚点。核查过程中另修正了首次挂载时部分勾选复选框没有设置原生 `indeterminate` 属性的问题，组件回归覆盖初次半选显示。

原生复查又发现树行的无障碍名称混入内部按钮/复选框名称，形成重复文件名；增加明确的行名称，最终构建的 Windows 无障碍树已确认名称不重复。

## 自动验证

- 新增 11 项真实树/Pinia/虚拟列表组件测试，覆盖导航、分区和目录、Shift 连选、Ctrl 导航、菜单键、嵌套复选框、半选、IME、5,000 文件分页、卸载活动行、插入/删除和仓库切换。
- 原有 14 项鼠标选择、上下文目标与 F4 回归保留，改为通过树的活动项派发快捷键；VirtualList 5 项回归通过。
- 独立分支完整前端 68 文件 / 520 测试、集成目录 92 文件 / 682 测试通过，两处有重叠，不能相加。
- 最后增加明确行名称后，独立分支定向 30 项（11 项键盘、14 项原交互、5 项 VirtualList）通过；两处最终类型检查和生产构建通过。变更文件 Oxlint、`git diff --check` 通过。
- 集成目录最终 `cargo build -p gitx --locked --features tauri/custom-protocol` 通过，独立目标目录构建。完整测试在最后名称补丁前执行，末轮定向测试与构建覆盖最终代码。
- 日志在集成目录 `test-results/changes-keyboard-{main-tests,integration-tests,final-focused,main-build,integration-build,final-native-build}.log`。既有 Vite 分块大小提示仍存在，本轮没有将其计为新的功能缺陷。

## 原生验证与交付

独立测试仓库 `E:/IDEAproject/gitx/test-results/repos/changes-keyboard-gui-20261110`，包含 83 个同时有暂存/未暂存修改的文件、嵌套目录、未跟踪和忽略文件。操作前状态、索引和文件哈希快照保存在 `test-results/changes-keyboard-gui-before.json`。

最终测试程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-changes-keyboard-final-20261110.exe`；SHA256：`397A264C85D269CC55A527B8C70883AA3308C9DEC9D6F49D5F8F38420767DAE6`。

最终构建在 Windows 原生界面确认：

- 单击文件打开正确 Diff；PageDown 从 file-000 定位到 file-013 并滚入视口，End 到未跟踪文件，Home 返回首个分区。
- 右方向键进入目录，左方向键折叠、右方向键重新展开；Shift+Down 连选两行，Diff 保留原文件。
- Shift+F10 在当前文件行下打开菜单；Esc 关闭后活动行恢复。Tab 从树直接到 Amend，Shift+Tab 回到活动行。
- 切换暂存模式后，同一路径在 Staged 显示 HEAD → 已暂存，在 Unstaged 显示已暂存 → 本地；空格取消选择，没有执行暂存。
- 最终无障碍树中的分区、目录和文件行名称不再重复。此前构建已确认 Ctrl+Down 仅移动活动行，空格勾选当前文件及分区半选显示。

已恢复原有变更列表模式与深色主题；本轮两个键盘测试窗口均正常关闭。再次比较操作前快照，Git 状态、索引条目及 86 个文件的 SHA256 全部一致。

菜单关闭与焦点恢复使用集成目录已有菜单处理，不能据此认定独立分支通用菜单 QA-003 已完成；菜单目标生命周期 QA-004 也仍单独待办。5,000 文件的渲染量验证属于组件测试，本轮没有将其写成原生帧时间测量。

本功能已单独提交 `648848e` 并推送至 `codex/checkout-target-safety`，`ls-remote` 确认远端为完整提交 `648848e2f5890a86efb7256f4074bc192068b1be`；只同步相关改动至集成目录。原安装版 `D:/gitx/gitx.exe` 未替换。
