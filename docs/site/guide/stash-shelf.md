# Stash 与 Shelf

暂时切换任务、更新项目或清理工作区时，可先保存尚未提交的修改。

| 方式 | 更适合 | 存储与操作特点 |
| --- | --- | --- |
| Stash | 使用 Git 标准暂存记录，方便命令行互通 | Apply、Pop、Drop；可选择未跟踪文件和恢复索引 |
| Shelf | 按任务保存、预览和交换补丁 | 命名记录、文件展开、补丁预览/导出、最近删除恢复 |

二者都不是自动云备份。需要跨机器传递时使用补丁或其他备份方式。

## 创建 Stash

1. 通过 VCS → **Stash Changes** 或底部 Stashes & Shelves 的新建入口打开窗口。
2. 输入能识别任务的说明，核对文件勾选范围。
3. **Include untracked** 包含未跟踪文件；没有选中时新文件不会因此得到备份。
4. **Keep index** 保留暂存区状态，适合把其余工作暂时放下。
5. 确认后检查列表出现对应记录，并检查 Changes 中留下的内容。

![Stashes & Shelves 面板](/screenshots/stash-en.png)

## 恢复和清理 Stash

选中目标记录，核对说明和引用，再选择：

- **Apply**：应用变更并保留记录，适合首次尝试恢复。
- **Pop**：应用，成功后移除记录；若冲突或失败先检查结果，不要反复 Pop。
- **Reinstate index**：需要恢复原来的暂存状态时启用。
- **Drop**：删除选中的 Stash，不是“撤销它已经应用的修改”。
- **Clear**：清空全部 Stash，确认范围后再执行。

恢复发生冲突时去[冲突处理](./conflicts)，在确认文件正确之前保留相关保存记录。

## 创建 Shelf

1. 在 Changes 选择文件，执行 **Shelve Changes**。
2. 输入名称并核对文件选择。
3. 选择 **Keep changes** 可保存副本同时保留本地修改；未选择时保存后移除所选本地修改。
4. 到 Shelf 列表检查记录和文件。不要仅凭窗口关闭就认为保存完成。

默认 **Combine Stashes and Shelves** 将两类记录放在同一标签，可在 Settings 中拆开。

## 预览、Unshelve 与导出

展开 Shelf 查看文件，点击 **Preview** 阅读保存当时的统一补丁。预览内容来自保存记录，不是当前工作区的实时 Diff。

选中 Shelf 记录后 **Unshelve**，作用于该记录。展开的文件清单用于查看，当前界面没有逐文件勾选 Unshelve 的入口；要分批恢复，可在创建时把不同任务分成多个 Shelf。不勾选“Remove applied”时保留记录；勾选时按应用结果移除相应内容，遇到部分失败应继续检查剩余记录。恢复到已有修改的工作区时，系统可能创建保护备份并提示冲突/部分结果，按提示检查每个路径。

**Rename** 修改说明；**Export Patch** 导出保存的补丁。详情见[补丁](./patches)。

## 删除与恢复 Shelf

Delete 会把 Shelf 移到最近删除。启用 **Show deleted** 可选中记录进行 Preview 或 Restore；Restore 恢复的是 Shelf 记录，之后需要 Unshelve 才会应用到文件。

普通已删除记录有 **30 天**保留期，过期后可能清理；系统保护备份有额外保留规则。不要把最近删除列表当长期备份。Stash 的 Drop/Clear 与 Shelf 的最近删除机制不同。
