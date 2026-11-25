# 设置、主题与更新

按 `Ctrl+,` 或顶部齿轮打开 Settings。左侧选择页面，顶部可按名称、关键词搜索。**Apply** 保存但不关闭，**OK** 保存并关闭，**Cancel** 放弃尚未应用的修改；外观预览不等于已保存。

![中文外观设置](/screenshots/settings-zh.jpg)

## 外观与项目文件

<!-- settings: theme locale cornerStyle palette showIgnoredInFileTree showHiddenInFileTree compactFileTree -->

| 设置 | 说明 |
| --- | --- |
| Theme / 主题 | System、Light、Dark，以及随系统/浅色/深色的 Liquid Glass；选择后预览并保存 |
| Language / 语言 | English / 简体中文；与文档网站的语言独立 |
| Corner style / 圆角 | Small、Large、None，改变界面圆角 |
| Palette / 配色 | Pearl、Graphite，选择基础配色 |
| Show ignored in File | 是否在 File 树及相关搜索中包含忽略文件 |
| Show hidden in File | 是否显示隐藏文件；不等同于显示 Git 元数据 |
| Compact directories | 合并已加载的单子目录链，不主动展开整个仓库 |

File 的显示规则和 Commit 的忽略文件规则分别保存。

## Version Control · Git

<!-- settings: gitExecutable stagingMode showIgnored updateMethod cleanTree combineStashShelf autoFetch protectedBranches useCredentialHelper executeBranchOpsAllRoots showOptionsBeforeUpdate fetchOnAddRemote cherryPickSuffix allowPerHunk forkParent commitTwMode logIndexing logListMode changesListMode logChangedFilesListMode -->

| 设置 | 怎么用 |
| --- | --- |
| Git executable | 选择系统 `git.exe`，点 Test 检查版本，再 Apply；测试成功不是已经保存路径 |
| Staging mode | 开启传统暂存区模式；关闭使用 Changelist，详见[提交](./commit) |
| Show ignored files | 在 Commit 面板显示忽略项，不改变 `.gitignore` 规则 |
| Update method | Merge / Rebase / Reset 的默认更新策略；Reset 会移除远端没有的本地提交 |
| Clean working tree using | 更新时保存本地修改使用 Stash 或 Shelve |
| Combine Stashes and Shelves | 合并或分开显示底部两类保存记录 |
| Auto-fetch interval | 0 表示关闭；1–1440 分钟定时 Fetch 当前仓库的所有远端。隐藏窗口、离线或有运行中任务时延后；后台认证失败仅提示手动 Fetch |
| Protected branches | main/master 等名称或模式，用于限制强推等适用操作；不替代远程服务器保护 |
| Use credential helper | 启用 Git 凭据助手；记住凭据失败时按提示处理，不代表凭据已经保存 |
| Execute branch operations on all roots | 多仓库分支操作的范围开关，尤其影响检出；执行后逐个检查 root |
| Show options before update | 是否在更新项目前显示策略选择框 |
| Fetch after adding a remote | 新建 Remote 后是否立即 Fetch |
| Cherry-pick suffix on protected sources | 适用时在说明中附上 cherry-pick 来源提交 |
| Allow per-hunk changelists | 当前存在的偏好项；本版本尚无按块分配 Changelist 的可操作 UI，请使用文件分组或按行暂存 |
| Fork parent remote name | Sync Fork 使用的父仓库 remote，默认 upstream |
| Commit tool window mode | Docked / Window / Float，参见[布局](./workspace) |
| Enable Log indexing | 控制日志索引相关能力；需要时在 Log 重建索引 |
| Log list mode | 平铺时间列表或分支树 |
| Changes list mode | Commit 文件列表树形/平铺 |
| Log changed files list mode | Log 详情文件列表树形/平铺 |

## Confirmation & Display

<!-- settings: closeCommitTw commitControlsHidden groupBranches showRecentBranches showTags showUpdateInfo -->

| 设置 | 影响 |
| --- | --- |
| Close Commit tool window after commit | 提交成功后收起 Commit 工具窗 |
| Hide commit controls | 隐藏说明区；Ctrl+K 或 Toggle Commit Controls 再显示 |
| Group branches by directory | 按 `/` 分组分支名称 |
| Show recent branches | 显示最近使用的分支 |
| Show tags | 在适用分支/日志界面显示标签 |
| Show Update Info | 更新后显示更新信息 |

## Keymap：自定义快捷键

1. 打开 Keymap，搜索动作。
2. 点 **Rebind** 并按下组合键，查看记录结果；冲突或系统保留键会有提示。
3. **Remove** 清除此动作的绑定，**Reset** 恢复该动作默认；**Reset All** 恢复全部默认。
4. 点击 Apply/OK 保存。取消只丢弃尚未应用的草稿。

**Find Action** 和终端切换有固定保留组合；不要尝试将系统关闭/安全组合重新分配。动作是否执行还取决于当前仓库与选择上下文。默认列表见[快捷键](./shortcuts)。

## About & Updates

显示当前版本、已查询到的最新版本、检查按钮、更新中心和下载页入口。顶部 Update 徽标也可打开更新中心，查看发行说明、进度与状态。

桌面版启动后约 8 秒会静默检查，此后约每 24 小时检查；发现可用新版本时可能开始后台下载。**已下载并不表示已安装**：准备好后需要使用重启更新入口，并完成安装流程。先保存编辑、检查运行任务，再更新。

可从更新中心取消下载、稍后处理或忽略该版本；网络/下载失败时看错误后重试，或打开 Releases 下载页。应用内检查依赖 GitHub 可达性，检查失败不能证明已经是最新版。
