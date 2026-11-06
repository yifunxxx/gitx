# Part 2.2 — Branches（#18–35）· Tags（#36–42）· Worktrees（#43–46）

> 返回索引：[../dev-plan.md](../dev-plan.md) · 框架：[01-framework.md](./01-framework.md) · 条目模板见 [02](./02-setup-remotes.md) 顶部。

## 共享基础：refs 模型

- BE `refs_list{repoId}` → 一次 `git for-each-ref -z --format='%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track,nobracket)%00%(push)%00%(HEAD)%00%(committerdate:unix)%00%(subject)%00%(symref)%00%(worktreepath)' refs/heads refs/remotes refs/tags`（tag 额外 `%(*objectname)` 解引用）。ahead/behind：git ≥2.41 用 `%(ahead-behind:HEAD)`，否则对「有 upstream 的本地分支」批量 `rev-list --left-right --count a...b`（gix 加速，只对可见/收藏/最近分支计算，其余懒加载）。
- Recent branches：解析 `git reflog HEAD -n 500 --format=%gs` 中 `checkout: moving from X to Y`，取最近 5 个（设置可调）。
- `branchesStore`：`local[]`、`remote[]`、`tags[]`、`favorites`（gitx-meta）、`recent[]`、`current`（含 detached/unborn）、`trackingInfo`。由 `repo://changed{Refs}` 驱动增量刷新。
- 两个视图共享同一树模型与 Action 组：**Branches Popup**（VCS Widget 点击 / `Git.Branches`，弹出式，带搜索）与 **Branches pane**（Git TW → Log 左侧，常驻）。

---

### #18 VCS Widget（incoming / outgoing）
- **UI**：TitleBar 中 `⎇ main ↓2 ↑1`：分支名（detached 显示短 sha + 「detached」，unborn 显示「No commits」，进行中操作显示「Rebasing main 3/7」「Merging」橙色）；↓ 蓝色 = incoming（upstream 有本地没有的 commit），↑ 绿色 = outgoing；仅 #76 检测到「远端有未 fetch 的变更」时显示带点的 ↓。多 root：显示「⎇ 3 repos」或若同分支则显示分支名，popup 内按 repo 分组。悬停 tooltip：upstream 名称、上次 fetch 时间。点击打开 Branches Popup（#19）。
- **实现**：数据来自 `branchesStore.current/trackingInfo` + `incoming://changed`。
- **边界**：无 upstream → 不显示箭头，tooltip「No upstream branch — Push to set」；gone upstream（`[gone]`）→ 灰色删除线提示。
- **AC**：本地 commit 后 ↑ 计数 <1s 更新；fetch 后 ↓ 正确；外部终端 checkout 后 widget 自动更新。
- **里程碑**：M2（M1 先实现只读分支名）

### #19 `Git.Branches` / Show Branches（Popup + pane）
- **UI**：Popup 顶部：搜索框（模糊匹配，键入即过滤，`↑↓` 选择、`→` 展开动作子菜单、Enter 执行默认动作 = Checkout）、Fetch 按钮（⟳）、设置齿轮（#25）；顶部动作区：**Update Project…**、**Commit…**、**Push…**、**New Branch…**、**Checkout Tag or Revision…**；下方节点 Recent / Local / Remote / Tags。分支行显示 ★ 收藏、↓↑ 计数、当前分支加 tag 图标、跟踪 remote 小字。每个分支的子菜单（= Branch ContextMenu 组）：Checkout、New Branch from 'x'…、Checkout and Rebase onto 'current'、Compare with 'current'、Show Diff with Working Tree、Rebase 'current' onto 'x'、Merge 'x' into 'current'、Pull into 'current' Using Rebase / Merge（remote 分支）、Update、Push…、Rename…、Delete、Copy Branch Name、Add to Favorites。Branches pane 提供同一右键菜单 + 工具栏（New Branch、Update Selected、Delete、Fetch、Group by…）。双击 pane 中分支 = 在 Log 中过滤该分支（IDEA 行为）。
- **实现**：FE `features/branches/BranchesPopup.vue`（reka Popover + 虚拟列表）、`BranchesPane.vue`；Actions `Git.Branches.*` 由 registry 生成子菜单，`ctx.selection.refs`。
- **边界**：5k+ refs → 虚拟化 + 搜索在 worker 中做；分支名极长 → 中间省略；分支名含 `/` 用于分组（#25）。
- **AC**：Popup 在 100ms 内打开（使用缓存数据并后台刷新）；全部动作可键盘完成；5k 分支滚动流畅。
- **里程碑**：M2

### #20 New Branch（current / selected / commit）
- **UI**：对话框「Create New Branch」：Name 输入（实时校验：非法字符、已存在 → 提供「Overwrite existing branch」复选框）、「Checkout branch」（默认开）、「Overwrite existing branch」；来源显示「from: main / 3f2a1c」。入口：Popup 顶部 New Branch（from HEAD）、分支子菜单「New Branch from 'x'」、Log commit 右键「New Branch…」（`Git.CreateNewBranch.FromCommit`），不设默认快捷键（可在 Keymap #124 绑定）。分支名前缀建议：输入时下拉建议已有前缀（`feature/`、`bugfix/`，统计本地分支前缀频率）。
- **实现**：BE `branch_create{name, startPoint, checkout, force}` → checkout 为真时 `git checkout -b|-B <name> <start>`（Write），否则 `git branch [-f] <name> <start>`；从 remote 分支创建时 `--track`。校验 `git check-ref-format --branch <name>`。
- **边界**：checkout 被未提交变更阻挡 → 走 #22 Smart/Force；从 remote 创建同名本地分支已存在 → 提示「Checkout existing」或 Overwrite；unborn HEAD（无 commit）→ 提示先完成首次提交（不提供 orphan 分支创建）。
- **AC**：三个入口均可创建；非法名即时提示；创建后 widget/Log 更新。
- **里程碑**：M2（Log 入口随 M3）

### #21 Checkout / Checkout and Update
- **UI**：本地分支 → **Checkout**；remote 分支 `origin/x` → **Checkout**（创建/复用跟踪本地分支 `x`；若本地 `x` 存在但跟踪不同 → 对话框选择「Checkout and Reset」/「Checkout and Rebase」/「Create new name」）；Popup 中本地分支落后 upstream 时显示 **Checkout and Update**（checkout 后按 Update method 同步）。顶部「Checkout Tag or Revision…」：输入 sha/表达式（RefPicker）→ detached HEAD（确认提示 detached 含义，可勾 Don't show again）。
- **实现**：BE `branch_checkout{target, mode:'local'|'remote'|'revision', update?:boolean}` → `git checkout <b>` / `git checkout -b <x> --track origin/x` / `git checkout --detach <rev>`；update 时追加 `update_branch`（#30）。多 root 同步见 #33。
- **边界**：工作区阻挡（`DirtyWorktreeWouldBeOverwritten` / `UntrackedWouldBeOverwritten`）→ #22 对话框；进行中 rebase/merge → action disabled 并说明；分支被其它 worktree 检出（`WorktreeBranchInUse`）→ 提示「Open worktree」；大型 checkout 显示进度（`--progress`）。
- **AC**：外部无阻挡时 checkout ≤ git 原生耗时 + 200ms；remote checkout 自动设置 upstream；检出后 Changes/Log/Widget 同步刷新。
- **里程碑**：M2

### #22 Force vs Smart Checkout
- **UI**：checkout 失败（本地变更会被覆盖）时弹出「Git Checkout Problem」对话框：列出冲突文件（可点开 diff），按钮 **Smart Checkout**（默认）、**Force Checkout**（destructive）、**Don't Checkout**。Settings | Git → 「Clean working tree using: Stash / Shelve」决定 Smart 使用的方式（#114）。
- **实现**：Smart：`stash create` 快照 → `git stash push -m "gitx smart checkout"`（仅当阻挡来自 untracked 文件时加 `--include-untracked`；默认全量 stash 以保持语义简单）或 shelf（#111）→ `git checkout` → `git stash pop --index`；pop 冲突 → 进入 Conflicts（#93），并记录「pending drop」。Force：Safety Snapshot → `git checkout -f <b>`（untracked 被覆盖的文件先移入回收站）。
- **边界**：pop 失败后 stash 必须保留并在 Stash tab 标注「from Smart Checkout」；Force 前必须快照，balloon 提供 Restore。
- **AC**：Smart Checkout 后用户变更完整保留（自动化测试：修改 + 新增 + 删除 + 部分 staged）；冲突时进入冲突流程且 stash 不丢。
- **里程碑**：M4

### #23 Rename local branch + unset upstream
- **UI**：分支右键 **Rename…**（`Git.Rename.Local.Branch`，当前分支也可，`Shift+F6` 在 Branches pane）；对话框 New name + 复选「Unset upstream」（当 upstream 名与旧名相同且新名不同时默认勾选并解释：避免 push 到旧远端分支）。
- **实现**：`branch_rename{old,new,unsetUpstream}` → `git branch -m <old> <new>` + `git branch --unset-upstream <new>`；gitx-meta 迁移 favorites/工作区状态（#34）。
- **边界**：新名已存在 → 错误并提供 `-M` 覆盖（确认）；名字仅大小写变化在大小写不敏感文件系统 → 使用两步重命名（临时名）。
- **AC**：重命名后收藏状态保留；unset upstream 后 widget 不显示箭头。
- **里程碑**：M2

### #24 Favorite branches
- **UI**：分支行悬停显示 ☆，点击或 `Space` 切换；收藏分支在各节点中置顶并显示 ★；默认收藏 `main`/`master`（可在 Settings 改「Default favorite branches」）；Log 的 Branch filter 下拉中收藏优先。
- **实现**：gitx-meta `favorites.json`（per repo，键为完整 refname，支持 remote）；无后端 git 调用。
- **边界**：收藏的分支被删除 → 自动移除；multi-root 同名分支收藏同步（当 #33 开启时）。
- **AC**：收藏跨重启保留；排序正确。
- **里程碑**：M2

### #25 Group by Directory / Recent / Tags nodes
- **UI**：Popup 与 pane 的齿轮菜单：**Group by Directory**（`feature/a` → `feature` 文件夹节点）、**Show Recent Branches**、**Show Tags**、（pane 额外）Group by Repository（多 root）。节点可折叠，折叠状态持久化。
- **实现**：纯前端树变换（`features/branches/buildRefTree.ts`，单元测试）；设置存 `settingsStore.branches.*`。
- **边界**：分支名同时是目录前缀（`a` 与 `a/b`）→ git 不允许，无需处理；Tags 数量巨大（>10k）→ Tags 节点懒加载 + 搜索时才展开。
- **AC**：切换选项即时生效；10k tags 时 popup 依然 ≤100ms 打开。
- **里程碑**：M2

### #26 Compare with Current
- **UI**：分支右键 **Compare with 'current'**（`Git.CompareWithBranch` / `Git.Ref.Compare.With`）→ Git TW 新 tab「main ↔ feature」：上下两段 Log 列表：「Commits in feature not in main」与「Commits in main not in feature」，各自带 graph-less 列表 + 右侧 Changed Files/Details；工具栏 **Swap Branches**、Refresh。
- **实现**：`log_query{range:'main..feature'}` 与反向（`--cherry-mark` 可选标记等价提交）；复用 logStore 多实例。
- **边界**：无共同祖先（unrelated histories）→ 提示；shallow → 提示可能不完整；结果为空 → 空状态「Branches are identical / no unique commits」。
- **AC**：结果与 `git log a..b` 一致；Swap 后两段对调。
- **里程碑**：M3

### #27 Diff with Working Tree
- **UI**：分支右键 **Show Diff with Working Tree**（`Git.Ref.Diff.With.Local`）→ 编辑区新 tab：文件列表（状态标记：灰=仅分支有/删除、绿=新增、蓝=修改），点击文件看 diff（左 = 分支版本，右 = 工作树可编辑）。
- **实现**：`diff_refs{left: ref, right: WORKTREE}` → `git diff --name-status -z <ref>`（含工作树未提交改动）+ 文件内容按需 `blob_read`。
- **边界**：untracked 文件不出现（与 git 一致），列表顶部提示；大量文件虚拟化。
- **AC**：列表与 `git diff --name-status <ref>` 一致；右侧编辑保存后 diff 刷新。
- **里程碑**：M3

### #28 Two-dot range filter in Log
- **UI**：Log 的 Branch filter 输入/下拉支持 `a..b`（以及「Select…」中选择两个分支生成）；Log 过滤 chip 显示「main..feature」。
- **实现**：logStore filter `revisions: string[]` 原样传给 `git log`（经 `rev-parse --verify` 校验每端）；gix 路径支持 hide/tip 语义。
- **边界**：三点 `a...b` 同样支持（对称差，并显示 left/right 标记）；非法表达式 → 内联错误。
- **AC**：`main..feature` 结果与 CLI 一致，可与 user/date/path 过滤组合。
- **里程碑**：M3

### #29 Delete branch（+ restore notification）
- **UI**：右键 **Delete**（pane 中 `Delete` 键；可多选批量）。当前分支不可删（disabled + 原因）。删除未完全合并分支：不弹阻塞确认，而是执行 `-D` 前的轻确认对话框「Branch 'x' is not fully merged (3 commits) — View Commits / Delete Anyway / Cancel」；成功后 balloon：「Deleted branch x — **Restore** · **View Commits** · **Delete tracked branch origin/x**」（后者当存在跟踪的 remote 分支时）。删除 remote 分支（右键 remote 分支 Delete）→ 确认对话框（destructive）。
- **实现**：`branch_delete{name, force}` → 先 `git branch -d`，失败 `BranchNotFullyMerged` → 交互；记录 sha 与 upstream 至 gitx-meta + `refs/gitx/backup/branch-<name>-<ts>`；`branch_restore` → `git branch <name> <sha>` + 恢复 upstream 配置；remote 删除 `git push <remote> --delete <branch>`（NetworkWrite）。
- **边界**：分支被其它 worktree 检出 → 错误提示；删除 remote 分支受 protected branches 约束（#72）→ disabled。
- **AC**：删除后 Restore 恢复同 sha 与 upstream；未合并检查准确；批量删除报告每个结果。
- **里程碑**：M2

### #30 Update selected branch
- **UI**：Branches pane/Popup 中非当前、有 upstream 的本地分支右键 **Update**（可多选）；Popup 中显示可更新提示（↓ 计数）。
- **实现**：非当前分支无需 checkout：fast-forward 时 `git fetch <remote> <rb>:<local>`（refspec 更新本地分支，git 自身保证仅 FF）；非 FF → 提示「Cannot fast-forward 'x' — Checkout and Update / Rebase」。当前分支 → 等同 Update Project 的单分支版本（#78）。
- **边界**：被其它 worktree 检出的分支 → git 拒绝更新，提示；多分支批量报告。
- **AC**：落后分支 Update 后与 upstream 同 sha，当前工作区不受影响。
- **里程碑**：M2

### #31 `Git.Cleanup.Branches`
- **UI**：Branches pane 工具栏/Main Menu `Git | Branches | Clean Up Branches…`：对话框列出候选：已合并到默认分支的本地分支、upstream 已 `[gone]` 的本地分支；复选列表（默认全选 merged，gone 默认不选）、显示最后提交日期/作者；排除收藏与当前分支、protected。按钮 Delete Selected。
- **实现**：`branch_merged{target:<default branch>}`（#32）+ trackingInfo `gone`；批量 `branch_delete`（-d，gone 且未合并的需 -D 二次确认）；全部写备份 refs，balloon 提供「Restore All」。
- **边界**：默认分支探测：`refs/remotes/origin/HEAD` → `init.defaultBranch` → main/master；squash-merged 分支无法被 `--merged` 检出 → 文案说明 + 「gone」作为补充信号。
- **AC**：一次操作可清理 N 个分支并一键全部恢复。
- **里程碑**：M3

### #32 `Git.FindMergedLocalBranches`
- **UI**：Branches pane 齿轮菜单「Highlight merged branches」或 Cleanup 对话框的数据源；合并分支灰显并带 ✓merged 标签。
- **实现**：`branch_merged{target}` → `git for-each-ref --merged=<target> refs/heads --format=%(refname)`。
- **边界**：目标分支选择（默认分支 / 当前分支）；大仓库耗时 → 后台 Read job + 缓存（refs 变化时失效）。
- **AC**：结果与 `git branch --merged <target>` 一致。
- **里程碑**：M3

### #33 Execute branch operations on all roots
- **UI**：Settings | Git →「Execute branch operations on all roots」（多 root 时才显示，默认开）。开启时 Popup 顶层显示所有 root 共有的分支（「common branches」），操作（checkout/new/delete/merge/rebase）作用于全部 root；各 repo 分支不同步时 Popup 顶部提示「Branches have diverged」并按 repo 分组展示。
- **实现**：`MultiRootOp` 编排：顺序执行各 root；任一失败 → 对话框「Checkout failed in repo B — **Rollback** (repo A 回到原分支) / Keep」；Rollback 执行反向操作。
- **边界**：部分 root 无该分支 → 仅在拥有该分支的 root 执行或提示创建；Smart checkout 在各 root 独立 stash。
- **AC**：3 个 root 同步 checkout；人为制造 B 失败时可回滚 A。
- **里程碑**：M7

### #34 Restore workspace on branch switch
- **UI**：Settings | Version Control | Confirmation → 「Restore workspace on branch switching」（默认开）。gitx 工作区 = 打开的 editor tabs（diff/file/merge）、Commit TW 选择、Log 过滤 tab。切走时保存，切回时恢复，balloon「Workspace for 'feature' restored — Undo」。
- **实现**：前端 `layoutStore.snapshot()` → gitx-meta `ui-state.json` 以 `branch` 为键；`repo://changed{Refs}` 检测 HEAD 分支变化后触发保存/恢复（外部 checkout 同样生效）。
- **边界**：恢复中引用的文件不存在 → 跳过；detached HEAD 不保存。
- **AC**：A→B→A 切换后 A 的 tabs 恢复。
- **里程碑**：M8

### #35 Copy branch name
- **UI**：Popup/pane 中悬停/选中分支按 `Mod+C` 复制；右键 **Copy Branch Name**；toast「Copied 'feature/x'」。
- **实现**：`clipboardService`（Tauri clipboard plugin）。
- **AC**：Popup 搜索焦点时 `Mod+C` 复制选中分支名而非搜索文本（无文本选择时）。
- **里程碑**：M2

---

## Tags

### #36 `Git.CreateNewTag` / New Tag（annotated）
- **UI**：Main Menu `Git | New Tag…`：Git Root（多 root）、Tag name、Commit（RefPicker，默认 HEAD，校验）、Message（多行；非空 → annotated）、「Force (replace existing)」、「Push to remote after creation」（勾选后选择 remote）。
- **实现**：`tag_create{name, target, message?, force, push?}` → `git tag [-f] [-a -F <msgfile>] <name> <target>`；可选 `git push <remote> refs/tags/<name>`；`tag.gpgSign` 配置尊重（失败 → `GpgSignFailed`）。
- **边界**：名称校验 `check-ref-format "refs/tags/<name>"`；已存在且未勾 force → 错误提示。
- **AC**：轻量/annotated 均可创建，Log 中立即显示 tag 胶囊。
- **里程碑**：M2

### #37 Tag from Log
- **UI**：Log commit 右键 **New Tag…**（`Git.Tag`），对话框同 #36 预填 commit；单击即 lightweight（IDEA 行为：Log 中为轻量 tag 输入名称即可，Message 可选展开）。
- **实现**：同 #36。
- **AC**：从任意 commit 打 tag。
- **里程碑**：M3

### #38 Checkout / Jump to tag
- **UI**：Tags 节点右键：**Checkout**（detached，带说明）、**Jump to Tagged Commit**（在 Log 中定位并选中，滚动居中，高亮 1s）、New Branch from Tag…、Compare with current、Push to…、Delete。Log 中「Go to Hash/Branch/Tag」（`Mod+F`）支持 tag。
- **实现**：checkout 同 #21 revision 模式；Jump：logStore `revealCommit(sha)`——若不在已加载页 → 后端返回行号（rev-list 计数或 index）并加载对应页。
- **边界**：tag 指向不在当前 Log 过滤范围内 → 提示「Commit hidden by filters — Clear filters」。
- **AC**：跳转到 1M commit 仓库的老 tag ≤ 1s。
- **里程碑**：M3

### #39 Reassign tag
- **UI**：Log 中 commit 右键（当已存在 tag 选择时）/ Tags 右键 **Move Tag to Commit…**：RefPicker 选目标 commit；若 tag 已推送到 remote → 警告「需要 force push tag，会影响他人」。
- **实现**：`tag_reassign{name, target}` → `git tag -f [-a -m <原消息>] <name> <target>`（annotated 保留原消息）；备份旧 sha 到 `refs/gitx/backup/tag-…`；可选 `git push --force <remote> refs/tags/<name>`。
- **AC**：重指后 Log 胶囊移动，balloon 提供 Undo。
- **里程碑**：M3

### #40 `Git.Tag.Push` / Push tags in Push dialog
- **UI**：Tags 节点右键 **Push to origin**（多 remote → 子菜单）；Push 对话框底部「Push tags: [All | Current Branch]」见 #74。
- **实现**：`tag_push{name, remote}` → `git push --porcelain <remote> refs/tags/<name>`。
- **边界**：远端已存在不同 tag → rejected，提示是否 force（protected 规则默认只作用于分支，不作用于 tags）。
- **AC**：单个 tag 推送成功并在 remote 查询可见（`ls-remote --tags` 校验 balloon）。
- **里程碑**：M2

### #41 Delete tag
- **UI**：Tags 右键 **Delete**（本地）、**Delete on Remote…**；本地删除后 balloon「Deleted tag v1.0 — Restore · Delete on origin」。
- **实现**：`tag_delete{name, remote?}` → `git tag -d` / `git push <remote> --delete refs/tags/<name>`；记录 sha 备份。
- **AC**：删除可恢复；remote 删除需确认。
- **里程碑**：M2

### #42 Fetch tags policy（settings）
- **UI**：Settings | Git → Update → 「Fetch tags: [Auto (git default) | Sync and prune | Always | Never]」。
- **实现**：映射：Auto → 无参数；Sync and prune → `--tags --prune --prune-tags`（会删除远端不存在的本地 tags，确认文案必须明确）；Always → `--tags`；Never → `--no-tags`。应用于 fetch/pull/update（#75/#77/#78）。
- **边界**：Sync and prune 首次启用时警告会删除本地独有 tag（列出将被删除的 tags 预览：`git ls-remote --tags` 对比）。
- **AC**：四种策略对应的 git 参数正确（单元测试）；prune 前有预览。
- **里程碑**：M2

---

## Worktrees

### #43 `Git.Show.WorkingTrees` / Worktrees tab
- **UI**：Git TW → **Worktrees** tab（仅当 repo 有 >1 worktree 或用户打开过时显示；`Git | Worktrees` 打开）。表格：Path、Branch（或 detached sha）、HEAD 提交摘要、状态标记（main / current / locked 🔒 + reason / prunable ⚠）；工具栏 New Worktree、Refresh、Prune。空状态：「No additional worktrees — New Worktree」。
- **实现**：`worktree_list` → `git worktree list --porcelain -z`（解析 worktree/HEAD/branch/bare/detached/locked/prunable）。
- **AC**：列表与 CLI 一致；外部创建的 worktree 在刷新/聚焦后出现。
- **里程碑**：M7

### #44 `Git.CreateNewWorkingTree`
- **UI**：入口：Worktrees tab「+」、`Git | New Worktree…`、VCS Widget popup「New Worktree…」、分支右键「Checkout in New Worktree…」。对话框：Repository（多 root）、From（RefPicker：local/remote/tag/commit）、若所选本地分支已被检出 → 自动切换为「Create new branch: [name]」（IDEA：不可同分支双检出）、Location（默认 `<repo 父目录>/<repo>-<branch>`，校验不嵌套在任何 worktree 内且不存在）、「Open after creation」（新窗口打开）。
- **实现**：`worktree_add{path, ref, newBranch?, track?}` → `git worktree add [-b <nb>] [--track] <path> <ref>`（Write，进度）。打开：`windowService.openWorkspace(path, newWindow)`。
- **边界**：路径嵌套检测；remote 分支 → 自动创建跟踪分支；失败清理目录。
- **AC**：创建后新窗口打开该 worktree，主窗口 Worktrees tab 刷新。
- **里程碑**：M7

### #45 Open / Remove / Refresh / Prune / Lock
- **UI**：Worktrees 行右键：**Open**（新窗口 / 当前窗口替换）、**Reveal in File Manager**、**Remove…**（脏 worktree → 确认「has uncommitted changes, remove anyway (--force)?」destructive）、**Lock…**（输入原因）/ **Unlock**、Copy Path；工具栏 Refresh、**Prune**（预览将被清理的 prunable 项）。main worktree 与当前窗口所在 worktree 不可 Remove（disabled + 原因）。
- **实现**：`worktree_remove{path, force}` → `git worktree remove [--force]`（force 前 Safety Snapshot：在该 worktree 内 `stash create` → backup ref）；`worktree_lock{path, reason}` / `worktree_unlock`；`worktree_prune` → `git worktree prune --dry-run -v` 预览后执行。
- **AC**：所有动作与 CLI 一致；锁定的 worktree Remove 被禁用。
- **里程碑**：M7

### #46 Open Review / Open PR in Worktree（通用部分）
- **范围说明**：编号在范围内，但 IDEA 中依赖 GitHub/GitLab（与 **#134 deferred** 重叠）。gitx 只实现托管无关部分：**「Open in Worktree」**——对任意 remote 分支或 PR ref（用户手动输入 `refs/pull/<n>/head` / `refs/merge-requests/<n>/head`）一键 fetch 并创建 worktree 打开。PR 列表/Review Mode 不做。**需协调者确认**。
- **UI**：remote 分支右键「Open in Worktree」；`Git | Worktrees | Open Ref in Worktree…`（输入 ref 或 PR 号 + remote，带格式提示）。
- **实现**：`fetch <remote> <ref>:refs/gitx/review/<n>` → #44（新分支 `review/<n>`）。
- **AC**：输入 PR 号可在新 worktree 中检出该 PR 头。
- **里程碑**：M7
