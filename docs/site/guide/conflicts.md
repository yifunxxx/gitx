# 合并、变基与冲突

## 选择操作方向

**Merge** 将目标分支合入当前分支；**Rebase** 将当前分支的一组提交重放到新基点；**Cherry-pick** 将选中的提交应用到当前分支。开始前确认活动仓库、当前分支及尚未保存的文件。

## Merge

1. 打开 VCS → **Merge**，或在分支菜单选择合入当前分支。
2. 检查窗口显示的当前分支，选中要合入的分支。
3. 按项目约定配置选项，核对命令预览后执行。
4. 成功后查看 Log。若选择 squash/no-commit，检查 Changes 并自行提交；若出现冲突，继续下面流程。

| 选项 | 用途 |
| --- | --- |
| No fast-forward | 保留合并节点 |
| Fast-forward only | 只接受快进，分叉时停止 |
| Squash | 合并最终变更，随后形成一次普通提交 |
| No commit | 在需要合并提交时先停下供检查 |
| Custom message | 指定合并提交说明 |
| No verify | 跳过适用 hooks |
| Allow unrelated histories | 允许合并没有共同祖先的历史；仅在明确需要时开启 |

## Rebase

1. 打开 **Rebase**，填写 upstream，核对当前分支。
2. 需要搬迁到另一基点时启用 **onto**；需要先切分支时选择对应分支。
3. 按需设置 rebase-merges、keep-empty、root、update-refs、autosquash。它们分别涉及合并拓扑、空提交、根历史、相关引用和 fixup/squash 自动整理，应根据预览选择。
4. 普通变基直接执行；Interactive 会进入计划编辑器，见[历史整理](./rewrite)。

变基暂停可能是冲突，也可能是计划中的 edit。解决后使用 **Continue**；**Skip** 会跳过当前正在重放的提交；**Abort** 中止操作。不要把 Skip 当作“暂时稍后处理”。

## Cherry-pick

在 Log 选择一个或多个所需提交，执行 **Cherry-pick**。它把这些变更应用到当前分支，并可能产生新的提交 ID。冲突时按同样流程解决，再 **Continue Cherry-pick**；不需要继续时 **Abort Cherry-pick**。受保护来源的提交可按设置附加原提交标识说明。

## 本地修改与 Smart 操作

工作区不干净时可能弹出 **Smart Merge / Smart Rebase** 提示。确认后软件先保存本地修改，再进行操作，并在操作完成后恢复指定的保存记录。普通操作暂停、Squash 或待提交阶段可能延迟恢复。

如提示恢复失败，先检查 Stash/Shelf、冲突列表和状态横幅，保留对应保存记录。不要连续 Pop 不明的旧 Stash 来“补救”。软件显示的“完成合并”和“本地修改已恢复”是两个需要分别确认的结果。

## 逐文件解决冲突

1. 点击状态横幅或执行 **Resolve Conflicts**，查看冲突文件列表。
2. 选中一个文本文件，打开 **Merge** 编辑器。
3. 左右两侧是来源，中间是可编辑结果。先阅读每侧显示的分支/提交标签；Rebase 时 Yours/Theirs 的角色可能与直觉不同。
4. 对每个冲突块，用行旁箭头**采用该侧**，用 X **忽略该侧**。两侧独立决定；需要两侧内容时按希望的顺序采用，再检查结果。
5. 中间可手动编辑。已有手动结果时，新的自动选择可能要求确认；可保留手动结果。
6. 使用上一处/下一处按钮或 `Shift+F7` / `F7` 导航；Undo/Redo 可撤销编辑或选择。
7. 检查剩余块计数和完整结果，点击 **Save and mark resolved**。
8. 回到冲突列表确认所有文件已解决，然后继续 Merge、Rebase 或 Cherry-pick。

![原生三栏冲突编辑器](/screenshots/conflicts-en.png)

**Accept Yours / Accept Theirs** 在文件列表中通常是整文件选择，只有确定要整侧内容时使用。二进制、删除/修改冲突需要按文件级策略处理，不能依赖文本块合并。

关闭尚未应用的合并标签会要求确认。中间结果未保存为已解决前，不能仅凭“看起来正常”就继续整个操作。
