# Part 2.1 — Setup / Clone / Init（#1–10）与 Remotes / Auth（#12–17）

> 返回索引：[../dev-plan.md](../dev-plan.md) · 框架：[01-framework.md](./01-framework.md)
> 条目模板：**UI**（位置/交互/菜单/空·错·载状态）· **实现**（BE 命令 → git 调用；FE 组件/store；事件）· **边界** · **验收（AC）** · **里程碑**。
> 通用约定不再重复：长操作 = Job（状态栏进度 + 可取消 + Console 日志）；错误按 1.8 呈现；破坏性操作按 1.14.4 先快照。
> **#11（Submodule clone/register）deferred**，本章不实现，仅在 #1 中保留扩展点。

---

## A. Setup / Clone / Init

### #1 `Git.Clone` — Clone Repository
- **UI**：入口 = Welcome 屏「Clone Repository」、Main Menu `Git | Clone…`、命令面板。对话框字段：URL（粘贴剪贴板中的 git URL 自动填入）、Directory（默认 `<默认克隆目录>/<repo-name>`，可浏览）、Shallow clone 勾选 + depth（#2）、「Open after clone」（默认开）。URL 输入后 debounce 600ms 执行 `ls-remote` 校验，显示「✓ Repository found」/「✗ Cannot access」（认证需求时提示「将在克隆时询问凭据」）。左侧 hosting 账号列表 = #126 deferred，预留 `CloneProvider` 扩展槽但首版只有「Repository URL」。
- **实现**：BE `clone_run{url, dir, depth?, branch?}` → `git clone --progress [--depth N] [--branch b] -- <url> <dir>`（NetworkWrite Job，askpass 生效）；`clone_check_url` → `git ls-remote --heads -- <url>`（Network，10s 超时，取消上一次）。完成后 `workspace_open(dir)`。FE `features/welcome/CloneDialog.vue`、`workspaceStore.recent` 更新。
- **边界**：目标目录非空 → 阻止并提示；URL 含凭据 → 存储/日志脱敏，克隆后提示「URL 中包含凭据，建议移除」并提供 `remote set-url` 一键清理；取消克隆 → 杀进程并删除半成品目录（仅当目录由本次创建）；SSH host key 未知 → askpass 指纹确认；Windows 长路径 → 提示开启 `core.longpaths`；磁盘满 → `FsError`。
- **AC**：HTTPS/SSH 公私有仓库均可克隆；进度显示 phase + %；取消后无残留目录；失败错误可行动；完成后自动打开并显示 Log/Changes。
- **里程碑**：M2

### #2 Shallow clone + `Git.Unshallow`
- **UI**：Clone 对话框「Shallow clone, depth: [1]」；仓库为 shallow 时（`.git/shallow` 存在）Main Menu 出现 `Git | Unshallow Repository`，Log 底部显示「History is truncated (shallow clone) — Fetch full history」链接。
- **实现**：clone 加 `--depth N`；BE `unshallow_run` → `git fetch --progress --unshallow <remote>`；`repo_state_get` 返回 `isShallow`（`git rev-parse --is-shallow-repository`）。Log graph 对 shallow 边界 commit 画「截断」标记（父不可达）。
- **边界**：shallow 下 merge-base/compare/blame 结果可能不完整 → 相关视图显示提示条；`--update-shallow` 不默认；unshallow 网络失败可重试。
- **AC**：depth=1 克隆成功且 Log 显示截断标记；Unshallow 后标记消失、菜单项隐藏。
- **里程碑**：M2

### #3 Welcome / New Project from Version Control
- **UI**：无 workspace 时显示 Welcome 页（居中卡片，dbx 风格）：左栏 Recent Repositories（搜索、右键 Remove from Recent / Reveal / Open in New Window）、右侧大按钮 **Open**（`Mod+O`）、**Clone Repository**（#1）、**Create Repository**（#5）。拖入文件夹即打开。`File | New | Project from Version Control` = 打开 Clone 对话框。
- **实现**：BE `workspace_recent`（app settings 存储，路径不存在则标灰「Missing」）、`workspace_open`（rev-parse 定位 root；非 repo → 走 #4 流程）。FE `features/welcome/WelcomeView.vue`；多窗口：`windowService.openWorkspace(path, newWindow)`。
- **边界**：recent 中路径失效；打开权限不足目录；`safe.directory` 所有权错误（git ≥2.35.2 `dubious ownership`）→ 专用错误 `UnsafeRepository` 对话框，提供「Trust this directory」（执行 `git config --global --add safe.directory <path>`，需确认）。
- **AC**：首次启动看到 Welcome；Recent 最多 20 条可搜索；dubious ownership 可一键信任并打开。
- **里程碑**：M1（Clone 入口 M2 接入）

### #4 `Start.Use.Vcs` / Enable Version Control Integration
- **UI**：打开的文件夹不是 git repo 时，Commit TW 显示空状态：「This folder is not under version control」+ 按钮 **Enable Version Control Integration…**（VCS Operations Popup 中同名项）。对话框：选择 VCS = Git（唯一选项，保持 IDEA 语义），根目录默认当前文件夹，可选初始分支名（默认读 `init.defaultBranch`，否则 `main`）。完成后询问是否创建 `.gitignore` 模板（可跳过）及 #10 共享设置提示。
- **实现**：BE `vcs_enable{dir, initialBranch}` → `git init -b <branch> -- <dir>`（git < 2.28 降级为 `init` + `symbolic-ref HEAD refs/heads/<b>`）→ 刷新 workspace。
- **边界**：父目录已是 repo（文件夹是子目录）→ 提示「该目录位于仓库 X 内」，提供「打开父仓库」或「仍在此创建嵌套仓库」；只读文件系统。
- **AC**：非 repo 文件夹两步内完成 init，Changes 显示全部 Unversioned 文件。
- **里程碑**：M1

### #5 `Git.Init` — Create Git Repository（multi-root）
- **UI**：Main Menu `Git | Create Git Repository…`（`VCS` 组），目录选择器（默认 workspace 根，可选任意子目录）。在已有 workspace 内为子目录 init → 新 root 加入映射，Log/Changes 立即出现该 root（颜色条区分）。
- **实现**：BE `init_run{dir}` → `git init`；`repo_mappings_set` 追加 root；watcher 注册。
- **边界**：目录已是 repo → 禁用确定按钮并说明；init 在 `.git` 内部目录 → 拒绝。
- **AC**：同一 workspace 中可创建 2 个以上 repo，各自独立 status/log。
- **里程碑**：M1

### #6 `Git.Add` — Add to VCS
- **UI**：Commit TW → Unversioned Files 节点/文件右键 **Add to VCS**（`Ctrl+Alt+A`）；拖拽 Unversioned 文件到 changelist 或「Staged」区；也可直接勾选 unversioned 文件并 Commit（提交时自动 add，IDEA 行为）。目录上执行 = 递归添加（尊重 ignore）。
- **实现**：BE `add_paths{repoId, paths, force:false}` → `git add --pathspec-from-file=- --pathspec-file-nul`（Write）。changelist 模式下 add 后文件进入当前 active changelist（gitx-meta 记录）；staging 模式下进入 Staged。
- **边界**：路径含特殊字符/超长列表（stdin pathspec 解决）；文件在 add 前被删除 → 部分失败，报告失败文件；被 ignore 的文件 → 不报错，提示可用 #8 force-add；`core.autocrlf` 警告（`LF will be replaced by CRLF`）收集到 Console，不弹窗。
- **AC**：10k 个 unversioned 文件 Add 在 3s 内完成且 UI 不冻结；结果树正确移动。
- **里程碑**：M1

### #7 Auto-add on create（Confirmation）
- **UI**：Settings | Version Control | Confirmation → 「When files are created」：`Ask` / `Add silently` / `Do not add`（默认 Ask）。Ask 模式下，watcher 检测到新文件时出现**非阻塞** balloon：「3 new files created — Add / View Files / Always Add / Don't Ask Again」（合并 5s 内事件）。
- **实现**：watcher `Worktree` 事件 → 对比上次 status 的新增 untracked（排除 ignored、排除 gitx 自身操作产生的文件、排除 repo 刚打开时已存在的文件）→ `notificationsStore`；动作调用 #6。
- **边界**：大量生成文件（构建产物）——单次 > 50 文件时只提示「many files」并建议加入 ignore（#115）；外部 git 操作（checkout）产生的新文件不应触发（检测 HEAD 变化窗口内抑制）。
- **AC**：编辑器外新建文件 1s 内出现提示；Add silently 模式自动加入；checkout 引起的新文件不提示。
- **里程碑**：M6

### #8 Force-add ignored files
- **UI**：Show Ignored Files（#49）开启后，Ignored 节点文件右键 **Add to VCS (force)**；对被 ignore 文件执行普通 Add 时弹出确认「文件被 .gitignore:12 `*.log` 忽略，仍要添加？」显示匹配规则来源。
- **实现**：`git check-ignore -v -z --stdin` 获取规则来源；`add_paths{force:true}` → `git add -f`。
- **边界**：被父目录规则忽略的目录内文件；`.git/info/exclude` 与 `core.excludesFile` 来源都要显示。
- **AC**：确认框显示正确规则文件与行号；force-add 后文件变为 Added。
- **里程碑**：M6

### #9 Git executable path + Test（+ WSL）
- **UI**：首次启动/每次启动后台检测；Settings | Version Control | Git → 「Path to Git executable: [auto-detected ▾] [Test]」，Test 显示 `git version 2.47.0` 或错误。未找到 git → 全局阻塞式空状态页：「Git is not installed」+ 平台相关指引（Windows 下载 Git for Windows / macOS `xcode-select --install` / Linux 包管理命令）+ 「Browse…」+ 「Retry」。版本低于 2.31 → 警告 banner（不阻塞，部分功能禁用并说明）。
- **实现**：BE `git_detect` 顺序：设置路径 → `PATH` → 平台常见位置（`C:\Program Files\Git\cmd\git.exe`、`/opt/homebrew/bin/git`、`/usr/local/bin/git`、`/usr/bin/git`）；`git_test_executable{path}` → `git --version` + `git --exec-path` + 能力探测表（features gate）。**WSL**：Windows 上打开 `\\wsl$\<distro>\…` 或 `\\wsl.localhost\…` 路径时自动选 `wsl.exe -d <distro> git`，路径通过 `wslpath` 转换（GitRunner 增加 `PathTranslator`）；设置中可显式指定 WSL git。
- **边界**：macOS 的 `/usr/bin/git` shim 在未装 CLT 时会弹系统对话框 → 检测时用 `xcrun --find git` 判断；路径带空格；WSL 中 watcher 性能差 → 自动轮询模式；WSL 与 Windows git 的 CRLF/文件权限差异提示。
- **AC**：三平台自动找到 git；手动指定错误路径时 Test 显示清晰错误；WSL 仓库可完成 status/commit/log。
- **里程碑**：M0（WSL 支持 M7）

### #10 Share project settings via VCS prompt
- **UI**（gitx 适配）：IDEA 的 `.idea` 在 gitx 中对应 **`.gitx/settings.json`**（可共享的仓库级设置：protected branches、commit message template 路径、commit checks、changelist 不适用）。首次在 Settings 中修改「可共享」项时询问：「Share these settings with your team via Git? Always Add / Keep Local / Never Ask」。
- **实现**：`gitx-meta` 合并层（1.13.1）；选择 Share → 写 `.gitx/settings.json` 并 `git add`（进入当前 changelist/Staged，不自动 commit）；Keep Local → 写 `<git-dir>/gitx/repo-settings.json`。
- **边界**：共享文件被他人修改 → watcher 热加载；JSON 无效 → 忽略并 balloon 提示；共享与本地冲突 → 本地覆盖共享（UI 标注来源）。
- **AC**：设置项旁显示来源（Shared/Local）；选择 Always Add 后文件出现在变更中。
- **里程碑**：M8

> **#11 Submodule clone/register — deferred（以后再说）**：#1 预留 `--recurse-submodules` 选项位但隐藏。

---

## B. Remotes / Auth

### #12 `Git.Configure.Remotes` — Manage Remotes
- **UI**：Main Menu `Git | Manage Remotes…`。对话框：多 root 时左侧 repo 列表；表格 Name / URL（fetch）/ Push URL（若不同显示第二行）；工具栏 `+` / `✎` / `−`；双击编辑。也可从 Branches pane 的 Remote 节点进入（#14）。
- **实现**：BE `remote_list` → `git config -z --get-regexp '^remote\..*\.(url|pushurl|fetch)$'`（保留多 URL）；`remote_add{name,url,fetch?}` → `git remote add`；`remote_edit{name,newName?,url?,pushUrl?}` → `git remote rename` / `git remote set-url [--push]`；`remote_remove` → `git remote remove`。FE `features/remotes/ManageRemotesDialog.vue`，`branchesStore` 刷新。
- **边界**：名称校验（`git check-ref-format --branch` 规则 + 不可重名）；URL 校验（本地路径、`file://`、scp 形式 `git@h:p`、https）；重命名 remote 会改动 remote-tracking 分支与 upstream 配置——在确认文本中说明；URL 中凭据脱敏显示。
- **AC**：增改删后 Branches pane 的 Remote 节点即时更新；含多 URL 的 remote 不被破坏。
- **里程碑**：M2

### #13 Define remote（Push dialog）
- **UI**：Push 对话框（#70）中，若当前 repo 没有任何 remote：目标区显示链接「**Define remote**」→ 内嵌小对话框（Name 默认 `origin`、URL）→ 确认后立即用于本次 push 预览，并默认勾选 `--set-upstream`。
- **实现**：复用 `remote_add`；成功后 `push_preview` 重算。
- **边界**：定义 remote 后 push 失败（仓库不存在/无权限）→ remote 仍保留，错误中提供「Edit Remote」。
- **AC**：新 init 的仓库能在 Push 对话框内完成「定义 remote → 首次 push → 设置 upstream」。
- **里程碑**：M2

### #14 Edit / Remove Remote（Branches pane）
- **UI**：Git TW → Log → Branches pane → Remote 节点（如 `origin`）右键：**Edit Remote…**、**Remove Remote…**、Fetch、Copy URL。Remove 确认框列出将被删除的 remote-tracking 分支数量，以及将失去 upstream 的本地分支。
- **实现**：同 #12；删除前 `for-each-ref refs/remotes/<name>` 计数，`git config --get-regexp '^branch\..*\.remote$'` 找受影响分支。
- **边界**：删除被当前分支 upstream 使用的 remote → 警告；正在 fetch 该 remote 时禁止删除。
- **AC**：右键动作与对话框行为一致；删除后 widget incoming/outgoing 计数消失。
- **里程碑**：M2

### #15 Fetch on add remote
- **UI**：Add Remote 对话框底部复选框「Fetch remote after adding」（默认开，记忆上次选择）。
- **实现**：`remote_add` 成功后排队 `fetch_run{remote}`（Network Job，#75 同一实现）。
- **边界**：fetch 失败不回滚 add，balloon「Remote added but fetch failed — Retry / Edit Remote」。
- **AC**：勾选后 Branches pane 出现新 remote 的分支。
- **里程碑**：M2

### #16 Password policy / credential helper
- **UI**：Settings | Appearance & Behavior | System Settings | **Passwords**：`In native Keychain`（默认）/ `Do not save, forget passwords after restart`；Settings | Version Control | Git → 「Use credential helper」（默认开）。认证对话框（askpass 触发）：显示主机与用户名、密码/Token 输入、「Remember」复选框（策略为 Do not save 时隐藏）。SSH passphrase、host key 指纹确认对话框。Settings 中提供「Clear saved passwords」。
- **实现**：见 1.4。BE `askpass_respond{requestId, value|cancel, remember}`；keyring 条目键 `gitx:<protocol>://<user>@<host>`。凭据失败自动清除对应 gitx 条目。
- **边界**：多个并发 job 同时请求同一主机凭据 → 合并为一次对话框（按 host 去重排队）；2FA/OAuth 由用户的 credential helper（如 GCM）自行弹窗 → gitx 不干预，Job 显示「Waiting for credential helper…」；对话框打开时 job 被取消 → 关闭对话框。
- **AC**：无 helper 的 HTTPS 私有仓库可通过对话框认证并记住；错误密码后再次询问而不是死循环（最多 3 次）；日志与 Console 中无明文凭据（自动化测试扫描）。
- **里程碑**：M2

### #17 `Github.Sync.Fork`（通用部分）
- **范围说明**：此条在 #12–17 编号段内，但其 GitHub 专属形态与 **#136 Sync Fork（deferred）重复**。gitx 只实现**与托管平台无关**的「Sync with upstream remote」：不调用 GitHub API。**需协调者确认**（见索引「待确认」）。
- **UI**：当 repo 存在 `upstream` remote（或在 Settings 指定「fork parent remote」）时，Branches pane 中默认分支右键与 VCS Operations Popup 出现 **Sync Fork with 'upstream'**：fetch upstream → 将本地默认分支 rebase/merge（按 Update method）到 `upstream/<default>` → 可选 push 到 origin。
- **实现**：CompositeJob：`fetch upstream` → `checkout`（如不在默认分支则先 smart checkout）→ `merge --ff-only`（失败则按策略 rebase/merge）→ 可选 `push origin <default>`。
- **边界**：本地默认分支有未推送独有 commit → 提示策略；冲突进入 1.14.5 状态机。
- **AC**：fork 场景一键同步默认分支并推送到 origin。
- **里程碑**：M7
