# Part 2.3 — Local Changes / Changelists / Staging（#47–59）· Commit / Push（#60–74）

> 返回索引：[../dev-plan.md](../dev-plan.md) · 框架：[01-framework.md](./01-framework.md) · 条目模板见 [02](./02-setup-remotes.md) 顶部。

## 共享基础：两种本地变更模式

gitx 与 IDEA 一样支持两种互斥模式（#56 切换，per repo 可覆盖）：

| | **Changelist 模式**（IDEA 默认） | **Staging 模式**（Git 原生） |
|---|---|---|
| 树结构 | `Changes`（默认 active）+ 用户 changelists + `Unversioned Files` (+ `Ignored`) | `Staged` / `Unstaged` (+ `Unversioned`、`Ignored`、`Conflicts`) |
| index 角色 | gitx 管理的实现细节：提交所选文件时使用 `git commit --only` 或临时 index | 用户可见的一等对象 |
| 勾选语义 | 勾选 = 本次提交包含 | 提交 = 提交 index（勾选框隐藏） |
| 部分提交 | diff 中 chunk/行 checkbox（#66） | stage 行/块（#57） |

**gitx 首个切片先做 Staging 模式**（与 Git 心智一致、实现直接），M6 再上 Changelist 模式；默认模式在 M6 完成后改为与 IDEA 一致的 Changelist。

**status 模型**：`status_get` → `git --no-optional-locks status --porcelain=v2 -z --branch --show-stash --untracked-files=all [--ignored=matching]`，解析为 `FileChange { path, origPath?, indexStatus, worktreeStatus, kind: modified|added|deleted|renamed|copied|typechange|unmerged|untracked|ignored, submodule?, conflictKind? }`。gitx-meta 叠加 changelist 归属。前端 `changesStore` 按模式构建树，增量 diff 保持展开与选择。

**diff 数据**：`diff_file{repoId, path, left: Revision|INDEX|WORKTREE, right: …}` 返回 `{ leftText|binary|tooLarge, rightText…, hunks: Hunk[], encoding, eol }`；hunks 由 `gitx-diff`（imara-diff，histogram 算法，支持 ignore whitespace 三档）计算，含 word-level ranges。行级 stage/revert 都在 Rust 侧**基于内容构造目标文本**完成（见 #57）。

---

### #47 Commit tool window（`Alt+0`）
- **UI**：左侧 tool window（`Alt+0` 切换/聚焦）。自上而下：Repo State Banner（进行中操作/冲突）→ 工具栏（Refresh `Mod+R`、Rollback `Ctrl+Alt+Z`、Show Diff `Ctrl+D`、New Changelist / Stage All、Group By ▾（Directory / Module=顶层目录 / Repository）、Expand/Collapse All、⚙ Show Ignored / Show Unversioned / Commit options）→ ChangesTree → 提交区（Amend 复选、消息编辑器、选项齿轮 → #63/#64/#65、**Commit** 按钮 + 下拉 **Commit and Push…**）。空状态：「No local changes」+ 上次 commit 摘要 + Fetch / Pull 按钮；加载：骨架行；错误：ErrorState + Retry。
- **实现**：`features/commit/CommitToolWindow.vue`、`ChangesTree`、`CommitMessageEditor`（CodeMirror 单栏，subject 标尺）；stores `changesStore`、`commitStore`。
- **边界**：80k 文件仓库：先显示「Refreshing…」不阻塞；切换 repo 保留各自消息草稿。
- **AC**：`Alt+0` 打开并聚焦树；树键盘导航（↑↓←→、Space 勾选、Enter = diff）；状态色正确。
- **里程碑**：M1

### #48 Default Changes + Unversioned lists
- **UI**：Changelist 模式默认节点 `Changes`（active，加粗）与 `Unversioned Files`（可折叠，数量徽标，>5k 时目录汇总视图）；Staging 模式为 `Staged` / `Unstaged` / `Unversioned Files`。节点右键：Changes → Commit、Rollback、Shelve、Create Patch、Move to Changelist、Set Active；Unversioned → Add to VCS、Add to .gitignore（#115）、Delete（回收站）。Unversioned 不提供 Shelve（与 IDEA 一致）。
- **实现**：树构建纯函数（单元测试覆盖 rename/copy/typechange/unmerged）。
- **边界**：rename 显示 `old → new`；typechange（文件↔symlink）显示特殊图标；大小写-only rename（Windows/macOS）。
- **AC**：节点计数与 `git status` 一致；rename 检测与 git 一致。
- **里程碑**：M1

### #49 Show Ignored Files
- **UI**：工具栏 ⚙ → **Show Ignored Files**（平台动作）；显示 `Ignored Files` 节点（橄榄色），按目录聚合（`build/` 一行显示数量），右键：Add to VCS (force)（#8）、Open .gitignore at rule（跳转到匹配规则行）、Delete。
- **实现**：`ignored_list` → `git status --porcelain=v2 -z --ignored=matching --untracked-files=normal`（目录级），展开目录时再 `git ls-files -z --others --ignored --exclude-standard -- <dir>`；规则来源 `check-ignore -v`。
- **边界**：`node_modules` 等巨型目录永不预展开；关闭时不计算（性能）。
- **AC**：打开/关闭切换不卡顿；规则跳转准确。
- **里程碑**：M6

### #50 New / Rename / Remove / Set Active changelist
- **UI**：工具栏「New Changelist」（`ChangesView.NewChangeList`），对话框 Name + Comment + 「Set active」；changelist 右键 Rename（`F2`）、Delete（非空时询问移动目标）、Set Active；双击 changelist 名 = 编辑；active 列表加粗。提交区标题显示「Commit to 'Changes'」。
- **实现**：gitx-meta `changelists.json`（`<git-dir>/gitx/`，per worktree）：`{ lists: [{id, name, comment, active}], assignments: { path → listId | { hunkRanges } } }`；新出现的变更归入 active。BE `changelist_create/rename/delete/set_active`。每个 changelist 的消息草稿独立保存（IDEA 行为）。
- **边界**：默认 `Changes` 不可删除；文件变更消失（被 revert）→ 分配记录自动清理；名称唯一。
- **AC**：重启后 changelists 与分配保持；删除非空 list 时文件移动到目标。
- **里程碑**：M6

### #51 Move to Another Changelist（`Alt+Shift+M`）
- **UI**：文件/多选右键 **Move to Another Changelist…**（`Alt+Shift+M`）→ 小弹窗列出 changelists + 「New Changelist…」；支持拖拽文件到 changelist 节点。
- **实现**：`changelist_move{paths, target}`（仅 meta 写入）。
- **AC**：拖拽与快捷键结果一致；可撤销（toast Undo）。
- **里程碑**：M6

### #52 Per-hunk / per-line changelists
- **UI**：Settings | Version Control | Changelists → 「Allow putting changes within one file into different changelists」（默认开）。Diff 视图中每个 hunk 侧边显示所属 changelist 色条；hunk 右键/工具按钮 **Move Lines to Another Changelist**；文件同时属于多个 list 时在每个 list 中出现，图标显示「部分」。
- **实现**：assignments 中保存 `hunkRanges`：以 **内容锚点**（hunk 前后各 3 行上下文 + 变更行哈希）定位，文件变化后用模糊匹配重新映射；无法映射 → 归入 active 并在 Notifications 提示。提交某 changelist 时，对涉及的部分文件走 #66 临时 index 构造。
- **边界**：同一 hunk 被拆分（行级）→ 拆为多个虚拟 hunk；外部编辑重排代码 → 尽力映射。
- **AC**：同一文件两个 hunk 分属两个 list，分别提交后各自 commit 只含对应 hunk（集成测试）。
- **里程碑**：M6

### #53 Changelist conflict dialog + settings
- **UI**（gitx 适配：编辑可能发生在外部编辑器）：Settings | Changelists → 「When a file in an inactive changelist is modified: [Show notification | Do nothing]」、「Highlight files with changelist conflicts」、「Ignore files: [patterns]」。当 inactive list 中的文件被再次修改（gitx FileViewer 中编辑时为**对话框**，外部修改为 **balloon**）：动作 **Shelve Changes** / **Move Changes to Active Changelist** / **Switch Active Changelist** / **Ignore**。
- **实现**：watcher 修改事件 × assignments；gitx 内编辑在首次键入时同步检查。
- **AC**：外部修改 inactive list 文件后出现 balloon 且四个动作有效。
- **里程碑**：M6

### #54 File status colors + directory highlight
- **UI**：树/Log Changed Files/Branches diff 中文件名按状态着色（vcs-tokens）；Settings | Version Control | Confirmation →「Highlight directories that contain modified files」（目录名用 modified 色）；Settings | File Status Colors 页可覆盖每种状态亮/暗颜色并即时预览。
- **实现**：`statusColor(kind)` 单一函数 + CSS 变量覆盖写入 settings。
- **AC**：所有调色板下颜色对比度达标；自定义颜色即时生效。
- **里程碑**：M1（设置页 M8）

### #55 Editor gutter markers + line rollback / diff
- **UI**：gitx 的 **FileViewer**（编辑区打开工作树文件：Changes 中 `F4` / 右键 Open File / Log Changed Files「Open Local File」）左侧 gutter 色条：绿=新增、蓝=修改、灰三角=删除。点击色条弹出小面板：上一个/下一个变更、**Rollback Lines**（`Ctrl+Alt+Z`，`Vcs.RollbackChangedLines`）、**Show Diff**（内嵌 mini diff 显示旧内容）、**Stage**（staging 模式）、Move to Changelist、**Commit this change**（#67）、Copy old text。Settings | Confirmation「Highlight modified lines in gutter」。
- **实现**：FE CodeMirror gutter extension；比较基准 = HEAD（changelist 模式）或 index（staging 模式）。前端在编辑过程中用 JS 侧轻量 diff（`@codemirror/merge` 的 chunk 算法或 diff-match-patch）实时更新，保存后以 Rust 结果对齐。Rollback Lines：修改编辑器 buffer（可 `Mod+Z` 撤销）；若文件未在 gitx 中打开则 `rollback_lines`（Rust 构造目标内容写回，先快照）。
- **边界**：编码/BOM/EOL 保持原样；文件在外部被改 → reload 提示；大文件（>5MB）关闭实时 gutter。
- **AC**：编辑时 gutter 50ms 内更新；行级 rollback 精确且可撤销。
- **里程碑**：M6

### #56 Enable staging area mode
- **UI**：Settings | Git → 「Enable staging area」（`Git.Stage.Enable`/`Disable`，也在 Commit TW ⚙ 与 Find Action 中）。切换时若存在多个非空 changelist → 确认「Changelists 将被隐藏（数据保留，关闭 staging 后恢复）」。
- **实现**：`settingsStore.repo.stagingMode`；切换不改 git 状态，只切 UI/提交策略；changelist 数据保留在 meta。
- **AC**：切换后树结构、提交行为、gutter 基准正确切换，无数据丢失。
- **里程碑**：M1（staging 先行）/ M6（双模式切换）

### #57 `Git.Stage.*`（add / reset / revert / compare / three-way / conflicts）
- **UI**：Staging 模式下：文件/目录/节点右键与悬停按钮 **Stage**（`+`）/ **Unstage**（`−`）/ **Rollback**（Unstaged 上）；**Stage All**、**Stage All Tracked**；Diff 中 hunk 按钮 Stage/Unstage/Revert 与行选择 → **Stage Selected Lines**；**Show Staged / Show Local**（三方比较：HEAD | Staged | Local，`Git.Stage.ThreeSideDiff`）；Conflicts 节点右键 Accept Yours / Accept Theirs / Merge…（`Git.Stage.Accept*`，进 #93/#94）。
- **实现**：
  - 文件级：`stage_paths` → `git add -A --pathspec-from-file`（含删除）；`unstage_paths` → `git restore --staged`（unborn HEAD 时 `git rm --cached`）。
  - 块/行级：`stage_lines{path, selection}`：Rust 读取 index 版本（`git show :path` / gix）与工作树版本 → 依 hunks+所选行生成目标 index 内容 → `git hash-object -w --stdin --path=<path>`（应用 clean filter/eol 规则）→ `git update-index --cacheinfo <mode>,<sha>,<path>`。unstage 行：基于 HEAD 与 index 反向构造。**不使用 `git apply` 拼补丁**（避免上下文偏移失败）。
  - Revert 行（worktree）：Rust 构造目标内容 → 原子写文件（保留编码/EOL/权限），先快照。
- **边界**：二进制文件只允许整文件；filter（LFS）文件只允许整文件 stage；`core.autocrlf` 下 hash-object 使用 `--path` 以应用相同转换；文件在操作期间被修改 → 基于 mtime/size 校验，不一致则重算并提示。
- **AC**：行级 stage 后 `git diff --cached` 只含所选行（含 CRLF、无末尾换行、删除行、新文件场景集成测试）；所有操作 ≤ 200ms（中等文件）。
- **里程碑**：M1（文件/块级）· M6（行级）

### #58 Delete versioned file → commit removal
- **UI**：被删除的受控文件显示为 Deleted（灰色删除线），可勾选提交；FileViewer/树右键 **Delete…**（受控文件 → 移入回收站，变更出现在 active changelist / Unstaged），提交后从仓库移除。Rollback 可恢复。
- **实现**：删除由 OS 回收站完成（`trash` crate）；changelist 模式提交时 `git commit --only -- <deleted path>` 自动记录删除；staging 模式 Stage → `git rm --cached`（`git add -A path`）。
- **AC**：删除→提交后文件从 HEAD 消失；提交前 Rollback 恢复原内容。
- **里程碑**：M1

### #59 Stop tracking（workaround → 显式动作）
- **UI**：gitx 提供 IDEA 没有的单一动作：受控文件/目录右键 **Stop Tracking (Keep Local File)…**：对话框说明「文件将从仓库移除（提交后生效），本地文件保留」+ 复选「Add to .gitignore」（默认开）。
- **实现**：`rm_cached{paths}` → `git rm -r --cached --pathspec-from-file`；可选 #115。结果为 Deleted 变更（staged）+ 文件出现在 Unversioned/Ignored。
- **边界**：其他协作者 pull 后本地文件会被删除 → 对话框中显式警告。
- **AC**：执行并提交后文件不再被跟踪且本地存在。
- **里程碑**：M6

---

## Commit / Push

### #60 Commit（`Ctrl+K`）
- **UI**：`Ctrl+K`（`CheckinProject`）聚焦 Commit TW 消息框（若无变更 → toast「Nothing to commit」）。提交前检查（#65、CRLF #96、空消息、detached HEAD 警告「You are about to commit in detached HEAD」可勾选不再提示、进行中 rebase 提示）。提交成功 balloon：「1 file committed: <subject>」+ **Undo Commit**（#109）/ **Edit Message**（#108 Reword）/ **Push…**。
- **实现**：`commit_create{repoIds, mode, selection, message, amend, author?, signoff, gpg?, noVerify, cleanup}`：
  - staging 模式 → `git commit -F <tmpmsg> [--amend] [--author] [-s] [-S] [--no-verify] --cleanup=strip`（index 原样）；
  - changelist 模式全文件选择 → 未跟踪文件先 `git add`，然后 `git commit --only -F … -- <paths>`（pathspec 经 stdin 不支持 → 超长时退化为临时 index 方案）；
  - 含部分文件（#52/#66）→ 临时 index：`GIT_INDEX_FILE=<tmp> git read-tree HEAD` → 逐文件 `update-index --index-info` → `git commit` → 对真实 index 执行 `git reset -q -- <paths>` 同步。
  - 多 root：每 root 一次 commit，同一消息；任一失败 → 汇总报告（已成功的不回滚，提示）。
- **边界**：hooks 修改文件（pre-commit 格式化）→ 提交后 status 刷新显示剩余变更；`commit-msg` hook 改写消息正常；用户未配置 `user.name/email` → 身份配置对话框（feature doc §7.5）（IDEA「用户名提示」，在 Commit 前弹出 Name/Email + 「Set globally」）；空提交拒绝；消息临时文件放 `<git-dir>/gitx/`。
- **AC**：三种选择形态提交结果与预期 diff 完全一致（集成测试）；未配置身份时引导并成功提交。
- **里程碑**：M1

### #61 Amend
- **UI**：消息框上方「Amend」复选（助记键 `Alt+M`，与 IDEA 一致）——勾选时载入 HEAD 消息（取消勾选恢复草稿）、Changes 树顶部显示「Amending: <subject> (not pushed / ⚠ pushed)」；已推送的 commit 勾选时警告需 force push。扩展：Amend 右侧下拉 **Amend Commit… ▾** 选择更早的本地未推送 commit → 以 fixup 方式（#108 Fixup）实现。
- **实现**：`--amend`；amend 早期 commit → 先 `git commit --fixup=<sha>` 生成 `fixup!` commit → `git rebase -i --autosquash <sha>^`（`GIT_SEQUENCE_EDITOR=true` 直接接受自动排好的 todo）。
- **边界**：HEAD 是 merge commit → amend 允许但提示；无 commit（unborn）→ 禁用。
- **AC**：amend 后 HEAD sha 改变、消息/内容正确；已推送检测准确（`branch -r --contains`）。
- **里程碑**：M1（早期 commit amend M5）

### #62 Commit message history / template / reformat
- **UI**：消息框工具按钮 🕘 **Commit Message History**（按钮 + Find Action，无默认快捷键）：最近 50 条本仓库消息（`git log -n 200 --format=%B` 去重 + gitx 本地草稿历史），搜索后回车填入。模板：若 `commit.template` 存在或 `.gitx/settings.json` 指定 → 空消息时预填（灰色注释行 `#` 提交时 strip）。Reformat：Settings | Version Control | Commit → 「Commit message inspections」：Limit subject line to [72]、Blank line between subject and body、Limit body line to [72]（可「Wrap when typing reaches right margin」）；违规以波浪线 + 快速修复 **Reformat message**。
- **实现**：`commit_message_history`、`commit_template_get`（解析 `~` 路径）；inspections 纯前端。
- **AC**：历史、模板、换行修复均可用且模板注释行不进入 commit。
- **里程碑**：M2

### #63 Author / Sign-off / GPG sign
- **UI**：提交选项齿轮：**Author**（自动补全来自 `git log --format='%aN <%aE>'` 去重/index；格式校验 `Name <email>`）、**Sign-off commit**（`-s`）、**Sign commit with GPG**（当 `commit.gpgsign` 时默认开）。Settings | Git →「Configure GPG Key…」：列出 `gpg --list-secret-keys --with-colons` 的密钥，选择后写 repo `user.signingkey` + `commit.gpgsign=true`；检测 `gpg.format=ssh` 时改显示 SSH key 路径。
- **实现**：参数 `--author`、`--signoff`、`-S[<keyid>]`；gpg-agent 需要 GUI pinentry——检测 `pinentry` 配置为 tty 型时给出说明（`gpg.agent.configuration`）。签名失败 → `GpgSignFailed`，对话框提供「Commit without signing」。
- **边界**：Log 中显示签名状态（`%G?`）作为附加列（可选，M3）。
- **AC**：签名提交 `git log --show-signature` 验证通过；pinentry 缺失时错误可理解。
- **里程碑**：M2

### #64 Run Git hooks toggle
- **UI**：提交选项「Run Git hooks」（仅当检测到 hooks：`core.hooksPath` 或 `.git/hooks/` 下非 `.sample` 可执行文件）；Push 对话框同样提供（pre-push）。Advanced Settings「Do not run hooks by default」。hook 运行中 Job 标题「Running pre-commit hook…」，输出实时进 Console。失败 → 对话框显示 hook 输出（ANSI 着色渲染）+ **Commit Anyway**（--no-verify，destructive 风格）/ **Cancel**。
- **实现**：`noVerify` 参数；hook 运行无 TTY，PATH 继承用户登录 shell（macOS GUI 应用 PATH 问题：启动时用 `$SHELL -ilc env` 获取，带超时并缓存）。
- **AC**：husky/lint-staged 类 hook 在 gitx 中可正常执行（PATH 正确）；失败输出可读。
- **里程碑**：M1（PATH 修正属 M0）

### #65 Commit Checks / Advanced Checks / After Commit upload（通用部分）
- **范围说明**：语言相关检查（Reformat/Rearrange/Optimize imports）= **#141 deferred**；After Commit 部署上传 = **#140 deferred**。gitx 实现**语言无关**检查框架。**需协调者确认**。
- **UI**：提交选项「Commit Checks」：☑ Check for unresolved conflict markers、☑ Check TODO/FIXME (show / fail)、☑ Warn on large files (> [5] MB)、☑ Warn on secrets（高置信正则：私钥头、`ghp_`/`AKIA` 等）、☐ Run custom command before commit（Advanced：命令 + 工作目录，等价 IDEA「Run Configuration」）。检查失败 → 提交区内联结果面板「2 problems: Review / Commit Anyway」。
- **实现**：`commit_checks_run{selection}`：Rust 对即将提交的内容（index/临时 index 中的新内容）扫描；自定义命令为 Job（可取消，输出进 Console）。
- **AC**：包含 `<<<<<<<` 的文件提交被拦截并可定位行；secrets 检测不把密钥写入日志。
- **里程碑**：M8

### #66 Partial commit（chunks / lines）
- **UI**：Changelist 模式：Diff 视图中每个 hunk 左侧 checkbox（默认勾选），**Split Chunks and Include Selected Lines**（选中行后右键）生成行级 checkbox；Changes 树中文件 checkbox 显示三态（部分）。提交按钮文本「Commit 2 files (partially)」。Staging 模式等价能力由 #57 行级 stage 提供。
- **实现**：前端维护 `partialSelection{path → selected line ids}`；提交走 #60 临时 index 路径（Rust 构造「HEAD + 所选行」内容）。
- **边界**：提交期间文件在外部变化 → 构造前校验内容 hash，失败则中止提交并刷新；新文件部分提交（`--intent-to-add` 处理）。
- **AC**：任意行组合提交后 `git show HEAD` 精确匹配所选；未选内容仍在工作区。
- **里程碑**：M6

### #67 Commit from gutter
- **UI**：FileViewer gutter 变更面板中 **Commit this change…**：打开 Commit TW 并预选该 hunk（其余取消勾选），焦点进消息框；**Amend this change** 选项（并入 HEAD）。
- **实现**：设置 `partialSelection` 后复用 #66。
- **AC**：从 gutter 两次操作完成单 hunk 提交。
- **里程碑**：M6

### #68 Commit and Push（`Ctrl+Alt+K`）
- **UI**：提交按钮下拉 / `Ctrl+Alt+K`（`Git.Commit.And.Push.Executor`）。提交成功后：Settings「Show Push dialog for Commit and Push」= Always → 打开 Push 对话框（#70）；= Only for protected branches → 非 protected 直接 push 并 balloon；amend 已推送 commit → 强制显示对话框（需 force）。
- **实现**：commit Job → push_preview → push Job（CompositeJob）。
- **AC**：一次快捷键完成提交 + 推送；protected 分支总是弹出对话框。
- **里程碑**：M2

### #69 Commit TW view modes / toggle controls（modal 除外）
- **范围说明**：Modal Commit Interface = **#139 deferred**，此条只做 tool window 形态。
- **UI**：Commit TW 标题栏 ⋮ → View Mode：**Docked**（默认）/ **Window**（独立 OS 窗口）/ **Float**（置顶浮动窗口）；**Toggle Commit Controls**（隐藏消息区，仅剩变更树，`Ctrl+K` 时自动展开）；「Close tool window after committing」（Advanced）；Advanced「Show Commit as tab in Git tool window」（IDEA 降级为 Log 内 Local Changes tab 的等价项）。
- **实现**：Tauri 多 WebviewWindow 共享 Pinia 状态——方案：辅助窗口加载同一前端入口 `?view=commit&repo=…`，状态经后端事件同步（stores 支持 `broadcast` 插件：本窗口变更 → `ui://sync` 事件 → 其他窗口应用）；`layoutStore` 持久化模式与窗口位置。
- **AC**：三种模式切换后状态（消息草稿、勾选）一致；关闭独立窗口回到 Docked。
- **里程碑**：M7

### #70 Push dialog（`Ctrl+Shift+K`）
- **UI**：对话框标题「Push Commits to <repo>」。左侧树：Repo（多 root 时复选框）→ `main → origin : main`（remote 与目标分支均可点击编辑：remote 下拉（含「Define remote…」#13）、目标分支输入框带自动完成，新远端分支显示「New」标签）→ 待推送 commits 列表（hash、subject、author、date；无 commits 显示「Nothing to push」并禁用该行）。右侧：所选 commit(s) 的 Changed Files 树（可 `Ctrl+D` diff）。底部：「Push tags: ☐ [All | Current Branch]」（#74）、「Run Git hooks」（#64）、「Set upstream」（新分支默认）；按钮 **Push**（主）+ 下拉 **Force Push**（#72）、Cancel。加载：每 repo 骨架；错误：行内错误（如 remote 不可达，仍可 Push 尝试）。
- **实现**：`push_preview{repoIds}` → 对每 repo：当前分支、upstream（`@{push}` 优先，其次 `@{u}`，否则 `<default remote>/<same name>`）、commits = 目标 ref 存在时 `git log <target>..HEAD`，否则 `git log HEAD --not --remotes=<remote>`（限 1000 条）；`push_run{items[], tags, force, setUpstream, noVerify}` → `git push --progress --porcelain [--set-upstream] [--no-verify] [--follow-tags|--tags…] <remote> <local>:<refs/heads/target>`；解析 porcelain 每 ref 状态（`=`/`*`/`+`/`!` rejected + reason）。完成 balloon：「Pushed 3 commits to origin/main」/「Pushed main to new branch origin/feature」。
- **边界**：detached HEAD → 需要输入目标分支；push 到与本地名不同的分支；`push.default` 尊重；多 root 部分失败汇总；pre-push hook 失败。
- **AC**：多 root 下按 repo 推送并单独报告；修改目标分支名推送到新分支并设置 upstream；预览与实际推送 commits 一致。
- **里程碑**：M2

### #71 Push All up to Here / Push Selected Commits
- **UI**：Log 中本地未推送 commit 右键 **Push All up to Here…**（`Git.PushUpToCommit`）→ 打开 Push 对话框且只预选到该 commit；Push 对话框 commits 列表中选中某 commit → 右键「Push up to Here」（= Push Selected Commits：推送到所选 commit 为止的前缀）。
- **实现**：refspec `<sha>:refs/heads/<target>`。
- **边界**：所选 commit 不在当前分支直线上（merge 分支上）→ disabled；目标非 FF → rejected 处理（#73）。
- **AC**：远端分支只前进到所选 commit。
- **里程碑**：M3

### #72 Force push（with lease）+ protected branches
- **UI**：Push 按钮下拉 **Force Push**（destructive）；确认对话框说明 `--force-with-lease` 语义；目标为 protected 分支时 Force Push disabled + tooltip「'main' is protected (Settings | Git | Protected branches)」。Settings | Git → Push → 「Protected branches: [master, main]」（逗号分隔 glob，`.gitx/settings.json` 可共享）。
- **实现**：`--force-with-lease=refs/heads/<target>:<remote-tracking sha>`（明确期望值，避免后台 fetch 导致 lease 失效）+ `--force-if-includes`（git ≥ 2.30）。force 前将远端旧 sha 写入 `refs/gitx/backup/remote-<remote>-<branch>-<ts>`（便于恢复他人提交）。Protected 规则同时约束：#86 interactive rebase、#108 改写已推送 commit、#29 删除 remote 分支、#89 cherry-pick 后缀。（从 GitHub 加载规则 = #135 deferred。）
- **边界**：lease 失败（远端有新提交）→ `PushRejectedStaleInfo` 专用提示「Remote changed since last fetch — Fetch and review」。
- **AC**：protected 分支无法 force；lease 失败不覆盖远端；备份 ref 可恢复。
- **里程碑**：M2

### #73 Push Rejected → merge / rebase
- **UI**：非快进被拒时对话框「Push Rejected — Push of current branch 'main' was rejected. Remote changes need to be merged before pushing.」按钮 **Rebase** / **Merge** / Cancel + 「Remember the update method choice and silently update in future」（写入 Settings「Auto-update if push of the current branch was rejected」）。自动更新后自动重试 push；若更新产生冲突 → 进入冲突流程，push 中止并 balloon「Push cancelled: resolve conflicts then push again」。
- **实现**：解析 porcelain `! … [rejected] (non-fast-forward)` / `(fetch first)` → `PushRejectedNonFastForward` → 用户选择 → `update_branch(strategy)`（#79）→ 重新 `push_run`。非当前分支被拒 → 仅提示，不自动更新。
- **AC**：远端领先时 Rebase 选项完成「rebase + push」；记住选择后下次静默执行。
- **里程碑**：M2（冲突衔接 M4）

### #74 Push tags（All / Current Branch）
- **UI**：Push 对话框底部「Push tags」复选 + 下拉：**All**（`--tags`）/ **Current Branch**（`--follow-tags`：仅 annotated 且可达）；勾选状态记忆。预览区追加显示将推送的新 tags（计算方式：本地 tags 中不在 `ls-remote --tags <remote>` 结果里的部分，懒加载）。
- **实现**：push 参数映射，单元测试。
- **边界**：`--follow-tags` 只推 annotated tag——UI 文案说明。
- **AC**：两种模式推送 tag 集合正确。
- **里程碑**：M2
