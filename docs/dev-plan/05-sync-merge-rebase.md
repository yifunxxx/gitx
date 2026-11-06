# Part 2.4 — Fetch / Pull / Update（#75–81）· Merge / Rebase / Cherry-pick（#82–92）

> 返回索引：[../dev-plan.md](../dev-plan.md) · 框架：[01-framework.md](./01-framework.md) · 条目模板见 [02](./02-setup-remotes.md) 顶部。
> 本章所有可能产生冲突的操作都进入 [1.14.5 RepoOpState 状态机](./01-framework.md#1145-冲突进行中操作状态机repoopstate)，冲突 UI 见 [#93–95](./06-conflicts-diff-history.md)。

## 共享基础：Update 引擎（`gitx-git::ops::update`）

```text
update_branch(repo, branch, strategy, cleanTreeMethod)
  1. 检查 RepoOpState == Normal，否则 OperationInProgress
  2. 若 strategy 需要干净工作区（rebase / reset）且有本地变更 → 按 cleanTreeMethod (Stash|Shelve) 保存（#114）
  3. merge  : git merge --no-edit [--ff|--no-ff per settings] @{u}
     rebase : git rebase @{u}            (plain rebase，不带 --rebase-merges，与 IDEA 一致)
     reset  : Safety Snapshot → git reset --keep @{u}   (失败时提示改用 --hard 并二次确认)
  4. 记录 oldHead/newHead → Update Info (#80)
  5. 恢复第 2 步保存的变更（stash pop --index / unshelve）；冲突 → Conflicts，保留 stash
```

所有网络步骤为 Network Job，多 root 并行 fetch、串行 merge/rebase（每 root 独立报告）。

---

### #75 `Git.Fetch`（+ auto fetch + widget button）
- **UI**：Main Menu `Git | Fetch`（无默认快捷键，IDEA 一致）、Branches Popup ⟳、Branches pane 工具栏、remote 节点右键「Fetch」。运行中 ⟳ 旋转；完成 toast「Fetched: 3 new branches, 12 commits」（无变化时「Everything is up to date」toast 而非 balloon）。Settings | Git → Update →「Fetch automatically every [20] minutes」（默认关；开启后 IDEA 同等的后台增量检查）。
- **实现**：`fetch_run{repoIds, remote?: 'all'|name, prune: settings, tags: #42}` → `git fetch --progress [--all|<remote>] [--prune] [tag 参数]`（Network，后台 fetch 为 `background:true` 且可被用户 Write 抢占）；fetch 前后对比 `for-each-ref refs/remotes` 生成摘要。Auto fetch：Rust 定时器，窗口不可见/电池模式（可选）时延后；失败静默累计 3 次后 balloon。
- **边界**：无 remote → disabled + 原因；认证失败的后台 fetch **不得弹出凭据对话框**（后台 job 设置 askpass 为非交互模式：直接失败并 balloon「Fetch requires credentials — Fetch now」）；离线 → `NetworkError` 静默（仅状态栏图标）。
- **AC**：手动 fetch 更新 Branches 与 widget ↓；后台 fetch 不打断用户、不弹凭据框。
- **里程碑**：M2

### #76 Incoming changes check
- **UI**：Settings | Git →「Check remote for incoming changes: [Auto | Always | Never]」（IDEA 行为：不 fetch 也能知道远端有新提交）。检测到时 VCS Widget ↓ 带小圆点、Branches 中对应分支显示「incoming (unfetched)」图标；点击 → Fetch。
- **实现**：`ls_remote_check{repoId}` → `git ls-remote --heads <remote>`（Network，轻量，频率 = auto fetch 间隔或 10min），对比 `refs/remotes/<remote>/*` sha → `incoming://changed{hasUnfetched}`。Auto = 仅当 ls-remote 不需要交互认证时启用。
- **边界**：大量远端分支（10k）→ 只比较有本地跟踪关系的分支（`ls-remote <remote> <refs…>` 指定）。
- **AC**：远端推送新 commit 后（无 fetch）widget 显示未拉取标记。
- **里程碑**：M2

### #77 `Git.Pull` + modify options
- **UI**：Main Menu `Git | Pull…` 对话框：Git Root（多 root）、Remote 下拉、Branch 下拉（默认当前 upstream；首版只支持单选，IDEA 的多分支 pull 使用率低，后续按需补充）、**Modify options ▾**：`--rebase`、`--ff-only`、`--no-ff`、`--squash`、`--no-commit`、`--no-verify`（互斥项自动禁用，选中项以 chip 显示在命令预览行 `git pull --rebase origin main`）。按钮 Pull。Branches Popup 中 remote 分支「Pull into 'current' Using Merge / Rebase」直接执行（#85）。
- **实现**：`pull_run{repoId, remote, branch, options}` → `git pull --progress --no-edit [opts] <remote> <branch>`（NetworkWrite）；记录 old/new HEAD → Update Info。
- **边界**：pull 前本地变更会被覆盖 → `DirtyWorktreeWouldBeOverwritten` → 提供「Stash and Pull」（#114 方式）；`--squash`/`--no-commit` 后需要手动 commit → Commit TW 预填 `SQUASH_MSG`/`MERGE_MSG`；divergent branches 且未配置 `pull.rebase`（git 2.27+ 报错）→ 对话框直接询问 merge/rebase 并可写入配置。
- **AC**：各选项映射正确（单元测试）；squash pull 后 Commit TW 预填消息。
- **里程碑**：M2

### #78 `Vcs.UpdateProject`（`Ctrl+T`）
- **UI**：`Ctrl+T` / TitleBar Quick Action ⟳ / Main Menu `Git | Update Project…`。对话框「Update Project」：Update Type（Merge / Rebase / Reset to the Remote Branch，#79）、Clean working tree using（Stash / Shelve，#114）、「Don't show again」（之后 `Ctrl+T` 直接执行；可在 Settings | Confirmation「Show options before update」恢复）。执行中状态栏进度「Updating: fetching origin… (1/3 repos)」。完成：balloon「3 files updated in 2 commits — View Commits」（打开 #80），无变化 → toast「All files are up-to-date」。
- **实现**：`update_project_run{repoIds, strategy, cleanTree}` → CompositeJob：并行 `fetch`（所有 root 的 upstream remote）→ 每 root `update_branch`（见上）→ 汇总 Update Info。无 upstream 的 root 跳过并在结果中列出（「No tracked branch for 'feature' — Set upstream」）。
- **边界**：detached HEAD root 跳过；某 root 冲突 → 其他 root 继续，冲突 root 进入冲突流程，结果对话框列出；rebase 时存在 merge commits → 设置「Preserve merges」不提供（与 IDEA 一致：用 plain rebase），文档化。
- **AC**：多 root 一键更新；冲突 root 不影响其他 root；stash 的变更最终恢复或安全保留。
- **里程碑**：M2

### #79 Update strategies: Merge / Rebase / Reset to Remote
- **UI**：#78 对话框与 Settings | Git → Update → 「Update method: Merge / Rebase / Reset to the Remote Branch」（默认 Merge；`Branch default` 选项 = 读取 `branch.<b>.rebase`/`pull.rebase`）。Reset 选项旁警告图标「Discards local commits not on remote」，选择 Reset 时执行前二次确认并列出将被丢弃的本地 commits（`git log @{u}..HEAD`）。
- **实现**：见共享引擎；Reset 前 backup ref 保存旧 HEAD + 工作区快照；balloon 提供「Restore previous state」。
- **AC**：三种策略结果正确；Reset 可通过 Restore 回到原 HEAD（集成测试）。
- **里程碑**：M2

### #80 Update Info tab
- **UI**：Update/Pull 完成后（Settings「Show Update Info automatically」，默认开）Git TW 打开 **Update Info: <time>** tab（可多个，可关闭/固定）：左侧更新的文件树（按 repo/目录，状态：Updated / Created / Removed / Merged with conflicts），右侧这些 commits 的 Log 列表（`old..new`）；工具栏 Filter by path（「Filter Update Project info by paths」= 只显示与当前选中目录相关）、Show Diff、Expand/Collapse。双击文件 → diff old vs new。
- **实现**：`diff_refs{old,new}` name-status + `log_query{range}`；Update Info 数据持久化在会话中（tab 关闭释放）。
- **边界**：oldHead 不存在（unborn）→ 所有文件为 Created；rebase 导致本地 commits 重写 → 范围用 `old upstream..new upstream` 并说明。
- **AC**：文件与 commits 列表与 `git diff --name-status old new` / `git log old..new` 一致。
- **里程碑**：M2

### #81 Submodule update behavior
- **范围说明**：submodule 注册为 root = **#11 deferred**。此条只定义 superproject 更新时 submodule 的行为。**需协调者确认**。
- **UI**：Settings | Git → Update →「Update submodules after update: [Auto | Always | Never]」。Update Info 中 submodule 路径显示为特殊节点（「commit a1b2 → c3d4」）；Changes 中 submodule 变更（new commits / modified content / untracked content）以子模块图标显示，右键「Update Submodule」。
- **实现**：Update 完成后若 `.gitmodules` 存在且 submodule gitlink 变化：Auto/Always → `git submodule update --init --recursive --progress -- <changed paths>`（处于 detached 状态的子模块）；子模块若在某分支上（非 detached）→ 不强制 detach，提示「Submodule 'lib' is on branch 'x', updated pointer not checked out — Update / Ignore」（与 IDEA 一致：on-branch 子模块按分支 update）。
- **边界**：子模块认证/网络失败不回滚 superproject 更新，单独报告；嵌套子模块深度。
- **AC**：fixture（含 2 级子模块）更新后子模块指针与 checkout 一致。
- **里程碑**：M7

---

## Merge / Rebase / Cherry-pick

### #82 `Git.Merge` + options + Abort / Commit
- **UI**：Main Menu `Git | Merge…` 对话框：Git Root、「Merge into 'main'」、Branch(es) 选择（可多选 → octopus）、Modify options：`--no-ff`、`--ff-only`、`--squash`、`-m <message>`、`--no-commit`、`--no-verify`、`--allow-unrelated-histories`（命令预览）。Branches Popup「Merge 'x' into 'current'」直接执行（默认选项）。进行中：Repo State Banner「Merging 'feature' into 'main' — Resolve Conflicts / Abort Merge / Commit Merge」，VCS Widget 显示「Merging main」；`Git | Abort Merge`（`Git.Merge.Abort`）、Commit 区自动预填 `MERGE_MSG`，提交按钮文案「Commit Merge」（`Git.Merge.Commit`）。完成 balloon「Merged feature into main」/「Already up to date」/「Fast-forwarded」。
- **实现**：`merge_run{repoId, branches, opts}` → `git merge [opts] (-m <msg> | --no-edit) <branches>`（有 `-m` 时用用户消息，否则 `--no-edit` 使用默认消息；Write）；`merge_abort` → Safety Snapshot（冲突解决成果）→ `git merge --abort`；`merge_commit` → `git commit --no-edit`（或使用用户编辑的消息）。
- **边界**：工作区阻挡 → #83；unrelated histories 错误 → 对话框提供勾选重试；`--squash` 后不产生 MERGE_HEAD → 提示提交；octopus 冲突 git 直接失败 → 解释。
- **AC**：所有选项映射正确；冲突后 Banner 出现并能 Abort 恢复到合并前（包括 Abort 前的快照可 Restore）。
- **里程碑**：M4

### #83 Smart merge
- **UI**：merge/pull/rebase/cherry-pick 因本地未提交变更会被覆盖而失败时：对话框「Local changes would be overwritten by merge」列出文件 → **Smart Merge**（stash/shelve → 操作 → 恢复）/ **Show Files** / Cancel。（与 #22 共享组件 `DirtyWorktreeDialog`。）
- **实现**：通用包装器 `with_clean_tree(op, method)`（#114）；恢复冲突 → Conflicts 对话框标题「Conflicts while restoring local changes」，stash 保留并标注。
- **AC**：Smart Merge 成功后用户变更完整恢复；恢复冲突时 stash 不丢失。
- **里程碑**：M4

### #84 `Git.Rebase` + options
- **UI**：Main Menu `Git | Rebase…` 对话框：Git Root、当前分支（可选「Switch to another branch」= 先 checkout 再 rebase）、onto（RefPicker）、Modify options：`--onto`（出现第二个字段 upstream）、`--interactive`（→ #86 编辑器）、`--rebase-merges`、`--keep-empty`、`--root`、`--update-refs`（git ≥2.38，否则禁用+原因）、`--autosquash`；命令预览。
- **实现**：`rebase_run{repoId, upstream, onto?, opts}` → `git rebase [opts] [--onto <onto>] <upstream> [<branch>]`；interactive → #86 流程；进度：解析 `rebase-merge/msgnum`/`end` 推送 `repo://state{step,total}`。
- **边界**：protected 分支被 rebase（会改写已推送历史）→ 警告；工作区脏 → #83（或 `--autostash` 选项映射到 Smart）；rebase 后 upstream 跟踪不变。
- **AC**：选项映射单元测试；`--update-refs` 在 stacked branches fixture 中正确移动依赖分支。
- **里程碑**：M4

### #85 Branch popup rebase variants
- **UI**：Branches Popup/pane 分支子菜单：**Checkout and Rebase onto 'current'**、**Rebase 'current' onto 'x'**、（remote 分支）**Pull into 'current' Using Rebase** / **Using Merge**。动作标题动态包含分支名。
- **实现**：Checkout and Rebase：`git rebase <current> <x>`（git 自动 checkout x）；Rebase current onto x：`git rebase <x>`；Pull into using rebase：`git pull --rebase <remote> <branch>`。
- **AC**：四个变体结果与对应 CLI 一致。
- **里程碑**：M4

### #86 Interactive rebase（Pick / Edit / Reword / Squash / Fixup / Drop）
- **UI**：入口：Log commit 右键 **Interactively Rebase from Here…**（`Git.Interactive.Rebase`）、Rebase 对话框 `--interactive`。编辑器对话框（大尺寸，可调）：表格行 = commits（旧→新，或可切换顺序显示），列：Action（下拉/快捷键 `P`ick、`E`dit、`R`eword、`S`quash、`F`ixup、`D`rop）、hash、subject（Reword 时可就地编辑多行消息，`F2`）、author、date；拖拽或 `Alt+↑/↓` 重排；工具栏 Pick/Edit/Reword/Squash/Fixup/Drop/**Reset**（撤销所有修改）；右侧显示所选 commit 的 Changed Files；Squash 组合时预览合并消息并允许编辑；按钮 **Start Rebasing** / Cancel。不可用场景：范围内有 merge commit（提示用 `--rebase-merges` 命令行或 Rebase 对话框）、非当前分支的 commit、protected 分支上已推送的 commit → 动作 disabled + 原因。进行中 `edit` 停止：Banner「Rebase stopped for editing at a1b2c3 (3/7) — Continue / Skip / Abort」，用户可修改并 Amend。
- **实现**：计划保存 `gitx/rebase-plan.json`；`rebase_interactive_start{base, plan}` → `GIT_SEQUENCE_EDITOR=<gitx-helper seq-editor>`（helper 通过 IPC 取回 plan 写入 todo）、`GIT_EDITOR=<gitx-helper editor>`（reword/squash 消息：预先准备的消息直接返回，未准备时 `editor://request` 弹出对话框）→ `git rebase -i <base>`。**纯 reword/重排无冲突风险的快速路径**：仅 reword（不改 tree）时用 in-memory `commit-tree` 重建链 + `update-ref`（见 #108），无需工作区干净。
- **边界**：Safety Snapshot（旧 HEAD backup ref）+ 完成 balloon「Rebase finished — Undo」（reset 回旧 HEAD，若工作区干净）；squash 消息编辑对话框被取消时，git 本身会以默认消息继续；gitx 的策略是把「取消」解释为 Abort rebase，并先弹确认。
- **AC**：6 种动作 + 重排组合结果与 CLI 等价（集成测试比对 tree/消息）；冲突/edit 停止时状态机与 Banner 正确；Undo 恢复。
- **里程碑**：M5

### #87 Rebase Abort / Continue / Skip
- **UI**：Repo State Banner、VCS Widget popup 顶部（`Ongoing.Rebase.Actions`）、Main Menu `Git | Rebase` 组：**Continue Rebase**（冲突全部解决才可用）、**Skip Commit**、**Abort Rebase**（确认）。Continue 时如需消息编辑 → editor 对话框。
- **实现**：`rebase_continue` → `git -c core.editor=<helper> rebase --continue`；`rebase_skip`；`rebase_abort` → Safety Snapshot（当前已解决内容）→ `git rebase --abort`。
- **边界**：外部终端中开始的 rebase 同样识别并可操作；`rebase-apply`（am 方式）同样支持。
- **AC**：三动作在冲突/非冲突停止点行为正确，Banner 进度 n/m 实时更新。
- **里程碑**：M4

### #88 Cherry-pick + Abort / Continue
- **UI**：Log commit（可多选，按拓扑顺序应用）右键 **Cherry-Pick**（工具栏 🍒 按钮）；当前分支已包含（patch-id 等价）的 commit → 提示「already cherry-picked」可跳过。冲突 → 冲突流程，Banner「Cherry-picking a1b2 (2/5) — Continue / Skip / Abort」（`Git.CherryPick.Continue|Abort`）。成功 balloon「Cherry-picked 3 commits — Undo」。
- **实现**：`cherry_pick_run{shas, suffix}` → `git cherry-pick [-x] <shas…>`（多 commit 由 git sequencer 处理）；continue/skip/abort → `git cherry-pick --continue|--skip|--abort`；Undo → reset --keep 到旧 HEAD（备份）。
- **边界**：merge commit cherry-pick → 需 `-m <parent>`：对话框选择 parent；空 cherry-pick（变更已存在）→ 提示 `--allow-empty`/skip；changelist 模式下 IDEA 会把冲突后的结果放入新 changelist 再提交——gitx 采用 git 原生流程（提交区预填 `CHERRY_PICK_HEAD` 消息）。
- **AC**：多 commit cherry-pick 顺序正确；冲突后 Continue 完成剩余；Undo 有效。
- **里程碑**：M4

### #89 Cherry-pick suffix for protected
- **UI**：Settings | Git → Commit →「Add the 'cherry-picked from <hash>' suffix when picking commits pushed to protected branches」（默认开）。
- **实现**：源 commit 若包含在某 protected 分支的 remote-tracking ref 中（`git branch -r --contains <sha>` 与 protected glob 匹配）→ 对该 commit 加 `-x`（分组调用，保持顺序：按连续段分批 cherry-pick）。
- **AC**：从 `origin/main` 摘取的 commit 消息含 `(cherry picked from commit …)`，从私有分支摘取的不含。
- **里程碑**：M4

### #90 Highlight cherry-picked commits
- **UI**：Log 中当选中分支过滤或 Compare（#26）时，已在目标分支以等价补丁存在的 commits 灰显（`--commit-cherry-picked` token）并 tooltip「Already in 'main' as d4e5f6」。Graph Options 中开关「Highlight cherry-picked commits」（`Git.Log.HighlightCherryPickedCommits`）。
- **实现**：`git log --cherry-mark --left-right --format=%m%H <current>...<other>`（`=` 标记等价）；结果缓存于 logStore，refs 变化失效；大范围限制 5000 commits。
- **AC**：fixture 中 cherry-pick 过的 commit 正确灰显。
- **里程碑**：M3

### #91 Apply / Get file from revision
- **UI**：Log → Changed Files 中文件右键 **Get from Revision**（将该 revision 的文件版本写入工作树）、**Cherry-Pick Selected Changes**（IDEA 文档「Apply separate files」：把该 commit 中所选文件的变更应用到当前工作区，作为本地修改）；File History 中「Get」（#104）。
- **实现**：Get → `git restore --source=<sha> --worktree -- <path>`（先快照当前文件）；Apply selected changes → `git diff <sha>^ <sha> -- <paths> | git apply --3way`（经 stdin），冲突 → 冲突流程（index 中的 unmerged 条目）。
- **边界**：文件在该 revision 被删除 → Get = 删除本地文件（确认）；root commit 无父 → 使用空树 `4b825dc…`。
- **AC**：获取/应用结果正确且可通过 Rollback 撤销。
- **里程碑**：M3

### #92 Extract / Drop selected changes
- **UI**：Log → 选中本地未推送 commit → Changed Files 中多选文件（或 diff 中选 hunks）右键：**Extract Selected Changes to Separate Commit…**（`Git.InMemory.Extract.Selected.Changes`，弹出消息输入）、**Drop Selected Changes**（`Git.Drop.Selected.Changes`，确认）。HEAD 及其祖先（无 merge）可用；protected 已推送不可用。
- **实现**（in-memory，不触碰工作区）：
  1. 设目标 commit C、父 P。构造 tree T1 = P + 未选变更、T2 = C 的完整 tree：在临时 index 中 `read-tree P` → 应用未选部分 → `write-tree` 得 T1。
  2. Extract：C' = commit-tree(T1, parent P, 原消息)；C'' = commit-tree(C.tree, parent C', 新消息)。Drop：C' = commit-tree(T1, parent P, 原消息)，然后后续 commits 需在新的基上重放。
  3. 后续 commits 重放：git ≥2.38 用 `git merge-tree --write-tree` 逐个 in-memory 计算；出现冲突 → 放弃 in-memory，回退为常规 `rebase --onto`（需要干净工作区，走 #83）。
  4. `git update-ref -m "gitx: extract changes" refs/heads/<b> <new> <old>`（CAS）+ backup ref + Undo。
- **AC**：Extract 后历史多出一个 commit 且最终 tree 不变；Drop 后最终 tree 去除所选变更；工作区未被触碰。
- **里程碑**：M5
