# Diff 与合并编辑器主题复查

日期：2026-11-11。QA-009 的一轮修复；总体界面审计与六项目标仍在进行。

## 发现与修改

- 独立分支普通 Diff 和 Combined Diff 共用 `CodeMirrorDiff`，未设置编辑器、行号栏和选区主题，深色下继承亮色行号栏。现在背景、前景、行号、边框和选区使用应用主题变量。切换主题只更新 CSS，不销毁或重建编辑器。
- 集成目录此前已有另一套行号栏修复。本轮只同步相关主题块和文案，统一两处行为；没有覆盖集成目录其他修改。原内容备份及本轮差异保存在 `test-results/diff-theme-sync/` 和 `diff-theme-integration-feature.diff`。
- 检查中发现 `MergeTextPane` 将 `--diff-conflict-bg` 的 RGB 三元组直接作为 `backgroundColor` 使用，CSS 无效；已采用状态引用不存在的 `--diff-added-bg`，一直使用固定回退色。现在以 `rgb(...)` 读取现有冲突/插入背景，侧边标记和按钮使用 warning/success/info 主题色；同时设置编辑器前景和选区颜色。
- 仓库操作状态中的 `conflictCount` 来自未合并路径数，自动解决返回成功保存的文件数，合并编辑器中的 remaining 来自待处理块数。中英文文案分别改为冲突文件、冲突块、自动解决的文件，避免同一个数量单位混用。Git 处理逻辑未改变。

## 自动验证

- 独立分支首轮完整前端回归：93 文件 / 829 项通过；最终合并主题修改后，Diff 阅读状态、虚拟化、MergeViewer、RepoStateBanner 定向 4 文件 / 19 项通过。
- 集成目录完整前端回归：110 文件 / 949 项通过。两个目录覆盖重叠，数量不相加。
- 两处生产构建（含类型检查）、变更组件 Oxlint、独立分支原生 custom-protocol 构建及 diff 检查通过。既有 Vite 大分块提示保留。
- 共享主题变量静态诊断 358 组通过，覆盖正文/辅助文字/状态文字、VCS 文字、Log 线条和焦点色在普通、悬停、选择及侧栏表面上的组合。这不是全部控件的无障碍认证。
- 原生读取的待处理、已采用和手动块文字/背景对比度最低 6.042:1。忽略内容和禁用按钮保留淡化表现，未将它们算入该最低值。
- 本轮为样式和数量单位修正，没有添加仅断言 CSS 实现的测试；通过真实编辑器回归和原生计算样式验证。

日志位于 `E:/IDEAproject/gitx/test-results/`：`diff-theme-main-tests.log`、`diff-theme-main-final-tests.log`、`diff-theme-integration-tests.log`、两处 `diff-theme-*-build.log`、`diff-theme-native-build.log`、`diff-theme-token-audit.json`。

## 原生界面证据

测试程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-diff-theme-20261111.exe`。

SHA256：`808B8929DCA1BA28CE1EA4E6DBD614A307FD57E56883E1F50BAA45BDD352FED9`。

隔离仓库：`E:/IDEAproject/gitx/test-results/repos/diff-theme-gui-20261111`，包括两个冲突文件（每个两块）、180 行普通文件、一次本地追加和三个提交。

- 普通文件双击打开 Diff，展开未更改内容、滚动并选择 `Line 21: committed`。深→浅→深切换后两个编辑器 DOM 身份均未变化，scrollTop 保持 216，文本选区保持相同。
- 普通和 Combined Diff 行号栏/编辑器背景在深色为 `rgb(19, 20, 22)`，浅色为 `rgb(255, 255, 255)`；行号文字分别为 `rgb(185, 187, 193)`、`rgb(85, 85, 85)`。Combined 三个文件的编辑器在切换中也保持身份。
- 冲突列表浅色弹窗、勾选行及加载禁用态可见。仓库提示为“剩余 2 个冲突文件”；打开其中一个文件后，编辑器显示“剩余 2 个冲突块”。
- 点击第一块左箭头，再点击右侧 X：采用侧和结果变绿、忽略侧淡化，块数变为 1。深浅切换保留结果和编辑器身份。
- 在第二块结果中输入临时文字：出现手动编辑提示，块背景及蓝色侧边标记随主题更新。确认保留手动结果后，块数变为 0，保存启用，全部采用按钮禁用。此时仓库仍显示两个冲突文件，因为没有保存到 Git。
- 依次撤销确认、输入、忽略和采用，恢复原始编辑内容，关闭合并标签未弹出未保存确认。深色已恢复，测试应用已关闭。
- 前后快照验证 HEAD、refs、无可选锁的 status、索引字节哈希和三个工作文件哈希全部相同。没有执行保存/标记解决、中止合并、提交或暂存。

原生观察通过 Windows 输入完成；计算样式、DOM 身份、scrollTop 和选区通过本机测试 WebView 的只读诊断采集。证据为 `diff-theme-ordinary-*.json`、`diff-theme-combined-*.json`、`diff-theme-merge-*.json`、`diff-theme-evidence-verification.json`、`diff-theme-gui-before.json` / `diff-theme-gui-after.json`。截图只在工具会话观察，未另存截图文件。

## 边界与交付

本轮完成普通/Combined Diff、冲突列表与合并编辑器的相关主题和文案修复。检查了共享 Button、ContextMenuSurface、TextViewport、ConsoleView 和主题变量实现；原生覆盖本报告列出的界面状态。其他设置页、下拉控件、菜单和所有缩放/窗口尺寸组合尚未逐项复查，QA-009 不关闭。

没有重新进行后端回归（本轮未改后端），自动解决提示的单位依据后端代码确认，没有在 GUI 中执行自动解决。英文文案经过资源完整性测试和构建，未切换英文原生逐屏验证。

功能提交 `1f4a8ff1d584a845c064ad1374c3fd14688ab9ee` 已推送至 `origin/codex/checkout-target-safety`，并经 ls-remote 核对远端一致。用户安装版 `D:/gitx/gitx.exe` 未替换。总体台账仍有 5 项未关闭事项：QA-007、QA-008、QA-009、QA-010、QA-023。
