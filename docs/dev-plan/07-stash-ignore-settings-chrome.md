# Part 2.6 — Stash / Shelve / Ignore（#111–116）· Settings / Chrome / Shortcuts（#117–124）

> 返回索引：[../dev-plan.md](../dev-plan.md) · 框架：[01-framework.md](./01-framework.md) · 条目模板见 [02](./02-setup-remotes.md) 顶部。

---

## Stash / Shelve / Ignore

### #111 Shelve / Unshelve / Restore / Import patches
- **UI**：Commit TW 文件/changelist 右键 **Shelve Changes…**（对话框：消息（默认 changelist 名）、选择文件、「Keep changes in working tree」=不 rollback）、**Shelve Silently**（默认快捷键沿用 IDEA keymap，与系统快捷键冲突的平台不绑定）。Git TW → **Shelf** tab：列表（消息、日期、文件数），展开显示文件；右键 **Unshelve…**（选择目标 changelist、「Remove successfully applied files from shelf」）、**Unshelve Silently**、Show Diff（vs base revision / vs local）、Rename、Delete（进入 Recently Deleted，可 **Restore**）、Create Patch；工具栏 **Import Patches…**（把外部 `.patch` 导入为 shelf 项）；「Show recently deleted」切换。
- **实现**：gitx 自有存储 `<common-dir>/gitx/shelf/<id>/`：`meta.json`（消息、日期、base revision sha、文件列表、来源 changelist、二进制标记）+ `changes.patch`（`git diff --binary <base> -- <paths>`，含 untracked 不处理——与 IDEA 一致）+ 每文件 base blob sha（用于 3-way）。Shelve = 写入 shelf → （未选 keep）rollback 这些文件（Safety Snapshot 冗余保护）。Unshelve = `git apply --3way`（base blob 在对象库中可用，因 shelve 时 `hash-object -w` 确保写入，并用 `refs/gitx/shelf/<id>` 保活）→ 冲突进入冲突流程。删除 → 移动到 `shelf/.deleted/`（保留 30 天）。
- **边界**：shelf 存储随 `.git` 存在，worktree 共享（common-dir）；base revision 被 gc → 保活 ref 防止；部分文件应用失败 → 已成功的从 shelf 中移除（若勾选），失败的保留。
- **AC**：Shelve→修改工作区→Unshelve 产生 3-way 合并结果；Delete 后可 Restore；导入的 patch 可 unshelve。
- **里程碑**：M6

### #112 Stash / Apply / Pop / Drop / Clear / Unstash as branch
- **UI**：Main Menu `Git | Stash Changes…`（`Git.Stash`）：Git Root、Message、「Keep index」、「Include untracked」（gitx 扩展，IDEA 无此选项）；Commit TW 右键 Stash。Git TW → **Stash** tab（`Git.Show.Stash`）：列表 `stash@{n}`（消息、分支、日期），展开显示文件，选中显示 diff（Settings「Compare with: Local / Parent commit」）；右键/工具栏 **Apply**、**Pop**、**Drop**（Delete 键；balloon Restore）、**Clear**（确认，destructive；全部写入 backup）、**Unstash as Branch…**（`git stash branch`，输入分支名）；Unstash 对话框（`Git.Unstash`，IDEA 风格）：选择 stash + 「Pop stash」+「Reinstate index」+「As new branch」。
- **实现**：`stash_list` → `git stash list -z --format=%gd%x00%H%x00%gs%x00%ct`；`stash_create{msg, keepIndex, includeUntracked, paths?}` → `git stash push -m <msg> [--keep-index] [-u] [-- <paths>]`；apply/pop → `git stash apply|pop [--index] stash@{n}`（冲突 → 冲突流程，pop 冲突时 git 不 drop——UI 提示「Drop stash after resolving」）；drop/clear 前 `update-ref refs/gitx/backup/stash-<sha>`；Restore → `git stash store -m <msg> <sha>`。
- **边界**：`stash@{n}` 索引在操作间会变化 → 内部以 sha 标识，执行前重新解析；`--index` 恢复失败（index 冲突）→ 回退为不带 index 并提示。
- **AC**：全部动作与 CLI 一致；drop/clear 可恢复。
- **里程碑**：M6（smart 操作内部使用的 stash 在 M4 已具备）

### #113 Combine Stashes and Shelves tab
- **UI**：Settings | Git →「Combine stashes and shelves in one tab」（默认开）：Git TW 只显示一个 **Stashes & Shelves** tab，两个分组节点（Stashes / Shelves），各自右键菜单不变；关闭时分为两个 tab。
- **实现**：同一 `StashShelfView` 组件按设置渲染。
- **AC**：切换设置即时生效且选择状态保留。
- **里程碑**：M6

### #114 Clean working tree using Stash | Shelve
- **UI**：Settings | Git → Update →「Clean working tree using: **Stash** / **Shelve**」（默认 Stash；Shelve 选项在 M6 前 disabled 并注明）；同样出现在 Update Project 对话框（#78）与 Smart Checkout（#22）说明中。
- **实现**：`with_clean_tree(op, method)`：Stash → `git stash push -m "gitx: <op>"`（含 untracked 仅当会被覆盖）→ op → `git stash pop --index`；Shelve → shelf（#111，标注 system shelf）→ op → unshelve。中途失败：保存物永不自动删除，balloon 指向 Stash/Shelf tab。
- **AC**：两种方式在 Smart Checkout/Update/Smart Merge 中都能完整恢复变更（集成测试矩阵）。
- **里程碑**：M4（Stash 方式）· M6（Shelve 方式）

### #115 Add to .gitignore / exclude
- **UI**：Unversioned 文件/目录右键 `Git | Add to .gitignore ▸`（子菜单列出可选的 `.gitignore` 文件：最近的目录 `.gitignore`、repo 根 `.gitignore`、「New .gitignore in …」）与 **Add to .git/info/exclude**（`Git.Ignore.File`）；对话框预览将追加的规则（可编辑：精确路径 `/build/out.log` 或模式 `*.log`、目录 `build/`），添加后文件从 Unversioned 移到 Ignored。
- **实现**：`ignore_add{file, patterns}`：读写文本（保持 EOL 与末尾换行）；规则路径相对于该 `.gitignore` 所在目录并转义特殊字符（`#`、`!`、空格尾、`[`）；随后 `git check-ignore` 验证生效，未生效（被更高优先级 `!` 规则覆盖）→ 提示。
- **边界**：文件已被跟踪 → 提示 ignore 不影响已跟踪文件并提供 #59 Stop Tracking。
- **AC**：添加规则后文件即时移动到 Ignored；特殊字符文件名正确转义。
- **里程碑**：M6

### #116 Open exclude file
- **UI**：Main Menu `Git | Open .git/info/exclude`（`Git.OpenExcludeFile`）、Ignored 节点右键；在 FileViewer 中打开（可编辑，保存后 status 刷新）；文件不存在时创建。
- **实现**：路径 = `<common-dir>/info/exclude`；`file_read/write`。
- **AC**：编辑保存后 Ignored/Unversioned 列表更新。
- **里程碑**：M6

---

## Settings / Chrome / Shortcuts

### #117 Settings | Git（full page）
- **UI**：Settings 对话框（`Mod+,`，左侧树 + 右侧表单 + 搜索框高亮匹配项，IDEA 风格；采用 IDEA 的 Apply / OK / Cancel 三按钮模式）。`Version Control | Git` 页分组：
  - **Git executable**：Path + Test（#9）；
  - **Commit**：Enable staging area（#56）、Warn if CRLF（#96）、Warn when committing in detached HEAD or during rebase、Cherry-pick suffix（#89）、Configure GPG Key（#63）；
  - **Push**：Auto-update if push rejected（#73）、Show Push dialog for Commit and Push（Always / Only for protected）（#68）、Protected branches（#72）；（Load protection rules from GitHub = #135 deferred，不显示）；
  - **Update**：Update method（#79）、Clean working tree using（#114）、Filter Update Project info by paths（#80）、Auto fetch interval（#75）、Check incoming changes（#76）、Fetch tags（#42）、Update submodules（#81）；
  - **Stash**：Combine stashes and shelves（#113）、Stash diff compare with（#112）；
  - **Authentication**：Use credential helper（#16）；
  - **Multi-root**：Execute branch operations on all roots（#33）。
- **实现**：设置 schema 在 Rust（`gitx-core::settings`），前端表单由 schema 元数据（title key、控件类型、范围、scope=app|repo|shared）**声明式生成**，保证搜索、来源标签（#10）、重置为默认一致。
- **AC**：页面每项都有效果测试；搜索「rebase」能找到所有相关项。
- **里程碑**：M8（各项随对应功能里程碑上线，M8 统一完善与搜索）

### #118 Confirmation / Changelists / Ignored / File Status Colors
- **UI**：
  - `Version Control | Confirmation`：When files are created（#7）/ deleted（Ask/Silently/Do nothing）、Show options before Update（#78）、Restore workspace on branch switching（#34）、Highlight modified lines in gutter（#55）、Highlight directories that contain modified files（#54）、各「Don't ask again」开关的统一恢复列表（Rollback、Delete branch、Force push、Detached HEAD 警告…）。
  - `Version Control | Changelists`：Allow per-hunk changelists（#52）、When empty changelist becomes inactive: Do nothing / Remove silently / Ask、Changelist conflict 行为（#53）。
  - `Version Control | Ignored Files`：说明区分「Git ignore 规则」与「gitx 显示层忽略（只在 gitx UI 隐藏，不影响 git）」两类（IDEA 平台忽略列表的等价物），后者以模式列表编辑。
  - `Version Control | File Status Colors`：每状态亮/暗颜色编辑 + 预览 + 重置（#54）。
- **实现**：同 #117 声明式 schema；File Status Colors 写入 CSS 变量覆盖。
- **AC**：每个确认项可从此页恢复；颜色修改即时生效。
- **里程碑**：M8

### #119 Diff & Merge / Advanced VCS settings
- **UI**：
  - `Tools | Diff & Merge`：默认视图（side-by-side/unified）、Ignore whitespace 默认、Context lines、Automatically apply non-conflicting changes（#94）、Open diff in editor tab / separate window（#97）、Sync scroll；**External Diff Tools**：启用外部 diff/merge 工具（预设 Beyond Compare、Meld、KDiff3、VS Code、IntelliJ `idea diff`、P4Merge；自定义命令模板 `%1 %2 %3`），文件类型关联。
  - `Advanced Settings | Version Control`：Commit tool window 行为（#69）、Do not run hooks by default（#64）、Open Update Info automatically（#80）、Log 每页加载行数、long edges 阈值、gix 读后端开关（1.2）、Safety backups retention days（1.14.4）、Diff large file threshold。
  - `Appearance`：主题（mode/palette/corner style/density/UI scale——沿用 dbx 外观模型）、语言（zh-CN/en）。
- **实现**：外部工具调用：导出两侧到临时文件（只读）→ `open_external_tool`（参数数组，不经 shell 拼接，防注入）；merge 工具写回结果文件后 gitx 检测修改并询问「Mark as resolved?」。
- **AC**：外部 diff 与 merge 工具可完成一次冲突解决；设置项全部生效。
- **里程碑**：M8（Diff 基础选项随 M3）

### #120 VCS Operations Popup（`` Alt+` ``）
- **UI**：`` Alt+` ``（macOS `` Ctrl+V ``，与 IDEA 一致；Windows/Linux 冲突时可在 Keymap 改）在焦点位置弹出编号快速菜单（数字键 1–9 直接选择，类型即搜）：Commit…、Commit and Push…、Rollback、Show Diff、Show History、Annotate、Branches…、New Branch…、Fetch、Pull…、Update Project…、Push…、Stash Changes…、Unstash…、Shelve…、Create Patch…、Resolve Conflicts…（有冲突时）、Continue/Abort（进行中操作时置顶）、Enable Version Control Integration（非 repo 时）、Create Git Repository…；内容随上下文（选中文件/commit）动态启用。Menus and Toolbars 设置页可自定义该组（拖拽排序、增删 action、分隔符）。
- **实现**：`Vcs.Operations.Popup` 组由 Action Registry 渲染；自定义保存为 group override（settings）。
- **AC**：键盘 2 次按键完成常用操作；自定义持久化。
- **里程碑**：M2（M0 框架）

### #121 Git main menu groups
- **UI**：Windows/Linux：TitleBar「≡」打开 Main Menu（File / Edit / View / **Git** / Window / Help，悬停展开、`Alt` 助记）；macOS：原生菜单栏同结构。**Git** 菜单分组（`Git.MainMenu.*`）：
  - Commit…（`Ctrl+K`）、Push…（`Ctrl+Shift+K`）、Update Project…（`Ctrl+T`）、Pull…、Fetch；
  - Merge…、Rebase…、Resolve Conflicts…、Abort/Continue（按状态）；
  - Branches…、New Branch…、New Tag…、Reset HEAD…；
  - Show Git Log（`Alt+9`）、Show History、Annotate、Compare with…；
  - Patch ▸（Create Patch… / Apply Patch… / Apply Patch from Clipboard…）；Uncommitted Changes ▸（Shelve… / Stash… / Unstash… / Rollback… / Show Shelf / Show Stash）；
  - Manage Remotes…、Worktrees ▸、Clone…、Create Git Repository…、Unshallow Repository（条件）、Open .git/info/exclude。
- **实现**：同一 group 定义同时生成 `CustomContextMenu` 风格的 in-app 菜单与 Tauri 原生菜单（macOS；enable 状态在焦点/选择变化时同步 `menu.set_enabled`，节流）。
- **AC**：三平台菜单项一致；禁用项显示原因（in-app 菜单 tooltip）。
- **里程碑**：M1（随功能逐步填充）

### #122 Main toolbar Git quick actions
- **UI**：TitleBar 右侧图标按钮组（可在设置中开关每项）：**Update Project**（⟳↓）、**Commit**（✓）、**Push**（↑）、**History**（🕘 当前文件/选中项历史，无选择时打开 Log）、**Rollback**（↶）；悬停 tooltip 含快捷键；进行中操作时按钮组替换为「Continue / Abort」高亮按钮。
- **实现**：`MainToolbar.VcsQuickActions` group。
- **AC**：五个按钮可用并随上下文启用。
- **里程碑**：M1

### #123 Console tab
- **UI**：Git TW → **Console** tab：按时间显示 gitx 执行的每条 git 命令（`[10:21:03] git fetch --progress origin`，已脱敏）及其 stdout/stderr（stderr 黄色/红色，进度行折叠为最终状态），每条命令可折叠、显示耗时与退出码；工具栏：Clear、Filter（repo / 只显示错误 / 只显示写操作）、Copy、**Soft-wrap**、Scroll to end、「Show read-only commands」（默认关，避免 status/log 噪声）。错误通知中的「Show in Console」跳转到对应条目。（可选扩展：底部输入框执行任意 git 命令——**首版不做**，避免绕过状态机。）
- **实现**：GitRunner 的 `job://log` 与命令元数据 → `consoleStore`（每 repo 环形缓冲 5000 行，虚拟列表）；持久化最近 1000 行到日志文件以便诊断。
- **AC**：所有写操作命令可见且可复制重现；凭据永不出现（自动化扫描）。
- **里程碑**：M1（M0 已有底层日志）

### #124 Keymap customization
- **UI**：Settings | **Keymap**：预设（IDEA Windows/Linux、IDEA macOS、gitx default）；树形列出所有 actions（按 group），搜索（按名称或按按键录制 🔍⌨），右键 Add Keyboard Shortcut（录制，显示冲突并可「Remove other assignments」）/ Remove / Reset；导出/导入 JSON。
- **实现**：`actions/keymap.ts`：解析为 `{ actionId → chords[] }`（支持两段和弦如 `Ctrl+K Ctrl+C`）；用户覆盖存 settings；`ShortcutDispatcher` 按作用域匹配（1.11）；系统保留键（`Mod+Q`、`Mod+H` 等）不可绑定。
- **AC**：重新绑定后菜单/tooltip 中显示的快捷键同步更新；冲突检测正确。
- **里程碑**：M8（M0 先实现 registry + 默认 keymap）
