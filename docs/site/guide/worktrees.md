# Worktree、多仓库与子模块

## 用 Worktree 同时处理多个分支

Worktree 让一个 Git 仓库共享对象和引用，同时拥有多个独立工作目录。适合保留开发现场，另开目录修复问题或审查代码。

1. 通过 Find Action 打开 **Show Worktrees**，或直接执行 **New Worktree**。
2. 填写起点，例如 `HEAD`、`main`、`origin/feature/search` 或提交 SHA。
3. 需要新分支时输入分支名；按需要启用 Track。
4. 核对建议目录，也可以浏览或填写其他目录；避免覆盖已有工作目录。
5. 选择是否创建后打开，确认执行，在 Worktrees 列表检查路径、分支和 HEAD。

同一本地分支通常不能同时被两个 Worktree 检出。遇到“already checked out”时选择新分支或已有 Worktree。

## 管理现有 Worktree

| 命令 | 作用 |
| --- | --- |
| Open Here | 在当前窗口打开所选工作目录 |
| Lock / Unlock | 用原因锁定或解锁记录，避免被清理 |
| Remove | 移除所选工作目录；核对路径和未提交内容，当前/主/锁定项有保护 |
| Prune | 清理失效的管理记录；不是“删除所有分支” |
| Refresh | 重新读取列表 |

删除前先保存或提交该目录内的工作，阅读确认框。操作失败可能表示目录有修改、被占用或记录状态改变。

## 打开远程 Ref 或 PR Head

执行 **Open Ref in Worktree**，选择 remote，输入 refspec 或 PR 编号，填写审查名和目录。纯数字如 `123` 按 GitHub 的 `refs/pull/123/head` 解释；其他服务可填写服务器支持的完整 ref，例如 `refs/merge-requests/123/head`。

完成后检查新目录与分支/HEAD。这个功能获取 Git 引用，不提供评论、批准 Review 或合并 PR 的平台界面。

## 一个工作区包含多个仓库

打开包含多个已识别仓库的父文件夹，使用仓库选择器切换活动 root。File 继续显示整个工作区树，文件归属标记指向最深的匹配仓库；Commit/Log 则跟随活动仓库。

属于其他仓库的文件可作为磁盘文本查看；要使用它的 Git Diff/History，先切换活动仓库。有未保存草稿时切换可能被阻止，先处理草稿。

**Execute branch operations on all roots** 会影响多仓库分支操作，尤其是检出。启用后不要假设只操作当前 root；检查各仓库的结果和失败/回滚提示。仅想操作当前仓库时先关闭这一选项。多仓库操作可能部分完成，应逐个核对，而不是只看当前分支标签。

## 更新已有子模块

通过 Find Action 执行 **Update Submodules**，等待任务结束，查看更新、跳过和失败数量及具体路径。Update Project 也可能按既有策略更新相关子模块。

子模块是父仓库记录的独立 Git 提交。进入子模块更改后，需要在子模块提交，再在父仓库提交指针更新；不要把父仓库的一次 Commit 当作自动提交全部子模块。

当前文档覆盖已有子模块的更新。图形化添加/注册新子模块、递归克隆的专门向导不在当前界面中；需要时使用 Git 工具并回到 gitx 刷新。
