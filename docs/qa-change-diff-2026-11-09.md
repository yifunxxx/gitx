# 变更列表中仅暂存文件的 Diff

日期：2026-11-09。

## 问题和修改

在默认变更列表模式中点击已暂存的新文件，原入口比较 index 与 worktree，结果显示
“无差异”，隐藏了待提交的内容。右键“显示 Diff”和 Ctrl+D 使用相同的错误选择方式。

三个入口现在使用共享逻辑：若当前变更列表中的目标文件仅有暂存修改，则比较
HEAD 与 index；若还有未暂存修改，则继续比较 index 与 worktree，保留逐行暂存的
原有语义。明确的 Staged/Unstaged 分区仍按用户选中的层比较。其他文件的未暂存修改
不会影响目标文件的选择。

## 验证

- 新增组件与动作入口回归：原先 12 项失败、18 项通过；修复后 30 项全部通过。
  覆盖列表事件、右键菜单、快捷键动作，暂存新增/修改/删除/重命名、混合修改、
  明确分区及未跟踪文件等。证据：change-diff-selection-before.log、
  change-diff-selection-after.log。
- 集成前端全量 48 文件、289 项通过；独立提交工作区的新 30 项回归也通过。
  两个工作区类型检查和生产构建均通过，针对本次文件的 oxlint 退出 0。
  既有 JavaScript 主 chunk 体积提示保留。
- 桌面点击 staged-only added.txt 后，实际显示“HEAD → 已暂存”及 staged addition，
  不再显示不适用的“暂存所选行”。右键入口实际切回同一正确视图，Ctrl+D 后维持正确内容。
- 专用 fixture 的 README.md 同时具有两层修改，桌面正确显示“已暂存 → 本地”，
  左右文本分别为 staged README 与 unstaged README，保留逐行暂存按钮。
- 独立 Git 核对 HEAD、所有 refs、index、status 和工作区文件哈希 5 项全部保持
  （change-diff-gui-verified.json）。fixture 的混合状态由测试准备脚本建立，未通过
  本次只读查看流程改变文件。

本次修复的是比较层的选择。重命名的源路径内容匹配不属于本次回归所证明的范围。
桌面文本证据位于 change-diff-staged-after-ui.txt、change-diff-mixed-after-ui.txt、
change-diff-context-after-ui.txt 和 change-diff-shortcut-after-ui.txt。
