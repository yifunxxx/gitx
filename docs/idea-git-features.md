# IntelliJ IDEA 内置 Git UI — 功能清单（Feature Inventory）

> **用途**：为 gitx 产品对齐 IDEA 内置 Git 体验提供可追踪的功能盘点。  
> **范围**：IDEA 自带的 Git 工具体验（`git4idea` + 平台共享 VCS UI）；GitHub / GitLab 等托管集成在单独章节标明。  
> **不做**：首版切片优先级（除非来源中已明显分层）。  
> **来源**：JetBrains Help（[Using Git integration](https://www.jetbrains.com/help/idea/using-git-integration.html) 及链接页）、[`plugins/git4idea`](https://github.com/JetBrains/intellij-community/tree/master/plugins/git4idea)、平台 `platform/vcs-impl`（`VcsActions.xml`）、bundled `plugins/github`。  
> **图例**：`[平台共享]` = VCS 平台通用 UI（非 Git 专属，但 Git 复用）；`[Git 专属]` = git4idea；`[GitHub 插件]` = `org.jetbrains.plugins.github`（bundled，依赖 Git）；`[不确定]` = 文档/源码未完全确认。  
> **Action ID**：括号中的 `Git.*` / `Vcs.*` / `Github.*` 来自社区版源码注册名，便于追踪。

---

## 0. 总览：核心入口与共享边界

### 0.1 主要 UI 入口

| 入口 | 快捷键（Win/Linux；macOS 另见文档） | 说明 |
|------|--------------------------------|------|
| **Git Tool Window**（Log / Branches / Console / Worktrees 等） | `Alt+9` | Show Version Control / Git window |
| **Commit Tool Window** | `Alt+0` | 本地变更、changelists / staging、Shelf/Stash |
| **VCS Widget**（窗口标题栏当前分支名） | 点击 | 分支/标签操作中枢；显示 incoming/outgoing 计数 |
| **VCS Operations Popup** | `Alt+\`` | 可配置的 Git/VCS 速查菜单 |
| **Git 主菜单** | — | `Git | …`（启用 Git 后；未启用时常为 `VCS | …`） |
| **编辑器 gutter / 文件状态色** | — | 行级变更、Blame、按文件状态着色 |
| **Pull Requests Tool Window** | — | `[GitHub 插件]` |

### 0.2 平台共享 vs Git 专属（可区分处）

| 能力 | 归属 |
|------|------|
| Commit tool window、Changelists、Shelve、Patch、Diff Viewer、Merge 三栏、Update Project 对话框框架、文件状态色、Confirmation 设置、VCS Operations Popup 框架 | `[平台共享]`（`VcsActions.xml` 等） |
| Staging area、Fetch/Pull/Push 语义、Branch popup、Interactive rebase、Git Log 图、Stash（Git）、Remotes、Ignore（.gitignore）、Worktrees、GPG sign、Protected branches | `[Git 专属]`（`git4idea`） |
| Clone 对话框中的 GitHub/GitLab 账号仓库列表、Share on GitHub、PR 工具窗、Gist、Open on GitHub | `[GitHub 插件]`（或同类 hosting；GitLab 为独立插件） |

---

## 1. Setup / Clone / Init（仓库建立）

### 1.1 Clone 远程仓库
- **做什么**：检出（clone）远程仓库并可选创建项目。
- **UI**：`Git | Clone`；未启用 VCS 时 `VCS | Get from Version Control`；`File | New | Project from Version Control`；Welcome 屏 **Clone Repository**。
- **选项**：仓库 URL；左侧 hosting 服务（GitHub 等需登录后补全仓库列表）`[GitHub 等插件扩展 Clone 对话框]`；**Shallow clone**（截断历史到 N 个 commit）；克隆后是否打开项目；子模块一并克隆并注册为 roots。
- **相关**：`Git.Clone`；浅克隆后 `Git | Unshallow Repository`（`Git.Unshallow`）；项目安全 Trust/Safe Mode；多构建系统配置选择。

### 1.2 Enable Version Control Integration
- **做什么**：把现有项目关联为单个 Git 仓库。
- **UI**：`VCS | Enable Version Control Integration`；VCS Operations Popup → Enable Version Control Integration；`Start.Use.Vcs`。
- **选项**：选择 VCS 类型 = Git；之后可询问是否把项目设置文件加入 VCS（Always Add）。

### 1.3 Create Git Repository（多根）
- **做什么**：在项目内（或含项目根的目录）初始化独立 Git 仓库。
- **UI**：`VCS | Create Git Repository` / `Git.Init`；对话框选择目录。
- **变体**：可为不同子目录建多个仓库（multi-root）。

### 1.4 添加文件到 Git（Add）
- **做什么**：跟踪未版本化文件。
- **UI**：Commit tool window → Unversioned Files → **Add to VCS**（`Ctrl+Alt+A`）；Project 视图 / 编辑器上下文 `Git | Add`（`Git.Add`）。
- **选项**：忽略列表中的文件可 **force-add**；新建文件是否自动询问加入 → Settings | Version Control | Confirmation。

### 1.5 检测 / 配置 Git 可执行文件
- **做什么**：定位本机 `git`（含 WSL2）。
- **UI**：Settings | Version Control | **Git** → Path to Git executable + Test。
- **变体**：Windows 无 Git 时尝试 WSL；`\\wsl$` 打开的项目自动切 WSL Git。

### 1.6 Share project settings via VCS
- **做什么**：是否共享 `.idea` 等项目设置。`[平台共享 / IDEA 项目格式相关]`
- **UI**：启用 VCS 后的提示；文档另有 Share project settings 页。

---

## 2. Remotes（远程管理）

### 2.1 Manage Remotes
- **做什么**：添加 / 编辑 / 删除 remote（name + URL）。
- **UI**：`Git | Manage Remotes`（`Git.Configure.Remotes`）；Push 对话框中 **Define remote**；Branches pane 上 remote 的 Edit/Remove Remote。
- **选项**：添加时可选 **Fetch remote**。

### 2.2 默认 origin 与多 remote
- **做什么**：clone 后自动有 `origin`；可加第二 remote（fork 同步等）。
- **相关**：`Github.Sync.Fork` `[GitHub 插件]`。

### 2.3 远程凭据 / 密码策略
- **做什么**：pull/push 等授权时记住凭据。
- **UI**：Settings | Appearance & Behavior | System Settings | **Passwords**（Keychain / KeePass / 不保存）。
- **Git 设置**：Use credential helper（不覆盖系统 helper）。`[部分平台共享]`

---

## 3. Branches（分支）

入口：**VCS Widget**、Git tool window **Branches** pane、`Git | Branches`（`Git.Branches` / `Git.ShowBranches`）。

### 3.1 创建分支
- **从当前**：New Branch；可选 Checkout；前缀建议。
- **从选定分支**：New Branch from Selected。
- **从 commit**：Log 上下文 New Branch（`Git.CreateNewBranch` / `Git.CreateNewBranch.FromCommit` / `Git.New.Branch.In.Log`）。

### 3.2 Checkout / Switch
- **做什么**：切换本地分支；或从 remote checkout 出跟踪本地分支。
- **选项**：**Checkout and Update**；冲突时 **Force Checkout** vs **Smart Checkout**（shelve/stash 工作树，见 Git 设置 Clean working tree using）；多仓库按 repository 分组。
- **相关**：`Git.CheckoutRevision`；Checkout Group。

### 3.3 Rename / Favorite / Copy name
- Rename local branch（`Git.Rename.Local.Branch`）；可选 Unset upstream。
- Mark as favorite（星标 / Space）；主分支默认收藏。
- 悬停 `Ctrl+C` 复制分支名。

### 3.4 Grouping 与 Widget 展示
- 节点：Recent / Local / Remote / Tags；按目录 `/` 前缀分组。
- Widget Settings：Group by Directory、Show Recent Branches、Show Tags。
- Incoming（蓝）/ Outgoing（绿）计数。

### 3.5 Compare branches
- **Compare with Current**：在 Git tool window 新 tab 列出独有 commits；可 Swap Branches。
- **Show Diff with Working Tree**：与工作树文件级差异（灰/绿/蓝标记）。
- Log 中 `branch1..branch2` 双点范围过滤。
- Action：`Git.Ref.Compare.With`、`Git.Ref.Diff.With.Local`、`Git.CompareWithBranch`。

### 3.6 Delete branch
- 删除后通知可 restore；未合并 commits 链接；可删跟踪的 remote 分支。
- 批量清理：`Git.Cleanup.Branches`、`Git.FindMergedLocalBranches`。

### 3.7 Update selected branch
- 从 Branches 上下文 **Update**：按 Settings 中 Update method（merge/rebase）同步跟踪 remote。

### 3.8 Synchronous branch control（multi-root）
- Settings | Git → **Execute branch operations on all roots**；失败可回滚防分叉；diverged 警告。

### 3.9 Checkout 冲突处理策略
- Smart Checkout 使用 Shelve 或 Stash（设置项 Clean working tree using）。
- Restore workspace on branch switching（Confirmation）：打开文件 / Run Configuration / breakpoints。

---

## 4. Tags

### 4.1 创建 Tag
- Log 上下文 **New Tag**（轻量）；`Git | New Tag` 对话框可写 Message → annotated tag（`Git.CreateNewTag` / `Git.Tag`）。
- 可指定 commit（hash / 表达式）；Git Root 选择。

### 4.2 操作 Tag
- Jump to tagged commit；Checkout tagged commit；Reassign existing tag。
- Push tag：Tags 节点 **Push to origin**（`Git.Tag.Push`）；或 Push 对话框 **Push tags**（All / Current Branch）。
- Delete tag；Fetch tags 策略见 Settings（Auto / Sync prune / Always / Never）。

---

## 5. Worktrees（工作树）

### 5.1 Worktrees tab / 管理
- **UI**：Git tool window **Worktrees**；`Git | Worktrees`；`Git | New Worktree`；VCS Widget New Worktree（`Git.Show.WorkingTrees`、`Git.CreateNewWorkingTree`）。
- **创建选项**：Repository（多根时）；From branch（local/remote/tag）；不可同分支双检出 → 可选 New branch；Project name；Location（避免嵌套）。
- **其它**：Open / Remove / Refresh / Prune / Toggle Lock；**Open Review**（关联 PR/MR）；PR 上 **Open in Worktree** `[GitHub/GitLab]`。
- Actions：`Git.WorkingTrees.*`。

---

## 6. Local Changes / Changelists（本地变更）`[平台共享为主]`

### 6.1 Commit tool window 变更列表
- 默认 changelist **Changes**；**Unversioned Files**；可选显示 Ignored。
- 文件状态色：Modified / Added / Deleted / Renamed / Ignored / Conflict 等（Settings | File Status Colors）。
- 编辑器 gutter 变更标记；行级 Rollback / Show Diff；可选按 chunk 分配 changelist。

### 6.2 Changelist 操作
- New / Rename / Remove / Set active（`ChangesView.NewChangeList` 等）。
- Move to Another Changelist（`Alt+Shift+M`）；Allow putting changes within one file into different changelists。
- 空 changelist 失活时：Do nothing / Remove silently。
- 非活动 changelist 冲突对话框：Shelve / Move / Switch / Ignore（Settings | Changelists）。

### 6.3 Staging Area 模式 `[Git 专属开关]`
- Settings | Git → **Enable staging area**（`Git.Stage.Enable` / Disable）。
- Stage 文件/chunk/行；三栏 Diff（HEAD / Staged / Local）；Show Staged/Local；Stage All / Tracked；conflict Accept Yours/Theirs/Merge。
- Actions：`Git.Stage.*`、`Git.Show.Stage`、`Git.Commit.Stage`。

### 6.4 删除文件 / 停止跟踪
- 删除受控文件 → 进入 changelist，提交后才从仓库移除；Safe Delete。
- 误 Add 未提交：Rollback（勿勾选 Delete local copies of added files）。
- 已提交后停止跟踪：无单一官方动作；文档给出 workaround + `.gitignore`。

---

## 7. Commit（提交）

### 7.1 本地 Commit
- **UI**：Commit tool window；`Ctrl+K`；`CheckinProject`。
- **选项**：选文件/changelist；Unversioned 可一并 stage+commit；**Amend**（选目标本地 commit）；近期 commit message 历史；Author；Sign-off；Run Git hooks（可关）；Commit Checks（Reformat / Rearrange / Optimize imports / Cleanup / Copyright / malicious deps 等）`[部分为 IDE 语言能力]`；Advanced checks（Analyze / TODO / Run Configuration）；After Commit 部署上传 `[Deployment 插件]`。
- **Commit and Push**：`Ctrl+Alt+K`（`Git.Commit.And.Push.Executor`）。

### 7.2 Partial commit（按块/行）
- Diff 中勾选 chunk；Split Chunks and Include Selected Lines；Move Lines to Another Changelist。
- 编辑器 gutter：**Commit this change** / Amend。

### 7.3 Commit tool window 形态
- View Mode：Tool Window / Window / Float；Close after committing；Toggle commit controls；可降级为 Log 内 Local Changes tab（Advanced Settings）。
- Modal Commit Interface 插件（可选）。`[不确定是否默认捆绑]`

### 7.4 GPG 签名
- Settings | Git → Configure GPG Key；`gpg.agent.configuration`。

### 7.5 用户名提示
- 首次提交若无 `user.name`，IDE 提示配置。

---

## 8. Sync Remote（Fetch / Pull / Update / Push）

### 8.1 Fetch
- `Git | Fetch`（`Git.Fetch`）；VCS Widget 刷新；Branches popup Fetch；自动 Fetch（默认约 20 分钟，`git.update.incoming.info.time`）。
- Check remote for incoming changes → Widget 标记。

### 8.2 Pull
- `Git | Pull` 对话框：remote、branch、Modify options（`--rebase` / `--ff-only` / `--no-ff` / `--squash` / `--no-commit` / `--no-verify`）；多仓库选择（`Git.Pull`）。

### 8.3 Update Project
- `Git | Update Project` / `Ctrl+T`（`Vcs.UpdateProject`）`[平台动作 + Git 策略]`。
- 策略：Merge / Rebase / **Reset to the Remote Branch**；可记住并不再显示对话框（Confirmation | Show options before | Update）。
- 完成后 **Update Info** tab（可关自动打开）；子模块分支/detached 行为。
- Filter Update Project info by paths。

### 8.4 Push
- `Git | Push` / `Ctrl+Shift+K`；分支 Push；Log **Push All up to Here**（`Git.PushUpToCommit`）；**Push Selected Commits**。
- Push 对话框：多仓库勾选；改 remote/branch；Define remote；预览 commits/files；Push tags；**Push** vs **Force push**（`--force-with-lease`；受 Protected branches 限制）。
- Push Rejected：Merge/Rebase 更新；可记住；对应 Auto-update if push rejected。
- Show Push dialog for Commit and Push / only for protected branches。

---

## 9. Merge / Rebase / Cherry-pick

### 9.1 Merge
- Branches：**Merge \<branch\> into \<current\>**；或 `Git | Merge` 对话框（`Git.Merge`）。
- 选项：`--no-ff` / `--ff-only` / `--squash` / `-m` / `--no-commit` / `--no-verify` / `--allow-unrelated-histories`。
- 未提交冲突时 Smart merge（stash/shelve）；Abort / Merge Commit（`Git.Merge.Abort` / `Git.Merge.Commit`）；VCS Widget 进行中状态。

### 9.2 Rebase
- `Git | Rebase` 对话框（`Git.Rebase`）：onto、`--onto`、选另一 branch、`--interactive`、`--rebase-merges`、`--keep-empty`、`--root`、`--update-refs`、`--autosquash`。
- Branches 快捷：Checkout and Rebase onto…；Rebase current onto…；Pull into… Using Rebase。
- Abort / Continue / Skip（`Git.Rebase.Abort|Continue|Skip`）；Ongoing.Rebase.Actions。

### 9.3 Interactive Rebase
- Log：**Interactively Rebase from Here**（`Git.Interactive.Rebase`）。
- 动作：Pick / Stop to Edit / Reword / Squash / Fixup / Drop / 重排 / Reset。
- 限制：多父 commit、非当前分支、protected branch 上不可用。

### 9.4 Cherry-pick
- Log：**Cherry-pick**；可 Abort/Continue（`Git.CherryPick.*`）。
- Settings：对 protected 源 commit 加 `cherry-picked from <hash>` 后缀。
- Log 高亮 cherry-picked commits（`Git.Log.HighlightCherryPickedCommits`）。

### 9.5 Apply separate changes / files
- 从 commit 的 Changed Files 应用单个文件变更到当前分支（文档 Apply separate files / Get from Revision 相关）。
- `Git.InMemory.Extract.Selected.Changes`；Drop Selected Changes（`Git.Drop.Selected.Changes`）。

---

## 10. Conflicts（冲突解决）`[平台 Merge UI + Git 触发]`

### 10.1 Conflicts 对话框
- 触发：pull/merge/rebase/cherry-pick/unstash/apply patch。
- 每文件：Accept Yours / Accept Theirs / Resolve Manually；Resolve All Simple Conflicts。
- Commit 视图 Merge Conflicts 节点；Abort Merge；Resolve Conflicts（`Git.ResolveConflicts`）。
- Stage 模式对应：`Git.ChangesView.AcceptYours|AcceptTheirs|Merge`、`Git.Stage.Accept*`。

### 10.2 三栏 Merge 工具
- 左 local / 右 other / 中结果可编辑；Apply non-conflicting；Resolve simple；与 Base/Middle 比较；Revert conflict resolution；Accept and Finish。
- Settings | Tools | Diff & Merge：Automatically apply non-conflicting changes。

### 10.3 CRLF / LF
- Settings | Git：**Warn if CRLF…**；提交前 Line Separators Warning（Commit As Is / Fix and Commit）。

### 10.4 审查合并结果
- Log 中 merge commit → Changed Files → Diff（无冲突双栏父提交；有冲突三栏）。

---

## 11. History / Log / Annotate

### 11.1 Log tab（Git tool window）
- Panes：Branches / Commits / Changed Files / Commit Details。
- 搜索：`Ctrl+L`；Go to Hash/Branch/Tag（`Ctrl+F`）；过滤 branch/user/date/path/root；新 tab 保留过滤。
- Graph Options：按日期；Show First Parent；No Merges；Expand Linear Branches；Compact References；Tag Names。
- Enable Git Log Indexing（加速过滤、文件历史全分支、Search Everywhere）。
- 多仓库彩色 stripe。
- Context（节选）：Checkout、New Branch/Tag、Cherry-pick、Revert、Reset、Reword、Squash、Drop、Interactive Rebase、Compare、Browse/Show Repository at Revision、Push up to Here、Open on GitHub/GitLab `[hosting]`。
- Actions：`Git.Log*`、平台 `Vcs.Log.*` 组。

### 11.2 File / Folder / Selection History
- `Git | Show History`；History for Selection；目录历史 → 过滤 Log tab。
- History toolbar：Branch filter、Diff、All Affected Files、Annotate、Open on GitHub/GitLab、Get from Revision。

### 11.3 Annotate / Blame
- 编辑器/Diff gutter：**Annotate with Git Blame**（`Annotate`）`[平台动作 + Git 实现]`。
- View：作者/日期/revision 格式；Colors；Ignore Whitespaces；Detect Movements Within/Across Files；Show Commit Timestamp。
- Annotate Revision / Previous Revision；Hide / Restore Hidden Revisions。
- Code Vision：**Code author** inlay → 点开 annotate。
- 跳转：Log commit；GitHub；issue tracker 链接（若启用）。

### 11.4 Compare versions
- 两 commit Compare Versions；文件 Compare with Revision / Branch or Tag；本地 vs HEAD Diff。
- Diff Viewer：side-by-side / unified；Ignore whitespace 模式；Combined Diff；外置 Diff 工具。`[平台共享 Diff]`

---

## 12. Edit History（改写历史）`[Git 专属]`

| 功能 | UI | 备注 |
|------|-----|------|
| Edit Commit Message | Log `F2`；提交成功通知 | `Git.Reword.Commit` |
| Amend | Commit 勾选 Amend | 本地 |
| Fixup / Squash Into | Log 对目标 commit | `Git.Fixup.To.Commit` / `Git.Squash.Into.Commit`；需 rebase |
| Squash Commits | 多选 commits | `Git.Squash.Commits` |
| Drop Commit | Log | `Git.Drop.Commits`；常需 force push |
| Extract Selected Changes | Changed Files | 拆 commit |
| Undo Commit | 当前分支最新 | `Git.Uncommit` → 变更进 changelist |
| Reset Current Branch to Here | Soft/Mixed/Hard/Keep | `Git.Reset` / `Git.Reset.In.Log` |
| Revert Commit / Selected Changes | Log / Changed Files | `Git.Revert.In.Log`；可 Abort |

Protected branches 禁止 force-push 类改写；可从 GitHub 加载保护规则。

---

## 13. Undo / Rollback（撤销未推送与工作区）

### 13.1 Rollback 未提交变更
- Commit 视图 Rollback（`Ctrl+Alt+Z`）；可选 Delete local copies of added files。`[平台 ChangesView.Revert]`

### 13.2 行级撤销
- Gutter revert；`Vcs.RollbackChangedLines`。

### 13.3 Get previous file revision
- File History → Get。

---

## 14. Stash / Shelve

### 14.1 Shelve `[平台共享 — IDEA shelf]`
- Commit 上下文 Shelve / Shelve Silently；Unshelve（可删 shelf）；Restore；Import patches；默认 shelf 路径；base revision shelve。
- Actions：`ChangesView.Shelve*`、`Vcs.Shelf.*`、`Vcs.Show.Shelf`。

### 14.2 Stash `[Git 专属]`
- `Git | Stash Changes` / Commit 上下文；Keep index；Message；根选择（`Git.Stash`）。
- Stash tab：Apply / Pop / Drop / Clear / Unstash as branch；Diff 对比 local 或 parent commit。
- Settings：Combine stashes and shelves in one tab；Clean working tree using = Stash | Shelve。
- Actions：`Git.Stash.*`、`Git.Unstash`、`Git.Show.Stash`。

---

## 15. Ignore

### 15.1 加入忽略
- 未版本化文件上下文：`Git | Add to .gitignore` / `Add to .git/info/exclude`（`Git.Ignore.File`）。
- Show Ignored Files；编辑 `.gitignore`；Open exclude file（`Git.OpenExcludeFile`）。

### 15.2 Ignored Files 设置页
- Settings | Version Control | Ignored Files（平台忽略列表 vs Git ignore 并存，需注意区别）。`[平台 + Git]`

---

## 16. Diff / Compare / Patch

### 16.1 Diff Viewer（见 §11.4）
- Commit Options：双击打开 Diff 或 Source；Diff in editor tab vs window。

### 16.2 Patch `[平台共享]`
- Create Patch from Local Changes / from commit / from file history；Copy as Patch to Clipboard；Reverse patch；Encoding；Base path。
- Apply Patch / Apply from Clipboard（`Git | Patch | …`，`ChangesView.ApplyPatch*`）。
- Git 格式 patch 可带出 author/message 到 Commit 窗。

---

## 17. UI Chrome：菜单、工具栏、快捷键、控制台

### 17.1 主菜单组（Git）
- File / Local Changes / Merge / Rebase 分组（`Git.MainMenu.*`）；Clone、Fetch、Pull、Push、Branches、Tag、Reset、Remotes、Stash、Unstash、Resolve Conflicts、Worktrees 等。

### 17.2 VCS Operations Popup
- `Alt+\``；可在 Menus and Toolbars 自定义。`[平台框架]`

### 17.3 主快捷键（文档）

| 动作 | 快捷键 |
|------|--------|
| VCS Operations Popup | `Alt+\`` |
| Commit | `Ctrl+K` |
| Update Project | `Ctrl+T` |
| Rollback | `Ctrl+Alt+Z` |
| Push | `Ctrl+Shift+K` |
| Commit and Push | `Ctrl+Alt+K` |
| Next/Previous Change | `Ctrl+Alt+Shift+Down/Up` |
| Git / VCS window | `Alt+9` |
| Commit window | `Alt+0` |
| Show Diff | `Ctrl+D` |
| Add to VCS | `Ctrl+Alt+A` |

### 17.4 Console / 其它 Tab
- Git tool window Console（命令输出）`[不确定完整命令集 UI]`；Update Info；Shelf/Stash；Worktrees。

### 17.5 Main Toolbar Quick Actions
- Branches widget；Update/Push、Commit、History、Rollback quick actions（frontend 模块）。

### 17.6 Hosting 链接组
- Open in Browser / Copy Link（`Git.Hosting.*`）由 GitHub/GitLab 等扩展。

---

## 18. Settings（设置页）

### 18.1 Version Control（根）`[平台]`
- 目录 ↔ VCS 映射；其它通用项。

### 18.2 Version Control | Git `[Git]`
- Path to Git；Commit（staging、CRLF warn、detached/rebase warn、cherry-pick suffix、GPG）；Push（auto-update、Push dialog、Protected branches、Load GitHub protection rules）；Update（method、Clean working tree、filter paths、auto fetch、incoming check、Fetch tags）；Stash（combine tabs、diff 对比对象）；credential helper；Execute branch operations on all roots。

### 18.3 Confirmation `[平台]`
- When files created/deleted；Show options before Update/…；Restore workspace on branch switching；Highlight modified lines in gutter；Highlight directories with modified files；Log indexing 等相关。

### 18.4 Changelists / Commit / Ignored Files / File Status Colors
- 见对应设置页。`[平台]`

### 18.5 Diff & Merge / External Diff Tools / Date Formats / Code Vision / Code Review colors
- 影响 Diff、Merge、Annotate、PR review 呈现。`[平台 / 插件]`

### 18.6 Advanced Settings | Version Control
- Commit tool window 行为；Modal commit；不运行 hooks；自动打开 Update Info 等。

### 18.7 Keymap | Version Control Systems
- 自定义 Annotate、Show VCS Log、Move Lines to Changelist 等。

---

## 19. GitHub 集成（内置体验相关）`[GitHub 插件]`

> Bundled 插件 `org.jetbrains.plugins.github`，依赖 `Git4Idea`。属于 IDEA「Git 工具体验」的扩展面，但**不是** core Git。GitLab MR 为姊妹插件，此处不展开细节。

### 19.1 账号与 Clone / Share
- Settings | Version Control | **GitHub**；Clone 对话框 GitHub/GHE 扩展。
- Share a project on GitHub；Jump to GitHub version of a file；Open in Browser；Copy Link。
- Create Gist；Sync Fork。

### 19.2 Pull Requests Tool Window
- `Git | GitHub | Create Pull Request` / `View Pull Requests`。
- 创建：base/head repo+branch；Title/Description（含 PR template）；reviewers/assignees/labels；Draft PR；推送后通知创建 PR。
- 列表：按 state/author/label/assignee/review 过滤与排序；Refresh；浏览器打开。
- 详情：Overview + Timeline；按 commit 过滤变更；Checkout 分支；Review Mode（编辑器内评论高亮）；回复/resolve/reaction/@mention；建议 Apply locally / Commit。
- Merge / Squash and Merge / Rebase；Request Review；Close；删已合并分支。
- Open in Worktree；Mark viewed；Submit review。
- Actions：`Github.Create.Pull.Request`、`Github.View.Pull.Request`、`Github.PullRequest.*` 等。

### 19.3 与 core Git 的交叉
- Protected branches from GitHub；Open on GitHub from Log/History/Annotate；PR branch checkout / worktree。

---

## 20. 其它 / 边缘能力

| 功能 | 说明 | 标记 |
|------|------|------|
| Browse / Show Repository at Revision | 某 revision 快照浏览器 | Git |
| Submodules | clone/update 时行为 | Git（文档提及） |
| Multi-root / multi-repo | 同步分支、Push 多选、Log 着色 | Git + 平台 |
| Issue navigation | commit message → tracker | 平台 + 配置 |
| UML Diff | `Vcs.UmlDiff` | `[不确定]` 使用频率/捆绑条件 |
| Git Features Trainer | 独立 trainer 插件目录 | 非核心 UI |
| Modal Commit plugin | `git-modal-commit` | 可选 |
| GitLab Merge Requests | 对标 PR；独立插件 | 非 GitHub、非 core Git |
| Sign-off / hooks / commit.template | 提交链路 | Git + IDE |

---

## Appendix A — 扁平 Checklist（功能 ID / 名称）

> 用于产品追踪；`[?]` = 不确定或边界项。ID 优先用源码 action id，否则用稳定英文名。

### A.1 Setup / Clone / Init
- [ ] `Git.Clone` — Clone Repository
- [ ] Shallow clone + `Git.Unshallow`
- [ ] Welcome / New Project from Version Control
- [ ] `Start.Use.Vcs` / Enable Version Control Integration
- [ ] `Git.Init` — Create Git Repository
- [ ] `Git.Add` — Add to VCS
- [ ] Auto-add on create (Confirmation)
- [ ] Force-add ignored files
- [ ] Git executable path + Test (+ WSL)
- [ ] Share project settings via VCS prompt
- [ ] Submodule clone/register `[?]` 细节

### A.2 Remotes / Auth
- [ ] `Git.Configure.Remotes` — Manage Remotes
- [ ] Define remote (Push dialog)
- [ ] Edit / Remove Remote
- [ ] Fetch on add remote
- [ ] Password policy / credential helper
- [ ] `Github.Sync.Fork` `[GitHub]`

### A.3 Branches
- [ ] VCS Widget (incoming/outgoing)
- [ ] `Git.Branches` / Show Branches
- [ ] New Branch (current / selected / commit)
- [ ] Checkout / Checkout and Update
- [ ] Force vs Smart Checkout
- [ ] Rename local branch + unset upstream
- [ ] Favorite branches
- [ ] Group by Directory / Recent / Tags nodes
- [ ] Compare with Current
- [ ] Diff with Working Tree
- [ ] Two-dot range filter in Log
- [ ] Delete branch (+ restore notification)
- [ ] Update selected branch
- [ ] `Git.Cleanup.Branches`
- [ ] `Git.FindMergedLocalBranches`
- [ ] Execute branch operations on all roots
- [ ] Restore workspace on branch switch
- [ ] Copy branch name

### A.4 Tags
- [ ] `Git.CreateNewTag` / New Tag (annotated)
- [ ] Tag from Log
- [ ] Checkout / Jump to tag
- [ ] Reassign tag
- [ ] `Git.Tag.Push` / Push tags in Push dialog
- [ ] Delete tag
- [ ] Fetch tags policy (settings)

### A.5 Worktrees
- [ ] `Git.Show.WorkingTrees` / Worktrees tab
- [ ] `Git.CreateNewWorkingTree`
- [ ] Open / Remove / Refresh / Prune / Lock
- [ ] Open Review / Open PR in Worktree `[GitHub/GitLab]`

### A.6 Local Changes / Changelists / Staging
- [ ] Commit tool window `Alt+0`
- [ ] Default Changes + Unversioned lists
- [ ] Show Ignored Files
- [ ] New/Rename/Remove/Set Active changelist
- [ ] Move to Another Changelist
- [ ] Per-hunk / per-line changelists
- [ ] Changelist conflict dialog + settings
- [ ] File status colors + directory highlight
- [ ] Editor gutter markers + line rollback/diff
- [ ] Enable staging area mode
- [ ] `Git.Stage.*` (add/reset/revert/compare/three-way/conflicts)
- [ ] Delete versioned file → commit removal
- [ ] Stop tracking workaround `[?]` 无单一动作

### A.7 Commit / Push
- [ ] Commit (`Ctrl+K`)
- [ ] Amend
- [ ] Commit message history / template / reformat
- [ ] Author / Sign-off / GPG sign
- [ ] Run Git hooks toggle
- [ ] Commit Checks / Advanced Checks / After Commit upload
- [ ] Partial commit (chunks/lines)
- [ ] Commit from gutter
- [ ] Commit and Push (`Ctrl+Alt+K`)
- [ ] Commit TW view modes / toggle controls / modal `[?]`
- [ ] Push dialog
- [ ] Push All up to Here / Push Selected Commits
- [ ] Force push (lease) + protected branches
- [ ] Push Rejected → merge/rebase
- [ ] Push tags (All / Current Branch)

### A.8 Fetch / Pull / Update
- [ ] `Git.Fetch` (+ auto fetch + widget button)
- [ ] Incoming changes check
- [ ] `Git.Pull` + modify options
- [ ] `Vcs.UpdateProject` (`Ctrl+T`)
- [ ] Update strategies: Merge / Rebase / Reset to Remote
- [ ] Update Info tab
- [ ] Submodule update behavior

### A.9 Merge / Rebase / Cherry-pick
- [ ] `Git.Merge` + options + Abort/Commit
- [ ] Smart merge
- [ ] `Git.Rebase` + options
- [ ] Branch popup rebase variants
- [ ] Interactive rebase (Pick/Edit/Reword/Squash/Fixup/Drop)
- [ ] Rebase Abort/Continue/Skip
- [ ] Cherry-pick + Abort/Continue
- [ ] Cherry-pick suffix for protected
- [ ] Highlight cherry-picked commits
- [ ] Apply/Get file from revision
- [ ] Extract / Drop selected changes

### A.10 Conflicts / Diff / Patch
- [ ] Conflicts dialog (Yours/Theirs/Manual)
- [ ] Three-way merge editor
- [ ] Abort Merge / Resolve Conflicts actions
- [ ] CRLF warning
- [ ] Diff Viewer (side-by-side/unified/ignore rules)
- [ ] Combined Diff `[平台]`
- [ ] Compare with Revision / Branch or Tag
- [ ] Compare two commits
- [ ] Create / Apply Patch (+ clipboard, reverse)

### A.11 Log / History / Annotate / Edit History
- [ ] Log tab panes + filters + graph options
- [ ] Git Log Indexing
- [ ] File / Folder / Selection History
- [ ] Annotate with Git Blame + options
- [ ] Code author Code Vision
- [ ] Show Repository at Revision
- [ ] Reword / Squash / Drop / Fixup / Squash Into
- [ ] Undo Commit / Revert Commit / Reset (Soft/Mixed/Hard/Keep)
- [ ] BrowseRepoAtRevision

### A.12 Stash / Shelve / Ignore
- [ ] Shelve / Unshelve / Restore / Import patches
- [ ] Stash / Apply / Pop / Drop / Clear / Unstash as
- [ ] Combine Stashes and Shelves tab
- [ ] Clean working tree using Stash|Shelve
- [ ] Add to .gitignore / exclude
- [ ] Open exclude file

### A.13 Settings / Chrome / Shortcuts
- [ ] Settings | Git (full page)
- [ ] Confirmation / Changelists / Ignored / File Status Colors
- [ ] Diff & Merge / Advanced VCS settings
- [ ] VCS Operations Popup (`Alt+\``)
- [ ] Git main menu groups
- [ ] Main toolbar Git quick actions
- [ ] Console tab `[?]`
- [ ] Keymap customization

### A.14 GitHub plugin（built-in 体验扩展）
- [ ] GitHub accounts settings
- [ ] Clone via GitHub/GHE
- [ ] Share project on GitHub
- [ ] Open/Copy GitHub link
- [ ] Create Gist
- [ ] Create / Draft Pull Request
- [ ] Pull Requests tool window (filter/sort/timeline)
- [ ] Review Mode + comments/suggestions
- [ ] Merge / Squash / Rebase PR
- [ ] Checkout PR branch / Open in Worktree
- [ ] Load branch protection rules from GitHub
- [ ] Sync Fork

### A.15 Explicitly out-of-core / sister
- [ ] GitLab Merge Requests（独立插件）
- [ ] Git Features Trainer
- [ ] Modal Commit Interface plugin
- [ ] Deployment after commit（非 Git 核心）
- [ ] Language-specific commit checks（Reformat 等）

---

## Appendix B — 源码锚点（便于复查）

| 模块 | 路径 |
|------|------|
| Git plugin 入口 | `plugins/git4idea/resources/META-INF/plugin.xml` |
| Git actions（大量） | `plugins/git4idea/backend/resources/intellij.vcs.git.backend.xml` |
| Git frontend widget | `plugins/git4idea/frontend/…` |
| 平台 VCS actions | `platform/vcs-impl/resources/META-INF/VcsActions.xml` |
| GitHub plugin | `plugins/github/`（`intellij.vcs.github.xml`） |

---

## Appendix C — 文档索引（JetBrains Help）

- [Git](https://www.jetbrains.com/help/idea/using-git-integration.html)
- [Set up a Git repository](https://www.jetbrains.com/help/idea/set-up-a-git-repository.html)
- [Manage branches](https://www.jetbrains.com/help/idea/manage-branches.html)
- [Sync with remote](https://www.jetbrains.com/help/idea/sync-with-a-remote-repository.html)
- [Commit and push](https://www.jetbrains.com/help/idea/commit-and-push-changes.html)
- [Merge / rebase / cherry-pick](https://www.jetbrains.com/help/idea/apply-changes-from-one-branch-to-another.html)
- [Resolve conflicts](https://www.jetbrains.com/help/idea/resolve-conflicts.html)
- [Changelists](https://www.jetbrains.com/help/idea/managing-changelists.html)
- [Shelve / Stash](https://www.jetbrains.com/help/idea/shelving-and-unshelving-changes.html)
- [Investigate changes](https://www.jetbrains.com/help/idea/investigate-changes.html)
- [Log tab](https://www.jetbrains.com/help/idea/log-tab.html)
- [Edit history](https://www.jetbrains.com/help/idea/edit-project-history.html)
- [Undo changes](https://www.jetbrains.com/help/idea/undo-changes.html)
- [Diff viewer](https://www.jetbrains.com/help/idea/comparing-file-versions.html)
- [Patches](https://www.jetbrains.com/help/idea/using-patches.html)
- [Tags](https://www.jetbrains.com/help/idea/use-tags-to-mark-specific-commits.html)
- [Worktrees](https://www.jetbrains.com/help/idea/use-git-worktrees.html)
- [Git settings](https://www.jetbrains.com/help/idea/settings-version-control-git.html)
- [Shortcuts](https://www.jetbrains.com/help/idea/main-version-control-shortcuts.html)
- [GitHub PRs](https://www.jetbrains.com/help/idea/create-and-merge-github-pull-requests.html)

---

*盘点日期：基于 2026-11 可访问的 JetBrains Help 与 intellij-community `master` 源码快照；IDEA 版本演进可能导致菜单文案/默认布局差异。*
