# Part 2.5 — Conflicts / Diff / Patch（#93–101）· Log / History / Annotate / Edit History（#102–110）

> 返回索引：[../dev-plan.md](../dev-plan.md) · 框架：[01-framework.md](./01-framework.md) · 条目模板见 [02](./02-setup-remotes.md) 顶部。

---

## Conflicts / Diff / Patch

### #93 Conflicts dialog（Yours / Theirs / Manual）
- **UI**：任何操作（pull/merge/rebase/cherry-pick/revert/unstash/unshelve/apply patch）产生冲突后自动弹出「Conflicts」对话框（非模态可关闭，之后可从 Banner/`Git | Resolve Conflicts…` 重新打开）：标题按来源「Merging 'feature' into 'main'」/「Rebasing … (3/7)」，列头显示 **Yours** / **Theirs** 的具体含义（rebase 时 Yours = 上游、Theirs = 正在应用的 commit——必须用分支名/commit 标注避免混淆）。表格：文件、Yours 状态、Theirs 状态（modified/deleted/added）、类型（content / delete-modify / add-add / rename / binary / submodule）。按钮：**Accept Yours**、**Accept Theirs**、**Merge…**（打开 #94，双击同效）、**Resolve All Simple Conflicts**（魔棒：对所有文件自动应用无冲突块，全部可自动解决的文件直接标记已解决）；全部解决后对话框提示「All conflicts resolved — Continue Rebase / Commit Merge」。Commit TW 中 **Merge Conflicts** 节点（红色）同等动作（`Git.ChangesView.AcceptYours|AcceptTheirs|Merge`）。
- **实现**：`conflicts_list` → `git ls-files -u -z`（stage 1/2/3）+ status unmerged 类型；`conflict_accept_side{paths, side}` → `git checkout --ours|--theirs -- <p>` + `git add`（delete-modify：接受删除 → `git rm`）；二进制只能整边接受；状态写入 `conflictsStore`，由 `repo://changed` 驱动刷新。
- **边界**：rebase 中 ours/theirs 语义翻转（标签由 RepoOpState 决定）；路径大小写冲突；子模块冲突（只能选 sha）；外部工具/终端中解决 → 自动从列表消失。
- **AC**：各冲突类型均可解决；Yours/Theirs 标签在 merge 与 rebase 中都与用户直觉一致（可用分支名核验）。
- **里程碑**：M4

### #94 Three-way merge editor
- **UI**：编辑区 tab（或对话框窗口，设置）：三栏 **Changes from <yours>**（左，只读）| **Result**（中，可编辑）| **Changes from <theirs>**（右，只读）；连接带与块背景色（冲突红、修改蓝、新增绿、删除灰）；每个块左右侧 `>>`/`<<` 接受、`×` 忽略；工具栏：Apply All Non-Conflicting Changes（左/右/全部）、**Resolve Simple Conflicts**（魔棒，块级）、Compare with Base（Left/Result/Right vs Base 切换显示）、Next/Prev Conflict（`F7`/`Shift+F7`）、Ignore whitespace、Highlight words、**Revert conflict resolution**（恢复到初始冲突态）、Accept Left / Accept Right（整文件）、**Apply**（= Accept and Finish：保存并 `git add`；仍有未处理块时确认）。底部状态「2 conflicts, 1 change left」。Settings | Tools | Diff & Merge →「Automatically apply non-conflicting changes」（打开时自动应用）。
- **实现**：`conflict_versions{path}` → base/ours/theirs 内容（`git show :1:p` `:2:p` `:3:p`）；`gitx-diff::merge3` 计算三方块（基于 diff3：base→ours、base→theirs 对齐，块分类 non-conflicting-left/right/both-same/conflict，并提供「simple conflict」自动合并判定 = 两侧修改不重叠的行级合并）；前端三个 CodeMirror 实例 + 同步滚动 + SVG 连接带；`conflict_save_result{path, content}` 写文件（保持 EOL/编码）→ `git add`。
- **边界**：超大文件（>2MB）降级为双栏选择；无 base（add/add）→ 空 base；EOL 混合；文件编码非 UTF-8（按 `.gitattributes working-tree-encoding` / 检测）；关闭未保存 → 提示。
- **AC**：典型冲突 fixture（10 块）可完全键盘完成；Revert 恢复初始态；保存结果与手工期望一致。
- **里程碑**：M4

### #95 Abort Merge / Resolve Conflicts actions
- **UI**：Main Menu `Git | Resolve Conflicts…`（`Git.ResolveConflicts`，有冲突时可用）、`Git | Abort Merge`（及 Abort Rebase/Cherry-pick/Revert，按当前状态显示其一）；同样出现在 VCS Widget popup 顶部与 Banner。
- **实现**：Action enable 规则读 RepoOpState；Abort 前 Safety Snapshot 保存已解决的工作成果（`stash create` 包含 index 解决状态不可行时，至少保存工作树文件内容到 backup commit）。
- **AC**：任一进行中状态均有对应 Abort；Abort 后状态回 Normal 且可从备份恢复已解决内容。
- **里程碑**：M4

### #96 CRLF warning
- **UI**：Settings | Git → Commit →「Warn if CRLF line separators are about to be committed」（Windows 默认开）。提交时若满足（`core.autocrlf` 未设或 false，且待提交文本文件含 CRLF 且无 `.gitattributes` eol 规则）→ 对话框「Line Separators Warning」：**Fix and Commit**（执行 `git config --global core.autocrlf true` 并重新 stage 这些文件后提交）/ **Commit As Is** / Cancel + 「Don't warn again」。
- **实现**：`commit_checks_run` 中扫描 blob（只扫 text，`git check-attr -z text eol --stdin`）。
- **AC**：Windows fixture 中触发警告；Fix 后提交的 blob 为 LF。
- **里程碑**：M2

### #97 Diff Viewer（side-by-side / unified / ignore rules）
- **UI**：编辑区 tab（Settings | Diff：在 editor tab 还是独立窗口；Commit TW 双击打开 Diff 或 Source）。工具栏：**Side-by-side / Unified** 切换、**Ignore whitespace**（Do not ignore / Trim whitespaces / Ignore whitespaces / Ignore whitespaces and empty lines）、**Highlight**（words / lines / split / none）、Collapse unchanged fragments（默认开，上下文行数可设）、Sync scroll、Show line numbers、Next/Prev difference `F7`/`Shift+F7`、Next/Prev file `Ctrl+Alt+Shift+↓/↑`（`Vcs.Diff.*`）、Jump to source `F4`、Compare with…（切换比较对象：HEAD/Staged/Local/Branch）、Open in external tool（#119）。左右标题显示 revision（`a1b2c3 (main)` / `Local`），右侧 Local 可编辑并自动保存（staging 模式：Staged 侧也可编辑 = 修改 index 内容）。特殊内容：二进制（大小/哈希对比）、图片（并排 + 叠加差异 + 像素尺寸）、过大文件（「File is too large (12 MB) — Show anyway」）、仅模式/权限变化（显示 `100644 → 100755`）、符号链接目标变化、rename（显示相似度）。Changes 中按 `Ctrl+D` 打开，多文件选中时 diff 内可用 `Alt+←/→` 文件间切换（文件链）。
- **实现**：`diff_file`（Rust 计算 hunks 与 word ranges，ignore 模式参数）；FE `DiffViewer`（CodeMirror 6，两个 EditorView + 对齐填充块 + 连接带；unified 单 view + 删除行 widget）；大文件流式加载；`diffStore` 会话保存 scroll 与选项（全局记忆）。
- **边界**：编码检测（BOM/`.gitattributes`/chardet 回退）与显示；超长行（>10k 字符）折叠；无末尾换行标识；Windows 下 `\r` 显示设置。
- **AC**：10k 行文件 ≤150ms 呈现；四档 ignore whitespace 结果与 `git diff -w/-b/--ignore-blank-lines` 一致；键盘全流程可用。
- **里程碑**：M1（基础双栏/unified、hunk stage）· M3（全部选项）

### #98 Combined Diff
- **UI**：IDEA 新版「Combined Diff」= 多文件单页滚动 diff。入口：Commit TW 选中多个文件/整个 changelist 右键 **Show Combined Diff**、Log 中 commit 详情「Show All Changes」（双击 commit）。单页按文件分段（文件头可折叠、sticky 文件名、文件内 hunk 操作同 #97），左侧文件导航条同步高亮。merge commit：可切换显示与每个 parent 的差异或 `--cc` 组合视图（#10.4 审查合并结果）。
- **实现**：`diff_combined_stream{selection}`（Channel 流式推送每个文件的 hunks；文件内容懒加载，只渲染视口附近文件）；merge commit 组合视图 `git diff-tree --cc -p`。
- **边界**：1000+ 文件 → 虚拟化分段，只计算可见文件 diff；超大文件默认折叠。
- **AC**：500 文件 commit 打开 ≤ 1s 首屏，滚动流畅。
- **里程碑**：M3

### #99 Compare with Revision / Branch or Tag
- **UI**：文件（Changes 树、FileViewer、History）右键 `Git | Compare with Revision…`（弹出该文件的历史 commits 列表选择）、`Git | Compare with Branch or Tag…`（RefPicker）、`Compare with the Same Repository Version`（= HEAD）；目录上 Compare with Branch → 文件列表视图（同 #27）。
- **实现**：`diff_file{left: <rev>:path（考虑 rename：rev 中的旧路径通过 `log --follow` 映射）, right: WORKTREE}`。
- **边界**：文件在目标 revision 不存在 → 提示「File did not exist in <rev>」并提供显示为全新增。
- **AC**：rename 过的文件与重命名前的 revision 比较正确。
- **里程碑**：M3

### #100 Compare two commits
- **UI**：Log 中选中两个 commit 右键 **Compare Versions**（Changed Files 区显示 A..B 差异文件列表，`Ctrl+D` 打开 diff）；单个 commit 右键「Compare with Local」（commit vs 工作树，文件列表）。
- **实现**：`diff_refs{a, b}` → `git diff --name-status -z -M <a> <b>`。
- **AC**：结果与 `git diff a b` 一致；顺序按时间旧→新自动调整（可 Swap）。
- **里程碑**：M3

### #101 Create / Apply Patch（+ clipboard, reverse）
- **UI**：**Create Patch**：Commit TW 选中文件/changelist 右键 `Create Patch…`、Log commit(s) 右键 `Create Patch…`、History 中右键；对话框：保存路径、Base path（默认 repo root）、Encoding、「Reverse patch」、Format（Unified diff / Git format-patch（多 commit 时生成多个 `.patch`））。**Copy as Patch to Clipboard**（菜单项，无默认快捷键）。**Apply Patch**：Main Menu `Git | Patch | Apply Patch…`（文件选择，支持拖入 `.patch`）/ `Apply Patch from Clipboard…`；预览对话框：受影响文件列表与每文件 diff 预览（可取消勾选文件）、目标 changelist、Base directory（可修改，失配时自动搜索最佳 strip 层级）；Apply 后冲突 → 冲突流程（3-way）。Git 格式 patch（含 From/Subject）→ 应用后将 author 与 message 预填到 Commit 区（IDEA 行为），或提供「Apply as commit (git am)」选项。
- **实现**：Create → `git diff --binary [--cached|<rev>…] -- <paths>` / `git format-patch --stdout <range>`，reverse = 交换两侧（`-R`）；编码转换在 Rust。Apply → `patch_apply_check` = `git apply --check --3way -p<n> --directory=<base>`（stdin）→ 预览；`patch_apply{paths filter → --include}` → `git apply --3way`；`git am --3way` 可选。
- **边界**：剪贴板中不是 patch → 禁用并提示；CRLF patch；二进制 patch 需 `--binary` 生成；部分 hunk 失败（无 3way 基）→ 报告并生成 `.rej` 选项。
- **AC**：Create→Apply 往返一致；剪贴板流程可用；git am 选项保留作者。
- **里程碑**：M6

---

## Log / History / Annotate / Edit History

### #102 Log tab panes + filters + graph options
- **UI**：Git TW → **Log** tab（固定），可新建多个 Log tab（`+` 或「Open in New Tab」保留过滤）。布局：**Branches pane**（左，通过工具栏按钮显示/隐藏）| **Commits**（中：graph + subject + ref 胶囊 + author + date，可配置列；本地未推送 commit 粗体）| **Changed Files**（右上，树，状态色）| **Commit Details**（右下：完整 hash（可复制）、parents、author/committer、日期、消息（链接化 hash/issue）、所在分支 `Contained in branches`（懒加载 `branch -a --contains`）、tags、签名状态）。过滤栏：文本搜索（`Ctrl+L`；选项 Regex / Match case / 搜消息或 hash）、**Branch**（多选、`a..b`）、**User**（me / 多选）、**Date**（Last 24h / 7 days / 自定义）、**Paths**（选择文件/目录）、**Repository**（多 root）；过滤 chip 可单独清除。**Go to Hash/Branch/Tag**（`Ctrl+F`/Mod+F）。Graph Options（眼睛图标）：Sort by **Date / Topological**、**Show First Parent**、**No Merges**、Expand Linear Branches / Collapse、**Compact References**、Show **Tag Names**、Show long edges（默认省略穿越大量行的边，显示箭头可点击跳转）。多 root 时左侧彩色 stripe 标识 repo。右键菜单（`Git.Log.ContextMenu`，按选择数量与 commit 是否在当前分支/是否已推送启用）：Copy Revision Number、Create Patch、Cherry-Pick、Checkout Revision、Show Repository at Revision、Compare with Local、Reset Current Branch to Here…、Revert Commit、Undo Commit、Edit Commit Message…（`F2`）、Fixup…、Squash Into…、Drop Commits、Squash Commits…、Interactively Rebase from Here…、Push All up to Here…、New Branch…、New Tag…、Go to Child/Parent Commit（`←/→`）。空状态：无 commits（unborn）「No commits yet」；过滤无结果「No commits matching filters — Clear filters」；错误：ErrorState + Retry。加载：首屏骨架，后续页滚动加载。
- **实现**：
  - 数据：`log_query{repoIds, filters, order, requestId}`（Channel）。无过滤或仅 branch 过滤 → gix rev-walk（commit-graph 加速）；文本/user/date/path 过滤 → 有 index（#103）走 SQLite，否则 `git log --format=%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D%x1e [--grep/--author/--since/--until/-i/-E] -- <paths>` 流式。
  - 图：`gitx-graph` 增量 lane 分配（输入 commits 按序 + parents），输出每行 `{ node lane, edges[{fromLane,toLane,type}], color }`，分页 1000 行；颜色按「分支头」稳定分配；长边截断规则。
  - 前端：`LogGraph`（固定行高 22px 虚拟列表；每可见行用 canvas 绘制 graph cell）；`logStore`（多实例）；Commit Details 按需 `log_commit_details{sha}`（`git show -s --format=…`；签名状态用 `%G?`，作为可选列）。
  - refs 胶囊来自 branchesStore（避免 `%D` 解析不一致，`%D` 只作为 fallback）。
- **边界**：1M+ commits 首屏 ≤400ms（只算第一页 graph）；commit 消息含非 UTF-8（`i18n.commitEncoding`）；grafted/shallow 边界；`--first-parent` 与 graph 布局同步；refs 变化时增量插入新 commits 而非整体重载（保持选中与滚动）。
- **AC**：性能预算达标（1.14.3）；过滤组合正确（与 CLI 对比的集成测试）；所有右键动作按状态正确启用并给出 disabled 原因。
- **里程碑**：M1（基础：commits+graph+details+changed files）· M3（完整过滤/选项/右键）

### #103 Git Log Indexing
- **UI**：Settings | Version Control | Log →「Enable Git Log Indexing」（默认开）；状态栏首次索引时显示「Indexing commits… 45%」（可暂停）；Log 过滤栏在索引未完成时显示小提示「Indexing… results may be slower」。设置页可「Rebuild index」、按 repo 排除（超大仓库）。
- **实现**：`gitx-index` crate：SQLite（WAL）于 `<common-dir>/gitx/log-index.sqlite`，表 `commits(id, sha, author_id, committer_id, time, parents)`、`authors`、`messages`（FTS5 trigram，支持中文子串）、`paths(id, path)`、`commit_paths(commit_id, path_id, change_type, rename_from)`；首次后台遍历（gix rev-walk 所有 refs + 逐 commit 计算 changed paths，低优先级线程，可中断续跑）；增量：refs 变化时只索引新可达 commits。用途：文本/作者/日期/路径过滤、File History 跨所有分支（#104）、Go to Hash 快速定位、行号定位（#38 Jump）。
- **边界**：force push / gc 后不可达 commit 留存在 index 中 → 查询时以「当前 refs 可达性」过滤（维护 reachability bitmap 或查询后验证）；索引损坏 → 自动重建；磁盘占用上限提示。
- **AC**：linux kernel 仓库索引完成后作者+关键词过滤 ≤300ms；索引过程 CPU 占用受限且 UI 不受影响。
- **里程碑**：M3

### #104 File / Folder / Selection History
- **UI**：文件右键 `Git | Show History`（Changes/FileViewer/Log Changed Files/Repository at Revision 中）→ Git TW 新 tab「History: path」：commit 列表（graph 简化）+ 右侧 diff（所选 revision vs 上一版本）；工具栏：**Branch filter**（默认当前分支，可选全部分支——依赖 index 加速）、Show Diff（`Ctrl+D`）、**Show All Affected Files**（该 commit 全部变更）、**Annotate**（在该 revision 打开 #105）、**Get**（#91，把该版本取回工作区）、Compare with Local、Open Repository Version。**Folder history** → 打开 Log tab 并带 Paths 过滤。**Selection history**：FileViewer 选中行 → `Git | Show History for Selection` → 列表仅显示修改过这些行的 commits，diff 只展示相关区域。
- **实现**：文件历史 `git log --follow --name-status --format=… -- <path>`（流式，rename 链记录每个 commit 下的路径）；全分支：有 index 时由 `commit_paths` 查询；Selection → `git log -L <start>,<end>:<path> --format=…`（流式，可取消；大文件慢 → 进度提示）。
- **边界**：`--follow` 只支持单文件；rename 后路径在旧 commit 中不同 → diff 时使用对应旧路径；Selection history 在大历史上很慢 → 限定 Branch 并可取消。
- **AC**：重命名文件历史跨越 rename 完整；selection history 结果与 `git log -L` 一致。
- **里程碑**：M3

### #105 Annotate with Git Blame + options
- **UI**：FileViewer/Diff 的 gutter 右键 **Annotate with Git Blame**（`Annotate`，也在文件右键 `Git | Annotate`）；gutter 左侧注解列：日期 + 作者（短名）+ 可选 revision；颜色按 commit 新旧渐变（`--annotate-age-*`）或按作者着色；悬停 tooltip：commit 完整消息、作者、日期、hash（链接）；点击 → 在 Log 中定位该 commit（Show in Git Log）；右键注解：**Annotate Revision**（打开该 revision 的文件并 blame）、**Annotate Previous Revision**（跳过该 commit 看上一版本）、Show Diff、Copy Revision Number、**Hide Revision**（忽略某 commit，相当于 `--ignore-rev`）/ **Restore Hidden Revisions**、**View** 子菜单（Author/Date/Commit/Show Commit Timestamp、Names: full/initials/first/last/email）、**Colors**（按时间/按作者/无）、**Options**（Ignore Whitespaces `-w`、Detect Movements Within File `-M`、Detect Movements Across Files `-C`）、Close Annotations。项目根有 `.git-blame-ignore-revs` 时自动应用（提示可关闭）。
- **实现**：`blame_stream{path, rev, opts}` → `git blame --incremental [-w] [-M] [-C] [--ignore-rev …] [--ignore-revs-file …] <rev> -- <path>`（流式，先渲染已到达的行）；工作树有未提交修改时 blame 用 `--contents -`（stdin 传当前 buffer）使行号与编辑器一致，未提交行标记「Not Committed Yet」。
- **边界**：大文件（>20k 行）进度提示；二进制不可用；文件在 HEAD 不存在（新文件）→ 全部 Not Committed。
- **AC**：增量渲染首批行 ≤ 300ms；Annotate Previous Revision 跳转正确；忽略修订有效。
- **里程碑**：M3

### #106 Code author Code Vision
- **UI**：FileViewer 中每个「块」（gitx 无语言语义：以文件头 + 由 blame 聚合出的连续同作者段落 ≥ N 行为单元；对常见语言可用 Tree-sitter 识别函数/类，作为增强）上方显示 inlay「👤 Alice +2」（主要作者 + 其他人数）；点击 → 打开 Annotate 并滚动到该块。Settings | Editor → Code Vision →「Code author」开关。
- **实现**：基于 #105 blame 数据前端聚合；Tree-sitter（`web-tree-sitter` wasm，按需加载语法）为可选增强（M8 打磨）。
- **边界**：未提交修改块显示「You」；大文件关闭。
- **AC**：开启后 inlay 显示与 blame 一致，点击进入 annotate。
- **里程碑**：M6

### #107 Show Repository at Revision（含 #110 BrowseRepoAtRevision）
- **说明**：#107 与 #110 在 IDEA 中是同一能力的两个入口（`Vcs.ShowRepositoryAtRevision` / `Git.BrowseRepoAtRevision`），合并实现、分别验收入口。
- **UI**：Log commit 右键 **Show Repository at Revision**、Main Menu `Git | Browse Repository at Revision…`（#110：先输入/选择 revision）→ 编辑区 tab「Repository at a1b2c3」：左侧文件树（只读，懒加载目录），右侧文件只读查看（语法高亮、可 Annotate、Show History、Compare with Local、Get（取回到工作区））；顶部可切换 revision（RefPicker）。
- **实现**：`tree_list{rev, dir}` → gix tree 读取（fallback `git ls-tree -z --long <rev> -- <dir>/`）；`blob_read{rev, path}`（大小限制与二进制检测）。
- **边界**：submodule 条目显示 gitlink sha；符号链接显示目标；LFS 指针文件提示「LFS pointer」。
- **AC**：大仓库根目录展开 ≤ 200ms；两个入口都可用。
- **里程碑**：M3

### #108 Reword / Squash / Drop / Fixup / Squash Into
- **UI**：Log 右键（只对当前分支上的本地 commits，protected 分支上已推送的 commit disabled 并说明）：**Edit Commit Message…**（`F2`，`Git.Reword.Commit`；对话框编辑消息；也可从提交成功 balloon 进入）、**Fixup…** / **Squash Into…**（`Git.Fixup.To.Commit` / `Git.Squash.Into.Commit`：把**当前本地变更**（Commit TW 选中的）作为 fixup/squash 并入所选 commit，Squash Into 需要编辑合并消息）、**Squash Commits…**（多选，`Git.Squash.Commits`，消息编辑器预填合并消息）、**Drop Commits**（`Git.Drop.Commits`，确认，已推送时提示需要 force push）。完成 balloon 均带 **Undo**（恢复旧分支头，CAS 检查未被再次修改）。
- **实现**：
  - Reword：in-memory —— 从目标 commit 到 HEAD 用 `git commit-tree <tree> -p <parents…>` 重建链（tree 不变，保留 author/date/签名需求：若原 commit 签名且 `commit.gpgsign` → 新 commit 也签名 `-S`），最后 `update-ref` CAS；HEAD 即目标 → `git commit --amend --only -F`（不动 index）。
  - Squash（相邻）/ Drop / Fixup Into：优先 in-memory（`merge-tree --write-tree` 重放，git ≥ 2.38）；冲突或旧 git → 回退到 interactive rebase（#86 机制，自动生成 todo，需要干净工作区 → #83）。
  - Fixup/Squash Into 带本地变更：先 `commit --fixup=<sha>`（或 `squash!`）再 `rebase -i --autosquash`（同 #61 扩展）。
  - 所有改写前写 backup ref。
- **边界**：范围含 merge commit → disabled（说明）；目标 commit 不在当前分支 → disabled；已推送 → 警告 + 建议 force push（#72）。
- **AC**：五种动作对 fixture 的结果（tree/消息/父链）符合预期；in-memory 路径不触碰工作区与 index；Undo 恢复。
- **里程碑**：M5

### #109 Undo Commit / Revert Commit / Reset（Soft / Mixed / Hard / Keep）
- **UI**：
  - **Undo Commit**（`Git.Uncommit`，Log 中仅当前分支最新且未推送 commit 可用；提交成功 balloon 也提供）：变更回到本地（changelist 模式 → 对话框选择目标 changelist，默认新建「Undo <subject>」；staging 模式 → Staged）。
  - **Revert Commit**（`Git.Revert.In.Log`，可多选）：生成反向 commit（消息 `Revert "<subject>"`），冲突 → 冲突流程，`Git | Abort Revert`；**Revert Selected Changes**（Changed Files 中选文件）→ 反向变更作为本地修改。
  - **Reset Current Branch to Here…**（`Git.Reset.In.Log`；Main Menu `Git | Reset HEAD…` 输入 revision）：对话框四选一并带说明与受影响 commits/文件数量：**Soft**（保留所有变更为 staged）、**Mixed**（默认，保留为 unstaged）、**Hard**（丢弃一切——destructive，二次确认，列出将丢失的未提交文件）、**Keep**（保留本地变更，若冲突则失败）。
- **实现**：Undo → `git reset --soft HEAD~1`（changelist 模式随后将这些文件分配到选定 changelist；merge commit 不可 undo）；Revert → `git revert --no-edit [-m 1 for merge] <shas>`；Revert selected changes → `git diff <sha> <sha>^ -- <paths> | git apply --3way`；Reset → `git reset --soft|--mixed|--hard|--keep <rev>`，Hard/Keep 前 Safety Snapshot（`reset --hard` 不删除 untracked 文件，快照只需覆盖已跟踪文件），balloon「Reset to a1b2c3 — Undo」（`reset` 回 ORIG_HEAD 备份 + 恢复快照）。
- **边界**：Revert merge commit 需选择 mainline parent；Undo 已推送 commit 显示 disabled 并建议 Revert。
- **AC**：四种 reset 与 CLI 一致；Hard reset 后通过 Undo 完整恢复未提交变更（集成测试）。
- **里程碑**：M5

### #110 BrowseRepoAtRevision
- 见 **#107**（同一实现，`Git | Browse Repository at Revision…` 入口验收归此编号）。
- **里程碑**：M3
