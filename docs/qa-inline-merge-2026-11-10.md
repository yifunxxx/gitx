# 行旁冲突合并操作

日期：2026-11-10。台账 QA-012、QA-013。

## 发现与修改

用户要求在冲突代码旁使用箭头采用内容、X 忽略一侧。原界面将操作放在底部列表，不能直观看到操作所对应的代码。独立分支还会用全部块重建结果，覆盖其他位置的手动编辑；集成版本已有部分替换保护，但缺少每侧决定和完整的撤销状态。

现在源文件两侧的冲突行旁有朝向中间的箭头与 X。中间初始显示共同基准，非冲突更改自动合入；采用一侧替换此块，继续采用另一侧按点击顺序合并；忽略两侧保留基准。所有未决定的侧处理后才允许保存。按钮仅修改内存草稿，显式保存才写工作树并标记解决。

使用 CodeMirror StateField 映射块位置，单块操作只替换对应区间。手动修改过的块停用覆盖按钮，用户可明确保留该块；手动编辑、按钮操作、决定状态和行结束符共同撤销/重做。切换标签后保留草稿和撤销历史，卸载时剥离界面回调并销毁视图。全部采用是一笔事务，避免 5,000 次整文档序列化；源码和结果的行与按钮保持视口渲染。

同时提取集成目录已有的 merge3 精确源行重建：保留 CRLF、空白行和无末尾换行；合并不同起点的重叠修改；同步简单冲突自动保存的拼接方式。未整文件覆盖集成目录不同的 store 或 Rust 文件。

原生复查继续发现两处本功能的问题并修正：CodeMirror 默认隐藏行号栏，连带隐藏了新加入的交互按钮，现仅向无障碍树公开按钮所在栏，保留装饰行号的隐藏；Windows 默认重做为 Ctrl+Y，与工具栏的 Ctrl+Shift+Z 提示不一致，现显式支持 Ctrl+Shift+Z 并保留 Ctrl+Y。新增回归覆盖按钮可访问性和真实键盘事件的重做行为。

## 验证

- 定向 19 项通过：行旁按钮、单侧/双侧/忽略、相同内容冲突、插入/删除/空基准、其他位置手改、块内手改保护、CRLF/空行/EOF、撤销/重做、保存拒绝/重复/失败/仓库切换、标签切换和视图销毁、F7 导航与 5,000 块。
- gitx-diff 27 项通过；包括 196 组左右输入组合精确重建与不同起点重叠更改。
- 完整前端回归：独立分支 67 文件 / 508 测试，集成目录 91 文件 / 670 测试。两处有重叠，不能相加；这是末轮无障碍、打开竞态与重做快捷键补丁之前的完整回归。
- 末轮增量验证：独立分支 Viewer / save 的 11 项通过；集成目录 Viewer / model / store 的 19 项通过，包含 A→B→A 打开竞态。重做快捷键补丁后两处 Viewer 5 项再次通过。末轮两处类型检查与生产构建通过，变更文件 Oxlint、`git diff --check` 通过。
- `cargo check -p gitx-git --locked` 在独立分支通过；集成目录原生构建通过。

### 原生界面

使用独立仓库 `E:/IDEAproject/gitx/test-results/repos/inline-merge-gui-20261110`，文件含两处内容冲突、CRLF 且无末尾换行。

- 首轮程序验证行旁箭头方向、采用左侧、忽略右侧、F7 定位，以及第二块先右后左合并顺序。Ctrl+Z 恢复内容和待处理状态；工具栏重做恢复双侧内容。
- 手动在第二块加入 `manual-` 后显示覆盖保护提示、保存停用；点击“保留此块的手动结果”后保存恢复可用。
- 最终程序确认全部 8 个行旁按钮从初次显示即有独立无障碍名称。Shift+Tab 可见焦点框依次定位 X 与箭头，Enter 采用第二块；Ctrl+Z / Ctrl+Shift+Z 均恢复文本和决定状态。
- 最终程序复核鼠标 X 忽略、先左后右组合、剩余数 2→1→0 与保存禁用状态。深色和浅色下三栏、行号、高亮及禁用态可见，完成后恢复深色。
- 所有 GUI 操作仅修改内存草稿，未点击保存。验证结束后 Git 状态、三阶段索引条目及文件 SHA256 与操作前相同。保存成功/失败、重复保存与过期请求由 store 回归覆盖；不把它们写成 GUI 保存实测。

原始日志位于 `E:/IDEAproject/gitx/test-results/`：`merge-inline-main-tests.log`、`merge-inline-integration-tests.log`、`merge-inline-final-focused.log`、`merge-inline-final-integration-focused.log`、`merge-inline-redo.log`、`merge-inline-final-integration-redo.log`、两份 `merge-inline-final-*-build.log`、`merge-inline-rust.log`、`merge-inline-git-check.log`、`merge-inline-redo-native-build.log`。仓库前后快照为 `merge-inline-gui-before.json` / `merge-inline-gui-after.json`。

## 交付范围

目标分支 `codex/checkout-target-safety`；功能及相关文档单独提交推送，实际提交号与远端结果在回合交付中报告。集成目录只同步本功能相关改动。

最终原生 QA 程序为 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-inline-merge-redo-20261110.exe`，SHA256 为 `BCDA79872C8B4AE9563113A01542D8B07890E1801470978C6BC4A86FC412F142`。程序保留打开供复查，未做进程退出验收。安装版 `D:/gitx/gitx.exe` 未替换，因此不能把本次代码提交表述为安装版已升级。
