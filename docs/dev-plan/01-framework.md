# Part 1 — 软件框架（Software Framework）

> 返回索引：[../dev-plan.md](../dev-plan.md)
> 本章定义所有功能共用的底座。Part 2 中每个功能只描述「增量」，默认复用本章的 Job、错误、Action、Dialog、Watcher、Safety Snapshot 等机制。

---

## 1.1 总体架构

```text
┌──────────────────────────── Tauri 2 Window (Overlay titlebar) ────────────────────────────┐
│ Vue 3 前端                                                                                │
│  components (layout / tool windows / dialogs / diff / merge / log graph)                 │
│        ▲ 只读 store 状态 + 调用 action                                                     │
│  actions/ (Action Registry：menu / context menu / shortcut / VCS Operations Popup / 命令面板)│
│        ▲                                                                                  │
│  stores/ (Pinia：workspace, repo, changes, log, branches, jobs, settings, ui …)          │
│        ▲                                                                                  │
│  services/ (gitService, jobService, dialogService, notificationService …)                │
│        ▲                                                                                  │
│  lib/backend (generated bindings.ts + tauri adapter / mock adapter)                       │
├────────────────────────────── IPC：invoke / Channel / Event ──────────────────────────────┤
│ Rust (src-tauri app crate：commands, events, menu, tray, AppState)                        │
│  crates/gitx-core      领域类型、错误码、RepoId/JobId、设置 schema                           │
│  crates/gitx-git       GitRunner（进程/取消/进度/env）、porcelain 解析、操作编排（ops/*）       │
│  crates/gitx-read      gitoxide (gix) 只读快路径：rev-walk、对象/blob、refs、tree             │
│  crates/gitx-graph     Log 图布局（lane 分配、分页）                                         │
│  crates/gitx-diff      文本 diff（imara-diff）、word diff、三方合并模型、partial stage 构造     │
│  crates/gitx-index     Git Log Indexing（SQLite）                                         │
│  crates/gitx-watch     文件系统 watcher（notify + debounce + 分类）                          │
│  crates/gitx-meta      gitx 自有元数据：changelists、shelf、favorites、backups、per-repo UI 状态 │
│  crates/gitx-helper    独立小二进制：askpass / editor / sequence-editor（sidecar）           │
│  crates/gitx-testkit   fixture 仓库生成器（测试专用）                                         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                           │ spawn
                           ▼
                     系统 git CLI（≥ 2.31；部分功能按版本门控）
```

**原则**

1. **Git CLI 是唯一的写入者**（source of truth for mutations）；gitoxide 只做只读加速，且任何只读结果都能回退到 CLI。
2. **后端无 UI 语义**：后端返回结构化数据/错误码；文案、i18n、确认流程在前端。
3. **所有长操作都是 Job**：可取消、可观察进度、有日志、落到 Console。
4. **所有破坏性操作先做 Safety Snapshot**（见 1.14.4），用户工作永不丢失。
5. **UI 由 Action Registry 驱动**：菜单、右键、快捷键、VCS Operations Popup、工具栏、命令面板共用一份 Action 定义。

---

## 1.2 Git 引擎选型：CLI vs git2 vs gitoxide

| 维度 | git CLI | git2 (libgit2) | gitoxide (gix) |
|---|---|---|---|
| 与用户 `git` 行为一致（config、hooks、credential helper、GPG/SSH 签名、LFS filter、sparse-checkout、partial clone、`includeIf`、`core.fsmonitor`） | ✅ 完全一致 | ❌ hooks 不执行、filter/LFS/签名/部分协议缺失 | ⚠️ 读路径大多一致；写路径（merge/rebase/push、hooks、filter）不完整 |
| 性能（大仓库 log/blob/refs） | ⚠️ 进程开销、需解析文本 | ✅ | ✅✅（并行、commit-graph、内存友好） |
| 进度 / 取消 | ✅ `--progress` 解析 + kill 进程组 | ⚠️ 回调 | ✅ 有 interrupt 机制 |
| 维护风险 | 低（稳定 porcelain） | 中（C 依赖、OpenSSL/ssh 构建） | 中（API 演进快） |
| 用户可在 Console 复现 | ✅ | ❌ | ❌ |

**决策：Hybrid，CLI-first。**

- **写操作 & 网络操作 100% 走 git CLI**：commit、checkout、merge、rebase、cherry-pick、stash、reset、fetch/pull/push、clone、worktree、tag、branch。理由：hooks、credential helper、签名、LFS、用户 `.gitconfig` 行为必须与终端一致；用户可在 Console 复制命令复现。
- **只读热路径用 gix（`gitx-read`）**：Log rev-walk + commit 元数据、blob 读取（diff 两侧内容）、refs 列表、tree 浏览（#107）、ahead/behind 计算。每个 gix 读接口都有 CLI 等价实现（`GitReadBackend` trait 双实现），设置项 `advanced.readBackend = auto|cli` 可强制 CLI；gix 打开失败（未知扩展、`extensions.*` 不支持、replace refs 等）时自动回退并在 diagnostics 记录。
- **不引入 git2**：避免 C 依赖与行为分叉。
- **status 走 CLI**：`git --no-optional-locks status --porcelain=v2 -z --branch` 稳定且尊重 fsmonitor/untracked cache；gix status 成熟后再评估。
- **最低 git 版本 2.31**（`--force-if-includes` 2.30、`switch/restore` 2.23）。按版本门控的特性：`rebase --update-refs`（2.38）、`merge-tree --write-tree`（2.38，用于内存冲突预测/in-memory 操作）、`for-each-ref %(ahead-behind:)`（2.41），低版本降级到等价多命令实现。

### 1.2.1 统一 Git 调用约定

所有 CLI 调用经 `GitRunner::command(repo)` 构造，自动注入：

```text
git -c core.quotepath=false -c color.ui=false -c core.pager=cat
    -c log.showSignature=false -c advice.*=false(按需)
    [--no-optional-locks  ← 只读命令]
env:
  GIT_TERMINAL_PROMPT=0
  GIT_ASKPASS=<gitx-helper> ; SSH_ASKPASS=<gitx-helper> ; SSH_ASKPASS_REQUIRE=force
  GIT_EDITOR=<gitx-helper editor>        (仅需要编辑消息的流程)
  GIT_SEQUENCE_EDITOR=<gitx-helper seq>  (仅 interactive rebase)
  GITX_IPC_ADDR / GITX_IPC_TOKEN         (helper 回连 app)
  LC_ALL=C (仅用于需要解析英文 stderr 的命令；输出内容一律 -z / %x00 分隔，按 i18n.logOutputEncoding 解码)
  GIT_OPTIONAL_LOCKS=0 (只读)
cwd = repo worktree root
stdin = null（除非显式 piping，如 hash-object --stdin）
```

- 输出格式一律机器可读：`--porcelain=v2 -z`、`--format=%H%x00…%x1e`、`for-each-ref --format`、`push --porcelain`、`worktree list --porcelain`、`blame --porcelain/--incremental`。
- 文件路径一律 `-z` + `--` 分隔 + 字节安全（Rust 侧 `OsString`/`Vec<u8>`，前端展示 lossy UTF-8 并保留原始字节 handle）。
- 超长 pathspec（Windows 命令行 32K 限制）→ 使用 `--pathspec-from-file=- --pathspec-file-nul` 经 stdin 传递。

---

## 1.3 进程管理、取消、进度流

### 1.3.1 GitRunner

```rust
pub struct GitInvocation { repo: RepoId, args: Vec<OsString>, kind: OpKind, stdin: Option<Bytes>, timeout: Option<Duration>, env: Env }
pub enum OpKind { Read, Write, Network, NetworkWrite }   // 决定调度策略
pub async fn run(inv, ctx: &JobCtx) -> Result<GitOutput, GitError>
pub fn stream(inv, ctx) -> impl Stream<Item = GitLine>  // log/blame 等流式
```

- 基于 `tokio::process`；Unix `setsid()` 建新进程组，Windows 用 **Job Object**（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）——取消时杀整棵子进程树（git → ssh → credential helper → hooks）。
- 取消：`JobCtx.cancel_token`（`tokio_util::CancellationToken`）→ 先 SIGINT/CTRL_BREAK（让 git 清理 lock），2s 后强杀；结束后检查残留 `index.lock` 是否属于本次进程，是则清理。
- 超时：只读命令默认 30s（可配置），网络命令无硬超时但有「无输出 N 秒」心跳提示（不自动杀）。
- 每次调用记录：命令行（脱敏）、cwd、起止时间、退出码、stderr 尾部 → 写 Console 与 tracing。

### 1.3.2 Repo 调度器（RepoScheduler）

每个 repo 一个调度器，避免 `index.lock` 竞争：

| OpKind | 并发规则 |
|---|---|
| `Read` | 任意并发（`--no-optional-locks`） |
| `Write` | 与其他 `Write`/`NetworkWrite` 互斥，FIFO |
| `Network`（fetch、ls-remote） | 同 remote 串行；与 Write 可并行（fetch 只写 refs/remotes，用 `--no-write-fetch-head` 时更安全） |
| `NetworkWrite`（pull、push、clone） | 与 Write 互斥 |

- 用户触发的 Write 若前面有自动 fetch 在跑：自动 fetch 可被抢占（取消）。
- 发现外部 `index.lock`：重试 3 次（100/300/900ms），仍存在 → 错误码 `IndexLocked`，UI 提供「Remove lock file」（需确认，并检测是否有 git 进程运行）。

### 1.3.3 Job 系统与进度

```ts
type JobId = string
interface JobInfo { id; kind: JobKind; title: I18nKey|string; repoIds: RepoId[]; cancellable: boolean; startedAt; background: boolean }
// events
'job://started'  JobInfo
'job://progress' { id, phase?: string, percent?: number, current?: number, total?: number, bytes?: number, message?: string }
'job://log'      { id, stream: 'stdout'|'stderr'|'cmd', line: string }   // → Console
'job://finished' { id, ok: boolean, error?: AppError, summary?: unknown }
```

- 进度解析：git `--progress` 的 stderr 以 `\r` 刷新（`Receiving objects:  45% (450/1000), 1.2 MiB | 2 MiB/s`），`ProgressParser` 识别 phase（Counting/Compressing/Receiving/Resolving deltas/Writing objects/Updating files/Checking out）+ 百分比，节流 10Hz 发事件。
- 多步编排（如 Update Project：fetch ×N repos → merge/rebase ×N）使用 `CompositeJob`，进度按步骤加权。
- 前端：`jobsStore` → 状态栏进度条（多 job 显示「2 processes running」可展开列表，每项可 Cancel）；前台 job（用户正在等待的 Pull/Push）同时在 toast 中显示 loading 态。

### 1.3.4 流式数据（Tauri 2 Channel）

大结果（Log 分页、blame incremental、文件历史、Combined Diff 列表）使用 `tauri::ipc::Channel<T>` 按块推送，前端边收边渲染；请求带 `requestId`，新请求到来时取消旧请求（如 Log 过滤条件变化）。

---

## 1.4 凭据与 askpass（credentials）

- **gitx-helper**（独立 console 子系统小二进制，作为 Tauri `externalBin` sidecar 打包）子命令：
  - `askpass <prompt>`：git/ssh 需要用户名/密码/passphrase/host key 确认时调用；
  - `editor <file>`：git 需要编辑提交消息时（squash 合并消息、merge 消息等）；
  - `seq-editor <todo>`：interactive rebase 写入前端准备好的 todo。
- helper 通过本地 IPC（Unix domain socket 于 `$XDG_RUNTIME_DIR`/app data 目录 0700，Windows named pipe 带 ACL；`interprocess` crate）回连 app，携带每次 Job 生成的一次性 token（`GITX_IPC_TOKEN`），app 校验 token 与 jobId 后在前端弹出对应对话框，阻塞直到用户提交或取消（取消 → helper 非零退出 → git 认证失败 → 错误码 `AuthCancelled`）。
- 对话框类型：Username/Password（带「Remember」）、SSH passphrase、SSH host key 确认（yes/no，显示指纹）、GPG 无法在此提示（依赖 pinentry，见 #63）。
- **密码策略（#16）**：Settings | Passwords = `Native keychain`（`keyring` crate：macOS Keychain / Windows Credential Manager / Secret Service）| `Do not save`（仅进程内会话缓存）。
  - `Use credential helper`=on（默认）：不覆盖用户 `credential.helper`，git 先走系统 helper，只有 helper 无结果时才落到 askpass；
  - off：注入 `-c credential.helper=` 清空，凭据只由 gitx keychain 提供（askpass 先查 keychain，命中则静默返回）。
- 认证失败（`Authentication failed`、`Permission denied (publickey)`）→ 错误码 `AuthFailed`，若来自 gitx keychain 条目则自动删除该条目并提示重新输入。
- **安全**：密码只在内存与 OS keychain 中，不写日志、不进 Console（命令行与 URL 统一脱敏 `https://***@host`）。

---

## 1.5 文件系统 Watcher（gitx-watch）

- `notify` + `notify-debouncer-full`，每个 repo 监听 worktree 根 + git dir（`--git-dir` 与 `--git-common-dir` 分别监听，兼容 worktree）。
- 事件分类：

| 路径 | 分类 | 触发刷新 |
|---|---|---|
| worktree 文件（排除 `.git/`） | `Worktree` | status（debounce 300ms，大仓库自适应到 1–2s） |
| `.git/index` | `Index` | status |
| `.git/HEAD`、`refs/**`、`packed-refs`、`FETCH_HEAD` | `Refs` | branches、widget、log 头部增量 |
| `MERGE_HEAD`、`rebase-merge/`、`rebase-apply/`、`CHERRY_PICK_HEAD`、`REVERT_HEAD` | `OpState` | repo state 状态机 |
| `.git/objects/**`、`.git/logs/**` | 忽略 | — |
| `.gitignore`、`.git/info/exclude` | `Ignore` | status + ignored 列表 |

- gitx 自己的 Write 操作期间暂停该 repo 的 watcher 事件，结束后合并为一次刷新（避免中间态闪烁）。
- 降级：watch 句柄耗尽（Linux inotify limit）/网络盘 → 自动切换为轮询（窗口聚焦时 + 每 5s），状态栏提示并给出 `fs.inotify.max_user_watches` 帮助链接。
- 窗口获得焦点时总是做一次轻量刷新（与 IDEA 行为一致）。
- 发出 `repo://changed { repoId, kinds: ChangeKind[], version }`。

---

## 1.6 Multi-root / Workspace 模型

```text
Workspace（= 用户打开的文件夹或 .gitx-workspace 文件）
  └─ roots: Repo[]   每个 Repo { id, worktreeRoot, gitDir, commonDir, isWorktree, color, displayName }
```

- 打开文件夹：`git rev-parse --show-toplevel --git-dir --git-common-dir` 定位主 repo；可选向下扫描嵌套 repo（深度 ≤ 4，跳过 `node_modules`/`target`/大目录），结果展示在 Settings | Version Control | Directory mappings，用户可增删（等价 IDEA VCS 映射）。
- 所有后端命令都显式携带 `repoId`（或 `repoIds[]`），不存在「当前 repo」的隐式后端状态。
- 前端 `workspaceStore.activeRepoId` 由选中上下文决定（选中文件所属 repo、VCS Widget 选择）；多 repo 视图（Log、Commit、Push、Update Info）按 repo 分组或用颜色条区分（#102）。
- 子模块：识别 `.gitmodules` 并显示为只读 root 标记；注册为独立 root 属于 #11（deferred），仅 #81 的 update 行为在范围内。

---

## 1.7 IPC 契约（Command / Event）

### 1.7.1 生成与命名

- Rust 侧 `#[tauri::command] #[specta::specta]`，用 **tauri-specta** 生成 `apps/desktop/src/lib/backend/bindings.ts`（类型 + 调用函数），CI 校验生成结果无 diff。
- 命名：`<domain>_<verb>`，例：`status_get`、`diff_file`、`stage_lines`、`commit_create`、`branch_checkout`、`push_run`、`log_query`。
- 所有命令签名统一：`fn x(req: XReq, state, [channel]) -> Result<XRes, AppError>`；**长操作返回 `JobHandle { jobId }` 立即返回**，结果走 `job://finished`。
- 前端通过 `lib/backend/index.ts` 的 `Backend` 接口调用，提供 `tauriBackend` 与 `mockBackend`（用于 vitest、Playwright web e2e、UI 开发 `pnpm dev:web`）。

### 1.7.2 命令目录（按域，Part 2 引用这些名字）

| 域 | 命令（节选） |
|---|---|
| app | `app_info`, `git_detect`, `git_test_executable`, `settings_get/set`, `diagnostics_export`, `open_external`, `reveal_in_file_manager` |
| workspace | `workspace_open`, `workspace_close`, `workspace_recent`, `repo_discover`, `repo_mappings_set`, `repo_state_get` |
| status | `status_get`, `ignored_list`, `file_read_worktree`, `file_write_worktree` |
| index | `stage_paths`, `unstage_paths`, `stage_hunks/lines`, `unstage_hunks/lines`, `add_paths(force)`, `rm_cached` |
| changes | `rollback_paths`, `rollback_lines`, `changelist_*`（gitx-meta） |
| diff | `diff_file`（返回两/三侧内容 + hunks）, `diff_commit_files`, `diff_refs`, `diff_combined_stream`, `blob_read` |
| commit | `commit_create`, `commit_message_history`, `commit_template_get`, `commit_checks_run` |
| branch | `refs_list`, `branch_create/checkout/rename/delete/restore/update/compare/merged`, `branch_set_upstream` |
| tag | `tag_create/delete/push/reassign` |
| remote | `remote_list/add/edit/remove`, `fetch_run`, `pull_run`, `update_project_run`, `push_preview`, `push_run`, `ls_remote_check` |
| history | `log_query`(Channel), `log_commit_details`, `log_graph_page`, `file_history`, `selection_history`, `blame_stream`, `tree_list` |
| rewrite | `merge_run/abort/commit`, `rebase_run/continue/skip/abort`, `rebase_interactive_plan/start`, `cherry_pick_run/continue/abort`, `revert_run`, `reset_run`, `reword_commit`, `squash_commits`, `fixup_into`, `drop_commits`, `extract_changes`, `drop_changes`, `uncommit` |
| conflicts | `conflicts_list`, `conflict_versions`（base/ours/theirs）, `conflict_accept_side`, `conflict_save_result`, `conflict_mark_resolved` |
| stash/shelf | `stash_list/create/apply/pop/drop/clear/branch`, `shelf_list/create/unshelve/delete/import/restore` |
| patch | `patch_create`, `patch_apply_check`, `patch_apply` |
| ignore | `ignore_add`, `exclude_open` |
| worktree | `worktree_list/add/remove/prune/lock/unlock` |
| setup | `clone_run`, `unshallow_run`, `init_run`, `vcs_enable` |
| jobs | `job_cancel`, `job_list` |
| askpass | `askpass_respond`, `editor_respond` |

### 1.7.3 事件

| 事件 | payload | 消费者 |
|---|---|---|
| `repo://changed` | `{repoId, kinds, version}` | repo/changes/branches/log stores |
| `repo://state` | `{repoId, state: RepoOpState}` | 冲突/进行中操作横幅、VCS Widget |
| `job://started/progress/log/finished` | 见 1.3.3 | jobsStore、Console、toast |
| `askpass://request` | `{requestId, jobId, kind, prompt, url?, fingerprint?}` | 凭据对话框 |
| `editor://request` | `{requestId, jobId, kind: 'commitMessage'|'squashMessage', initial}` | 消息编辑对话框 |
| `incoming://changed` | `{repoId, branch, incoming, outgoing, hasUnfetched}` | VCS Widget、Branches |
| `notify://backend` | `{level, code, args, actions[]}` | 后台自动任务（auto fetch 失败等）通知 |

**版本号**：每个 repo 维护单调 `version`；每个查询响应带 `version`，store 丢弃比本地旧的响应（防止竞态回退）。

---

## 1.8 错误模型

```ts
interface AppError {
  code: ErrorCode            // 稳定枚举，前端据此选文案与恢复动作
  message: string            // 英文技术摘要（日志用）
  args?: Record<string, unknown>   // i18n 参数（分支名、文件列表…）
  gitStderr?: string         // 已脱敏，Details 折叠展示
  command?: string           // 已脱敏，可复制
  exitCode?: number
  recover?: RecoverAction[]  // 例：['stash_and_retry','force_checkout','open_conflicts','pull_then_push','remove_lock']
}
```

**ErrorCode（首批）**：`GitNotFound`, `GitTooOld`, `NotARepository`, `RepoNotFound`, `IndexLocked`, `DirtyWorktreeWouldBeOverwritten{files}`, `UntrackedWouldBeOverwritten{files}`, `MergeConflict{files}`, `RebaseConflict`, `CherryPickConflict`, `NothingToCommit`, `EmptyCommitMessage`, `HookFailed{hook, output}`, `GpgSignFailed`, `AuthFailed`, `AuthCancelled`, `HostKeyRejected`, `NetworkError`, `RemoteNotFound`, `PushRejectedNonFastForward{refs}`, `PushRejectedProtected`, `PushRejectedHook`, `NoUpstream`, `BranchExists`, `BranchNotFullyMerged`, `CannotDeleteCheckedOut`, `WorktreeBranchInUse`, `DetachedHead`, `OperationInProgress{kind}`, `PatchDoesNotApply{files}`, `ShallowRepositoryLimitation`, `Cancelled`, `Timeout`, `FsError`, `Internal`.

- `StderrClassifier`：基于 `LC_ALL=C` 下英文 stderr 正则 + 退出码 + `--porcelain` 输出映射到 ErrorCode；未识别 → `GitCommandFailed`（展示原始 stderr）。分类规则有单元测试（fixtures 收集多 git 版本的真实 stderr）。
- 前端 `errorPresenter`：按 code 决定呈现方式——可恢复错误（Dirty worktree、Push rejected、Conflicts）走专用对话框；网络/认证走带 Retry 的 notification；未知错误走 notification + 「Show details / Copy command / Open Console」。
- 永不吞错：后台任务失败至少进入 Notifications 历史。

---

## 1.9 前端分层

```text
apps/desktop/src/
  main.ts / App.vue
  lib/backend/        bindings.ts(生成) · tauri.ts · mock/ · index.ts(Backend 接口)
  lib/platform/       os 检测、Mod 键、路径显示
  services/           gitService(薄封装 + 错误映射) · jobService · dialogService · notificationService
                      clipboardService · windowService(多窗口) · fileOpenService
  stores/             见下表
  actions/            registry.ts · context.ts · groups.ts · keymap.ts · definitions/<area>.ts
  composables/        useAction, useShortcut, useContextMenu, useVirtualList, useRepoQuery(带 version 去重)
  components/ui/      shadcn-vue / reka-ui 原语（从 dbx 模式移植）
  components/layout/  TitleBar, MainToolbar, ToolWindowStripe, ToolWindowHost, EditorTabs, StatusBar
  components/common/  ToastHost, NotificationBalloons, ConfirmDialog, EmptyState, ErrorState, Loading, FileTree, CommitList
  features/           welcome · commit(changes/staging/changelists) · diff · merge · log · history · annotate
                      branches · tags · remotes · sync(fetch/pull/push/update) · rewrite · stash · shelf · patch
                      ignore · worktrees · console · update-info · settings · repo-at-revision
  i18n/locales/       zh-CN.json · en.json
  styles/             tokens.css · globals.css · vcs-tokens.css
```

### Pinia stores

| Store | 职责 |
|---|---|
| `workspaceStore` | 打开的 workspace、roots、activeRepoId、recent |
| `repoStore(repoId)`（工厂/Map） | repo 元信息、`RepoOpState`、HEAD、upstream、version |
| `changesStore` | status 结果、按 changelist/staging 分组的树、选择、过滤、显示 ignored |
| `commitStore` | 提交消息草稿（持久化）、amend、作者、选项、检查结果 |
| `branchesStore` | refs、favorites、recent、incoming/outgoing、分组设置 |
| `logStore`（多实例，每个 Log tab 一个） | 过滤器、分页数据、选中 commit、details 缓存、graph 选项 |
| `diffStore` | 打开的 diff 会话（每 tab 一个） |
| `conflictsStore` | 冲突文件列表、每文件解决状态 |
| `stashStore` / `shelfStore` | 列表 & 选择 |
| `jobsStore` | 运行中/最近 jobs、进度、日志环形缓冲 |
| `consoleStore` | 命令历史（按 repo，环形 5000 行） |
| `notificationsStore` | toast、balloon、历史 |
| `settingsStore` | app 设置 + per-repo 设置（schema 版本化） |
| `layoutStore` | tool window 可见性/尺寸/停靠、editor tabs、splitter 尺寸 |
| `actionStore` | registry 运行时（keymap 覆盖、最近使用） |

规则：组件不直接调用 backend；store 不直接弹窗（通过 service 返回结果，由 action 编排交互）。

---

## 1.10 布局（Layout）——IDEA 结构 × dbx 外观

```text
┌ TitleBar (overlay, 40px) ──────────────────────────────────────────────────────────────┐
│ [≡ Main Menu] [Project ▾ widget] [⎇ main ↓2 ↑1  VCS Widget] ··drag·· [⟳ Update][✓ Commit][↑ Push][🕘 History][↶ Rollback] [⌕] [⚙] [window controls] │
├──┬──────────────────────────────────────────────────────────────────────────────────┬──┤
│S │ Left Tool Window: Commit (Alt+0)          │ Editor Tabs (Diff / File / Merge /     │S │
│t │  ├ toolbar (refresh, rollback, diff,      │   Repository at Revision / Compare …)  │t │
│r │  │  group by, expand…)                    │                                        │r │
│i │  ├ Changes tree (changelists / staging)   │                                        │i │
│p │  └ Commit message + options + [Commit]    │                                        │p │
│e ├───────────────────────────────────────────┴────────────────────────────────────────┤e │
│  │ Bottom Tool Window: Git (Alt+9)  tabs: [Log] [Log: feature-x] [Console] [Update Info] [Stash] [Shelf] [Worktrees] │
│  │   Log：Branches pane | Commits(graph) | Changed Files | Commit Details              │
├──┴──────────────────────────────────────────────────────────────────────────────────┴──┤
│ StatusBar: ⏳ jobs · repo state banner 摘要 · line sep · 🔔 notifications · ⎇ branch      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **TitleBar**：dbx Overlay titlebar + WindowControls；Windows/Linux 左侧「≡」打开 Main Menu（Git 主菜单组 #121，含 File/Git/View/Window/Help）；macOS 同时注册原生菜单（Git 菜单项由 Action Registry 生成）。
- **Tool Window 体系**：左/下/右三个 anchor；每个 tool window 有 stripe 按钮、快捷键、可隐藏、可调尺寸、可切换停靠 anchor（拖动 stripe 按钮），持久化到 `layoutStore`。首期内置：Commit（左，Alt+0）、Git（下，Alt+9）、Notifications（右）。Commit TW 可切换「Window/Float」模式（#69）——用 Tauri 多窗口实现。
- **Editor Tabs**：dbx tab 模型（关闭/重开/关闭其他、`Mod+W`、`Shift+Mod+T`、拖拽排序、预览 tab = 斜体单击打开，双击固定）。Diff 也可「在新窗口打开」（Settings: Diff in editor tab vs window）。
- **Panels**：splitpanes，尺寸按 tool window/tab 类型持久化。
- **Zen/专注**：`Shift+Mod+F12` 隐藏所有 tool window（IDEA Hide All Tool Windows 同语义）。
- 最小窗口 900×600：小宽度下 Log 的 Branches pane、Commit Details 自动折叠为可切换按钮。

---

## 1.11 Action Registry（单一动作注册表）

```ts
interface ActionDef {
  id: string                 // 'Git.Fetch' —— 尽量沿用 IDEA action id
  title: I18nKey             // 可带动态标题函数 (ctx)=>string，例 "Merge 'x' into 'main'"
  description?: I18nKey
  icon?: LucideIcon
  defaultShortcuts?: { mac?: string[]; win?: string[]; linux?: string[] }
  scope?: 'global'|'changes'|'log'|'branches'|'diff'|'merge'|'editor'   // 快捷键作用域
  when?: (ctx) => boolean     // 可见性
  enabled?: (ctx) => boolean | { enabled: false, reason: I18nKey }
  destructive?: boolean
  run: (ctx: ActionContext) => Promise<void>
}
interface ActionGroup { id: string; title?: I18nKey; children: (string /*action|group id*/ | '-')[]; popup?: boolean }
```

- **ActionContext**：`{ repoIds, selection: { files?, changelist?, commits?, refs?, stash?, shelf?, lines? }, source: 'menu'|'context'|'shortcut'|'popup'|'toolbar'|'palette', place: string }`，由当前焦点组件通过 `provideActionContext()` 提供。
- **组**（与 IDEA 对应）：`Git.MainMenu`（File/LocalChanges/Merge/Rebase 子组）、`Git.ContextMenu.Changes`、`Git.Log.ContextMenu`、`Git.Branches.Popup`、`Git.Branch.ContextMenu`、`Git.Tag.ContextMenu`、`Git.Stash.ContextMenu`、`Vcs.Operations.Popup`、`MainToolbar.VcsQuickActions`、`Diff.Toolbar`、`Merge.Toolbar`、`Editor.Gutter.VcsPopup`。
- **消费方**：MainMenu、原生菜单（macOS）、`CustomContextMenu`（dbx 组件）、ShortcutDispatcher、VCS Operations Popup（#120）、MainToolbar（#122）、命令面板（`Mod+Shift+A` Find Action，全部 action 可搜索）。
- **Keymap（#124）**：默认 keymap = IDEA（Win/Linux 与 macOS 两套）；用户覆盖保存在 settings；冲突检测；作用域优先级 `modal > focused component scope > global`；dbx 规则「modal 拥有 `Mod+W`/Escape」。
- disabled 时在菜单中显示灰色并 tooltip 说明原因（如「Rebase in progress」「Protected branch」）——易用性要求：不隐藏关键 Git 动作，只禁用并解释。

---

## 1.12 反馈系统：Toast / Balloon / Dialog / Notifications

| 类型 | 用途 | 规则 |
|---|---|---|
| **Toast**（dbx，底部居中） | 轻量即时反馈：复制成功、已 stage、快速撤销提示 | 2s 自动消失；可带 1 个动作 |
| **Balloon**（右下，IDEA 风格） | VCS 结果：「Pushed 3 commits to origin/main」、「Deleted branch x — Restore / View commits」、「Fetch failed — Retry」 | 成功 5s 消失、警告/错误常驻；最多 3 个，其余进 Notifications |
| **Notifications Tool Window** | 历史记录、未读计数（状态栏铃铛） | 所有 balloon 与后台错误都留存（会话内 + 最近 200 条持久化） |
| **Dialog** | 需要决定的操作（Push、Merge、Rebase、Conflicts、确认破坏性操作） | `dialogService.open(Comp, props) → Promise<Result>`；ESC 取消；主按钮回车；破坏性按钮 `destructive` 变体且非默认焦点 |
| **Confirm with "Don't ask again"** | 例：Rollback、Delete branch、Force push | 选择写入 Confirmation 设置（#118），设置页可恢复 |
| **Repo State Banner** | Merge/Rebase/Cherry-pick 进行中、冲突未解决、Detached HEAD | 显示在 Commit TW 顶部与 Log 顶部，带 Continue/Abort/Skip/Resolve |

---

## 1.13 设置持久化 / 主题 / i18n / 诊断

### 1.13.1 设置

- **App 级**：`<app_config_dir>/settings.json`，带 `schemaVersion` + 迁移函数；Rust 侧 `serde` 结构为权威 schema，经 specta 生成 TS 类型；写入原子（tmp + rename）。
- **Repo 级（不污染工作树）**：`<git-common-dir>/gitx/`：`repo-settings.json`、`changelists.json`、`shelf/`、`favorites.json`、`ui-state.json`（tab/布局/每分支工作区 #34）、`commit-drafts.json`、`log-index.sqlite`（#103）。worktree 私有的（changelists、drafts）放 `<git-dir>/gitx/`。
- **可共享项目设置（#10）**：`.gitx/settings.json`（protected branches、commit template、ignored 规则提示等），首次产生时询问是否纳入 Git。
- 优先级：repo 共享 < app 全局 < repo 本地（与 git config 层级对用户一致的心智）。

### 1.13.2 主题 tokens

沿用 dbx `tokens.css`（pearl 等调色板、`.dark`、corner style、density）。新增 `vcs-tokens.css` 语义 token（所有调色板必须定义亮/暗两套）：

| 类别 | Tokens |
|---|---|
| 文件状态（#54，可在设置覆盖） | `--vcs-modified`(blue) `--vcs-added`(green) `--vcs-deleted`(gray) `--vcs-renamed` `--vcs-unversioned`(red-brown) `--vcs-ignored`(olive) `--vcs-conflict`(red) `--vcs-merged-with-conflicts` `--vcs-changelist-inactive` |
| Diff | `--diff-insert-bg/-strong` `--diff-delete-bg/-strong` `--diff-modify-bg` `--diff-conflict-bg` `--diff-word-insert` `--diff-word-delete` `--diff-gutter-*` |
| Gutter（#55） | `--gutter-added` `--gutter-modified` `--gutter-deleted` |
| Log | `--graph-lane-0…11` `--ref-head` `--ref-local` `--ref-remote` `--ref-tag` `--commit-unpushed` `--commit-cherry-picked`(dim) `--root-stripe-0…7` |
| Sync | `--incoming`(blue) `--outgoing`(green) |
| Annotate | `--annotate-age-0…9`（新→旧渐变） |

### 1.13.3 i18n

- vue-i18n，首发 `zh-CN`、`en`；所有 chrome 文案走 key，后端只返回 code + args。
- **术语表**（`i18n/glossary.md`）：zh-CN 中 Git 核心术语保留英文以对齐 IDEA 与命令行心智（Commit、Push、Pull、Fetch、Merge、Rebase、Cherry-pick、Stash、Shelve、Changelist、Amend、Reword、Squash、Fixup、Worktree、Tag、Remote、Upstream、HEAD），描述性文字中文化（例：「Push 3 个 commit 到 origin/main」）。
- 日期/相对时间用 `Intl`；commit 内容（作者、消息）原样显示，不翻译。

### 1.13.4 诊断（Diagnostics）

- Rust `tracing` + 滚动文件（`<app_log_dir>/gitx.log`，7 天）；前端错误经 `log_frontend` 汇入同一日志。
- 统一脱敏层：URL 凭据、`Authorization`、token-like 字符串（`ghp_…`、`glpat-…` 等正则）、askpass 响应永不记录。
- **Console tab（#123）** 即用户可见的命令日志。
- `Help | Collect Diagnostics`：导出 zip（版本信息、git version、OS、设置（去敏）、近期日志、性能计数），不含仓库内容。
- 性能埋点：命令耗时直方图、status/log 首屏时间、长帧（>50ms）计数——仅本地，开发模式显示 Perf HUD。
- panic hook：记录并以 balloon 告知「后台出现内部错误」+ 导出诊断入口；不崩溃窗口。

---

## 1.14 横切质量：易用性 / 美观性 / 健壮性

### 1.14.1 易用性

- **IDEA 心智一致**：动作名、位置、快捷键（`Ctrl+K`、`Ctrl+Shift+K`、`Ctrl+T`、`Alt+9`、`Alt+0`、`Alt+\``、`Ctrl+D`、`Ctrl+Alt+Z`）默认与 IDEA 相同；macOS 采用 IDEA macOS keymap。
- **Discoverability**：所有动作可在 Find Action（`Mod+Shift+A`）搜到；disabled 有原因；空状态给下一步按钮（「No changes. Fetch / Pull?」）。
- **可撤销优先于确认**：低风险操作（stage、changelist 移动、删除分支）直接执行 + Restore/Undo；高风险（hard reset、force push、clear stash）才弹确认。
- **键盘可达**：所有列表/树支持方向键、Space 切换勾选、Enter 打开、`F4` 跳转源、`Ctrl+D` diff、类型即搜（speed search）。
- **错误可行动**：每个错误对话框给出 1–3 个恢复按钮 + 详情折叠。
- **多 repo 透明**：单 repo 时隐藏所有 repo 选择器。

### 1.14.2 美观性

- dbx 视觉语言：紧凑（控件 h-8、13px）、中性色、4px 圆角、短动效；IDEA 布局但不复制 Swing 视觉。
- Log graph 抗锯齿 canvas、lane 颜色稳定（同一分支跨页颜色一致）、ref 标签胶囊（HEAD 加粗、tag 不同形状）。
- Diff 编辑器：等宽字体 13px、行内 word diff、平滑同步滚动、连接带（connectors）贝塞尔曲线（IDEA 风格）。
- 一致的 Empty/Loading/Error 组件；骨架屏只用于 >300ms 的加载。
- 亮暗主题、所有调色板必须通过 vcs-tokens 对比度检查（WCAG AA，状态色在 sidebar/content 背景上）。

### 1.14.3 健壮性：大仓库与性能预算

**基准仓库**：linux kernel（~1.3M commits、~80k files）、chromium 子集、自造 200k untracked 文件仓库、单文件 50MB、单 commit 10k files。

| 场景 | 预算（M 级硬件、SSD） |
|---|---|
| 冷启动到窗口可交互 | ≤ 1.5s |
| 打开 repo 到 Changes 首次显示（80k files，干净） | ≤ 1.5s（status 异步，先显示骨架） |
| Log 首屏 100 行（1M commits） | ≤ 400ms；滚动 60fps；按需分页 1000 行/页 |
| Log 文本/作者过滤（有 index #103） | ≤ 300ms；无 index ≤ 3s 并流式出结果 |
| 文件 diff（≤ 10k 行） | ≤ 150ms 呈现；> 5MB 或 binary → 占位 + 「Show anyway」 |
| Branches 列表 5k refs | ≤ 200ms，虚拟化 |
| status 刷新（watcher 触发） | 不阻塞 UI；结果 diff 增量更新树（保持选择与展开） |
| 内存 | 常驻 ≤ 400MB（1M commit log 已加载时） |

- **虚拟化**：Changes 树、Log、Branches、Changed Files、Console、Blame 列表全部虚拟化（vue-virtual-scroller 或自研固定行高列表）；树扁平化为可见行数组。
- **主线程保护**：大 JSON 不过 IPC——log 用分页 + 紧凑二进制/数组编码（`[sha_idx, parents, lanes…]`）；graph 布局在 Rust。
- **untracked 爆炸**：untracked > 5k 时折叠为目录汇总 + 提示添加 `.gitignore`；`status.showUntrackedFiles` 尊重用户配置。

### 1.14.4 长操作与「永不丢失用户工作」

1. **Safety Snapshot**：执行以下操作前自动快照——`reset --hard/--keep`、`checkout -f`、Rollback（含行级）、`stash drop/clear`、Update 策略 Reset to Remote、Drop commit、interactive rebase、discard 冲突解决。实现：`git stash create`（不改工作树）得到 commit → `git update-ref refs/gitx/backup/<ts>-<op> <sha>`；untracked 文件删除改为移入 OS 回收站（`trash` crate）；被丢弃的 stash/commit sha 写入 `refs/gitx/backup/*`。保留期默认 14 天（设置），启动时 GC 过期 refs。操作完成的 balloon 提供「Undo」/「Restore」。
2. **提交消息草稿**持久化（每 repo/changelist），崩溃或切分支不丢。
3. **Interactive rebase 计划**在用户确认前保存在 `gitx/rebase-plan.json`，失败可再次打开编辑。
4. **删除分支/tag** 记录 sha，balloon 提供 Restore（#29）。
5. **不自动 `git gc`、不自动 prune reflog**。
6. **长操作**：不可取消阶段（如 rebase 中途）不显示 Cancel，而是显示「Abort」语义按钮并说明后果；关窗时有运行中的 Write/NetworkWrite job → 确认对话框。

### 1.14.5 冲突/进行中操作状态机（RepoOpState）

```text
            ┌──────────── merge/pull ───────────┐
Normal ─────┼── rebase/pull --rebase ─────────┐  │
  ▲         ├── cherry-pick / revert ──────┐  │  │
  │         └── stash apply/pop, patch ──┐ │  │  │
  │                                       ▼ ▼  ▼  ▼
  │                           InProgress{kind, step?/total?, conflicts: n}
  │                             │  conflicts>0 → Conflicted（Resolve 可用；Continue 禁用）
  │                             │  conflicts=0 → ReadyToContinue（Continue/Commit 可用）
  │                             │  rebase edit → StoppedForEdit（Amend/Continue）
  └──── continue 完成 / abort / skip ┘
```

- 状态来自磁盘（`MERGE_HEAD`、`rebase-merge/{msgnum,end,interactive}`、`rebase-apply/`、`CHERRY_PICK_HEAD`、`REVERT_HEAD`、`sequencer/`）+ `status` 的 unmerged 条目；由 watcher `OpState` 事件驱动，**不依赖** gitx 内存（外部终端操作同样被识别）。
- 统一 UI：Repo State Banner、VCS Widget 显示「Merging main」「Rebasing 3/7」；Action enable 规则读取此状态（如 Rebasing 时禁用 Checkout、Pull）。
- 「stash pop 冲突」不是 git 的持续状态 → gitx 在 meta 中记录「unstash pending drop」，冲突解决后提示 drop。

---

## 1.15 测试策略

| 层 | 工具 | 内容 |
|---|---|---|
| Rust 单元 | `cargo test`、`insta` 快照 | porcelain v2 / log / for-each-ref / push porcelain / worktree / blame 解析器；StderrClassifier；ProgressParser；graph lane 布局；diff/partial-stage 构造；设置迁移 |
| Rust 集成（真 git） | `gitx-testkit` + `tempfile` | 用脚本化 builder 生成确定性 fixture（固定 `GIT_AUTHOR_DATE`/`GIT_COMMITTER_*`）：clean、dirty、untracked-heavy、merge-conflict、rebase-in-progress、cherry-pick-conflict、detached、shallow、multi-root、worktrees、submodule、crlf、binary、rename、unicode/空格路径、protected-branch remote（bare repo 作为 remote）、hook 失败、gpg 缺失 |
| Git 版本矩阵 | CI 容器 | 最低 2.31、2.38、最新稳定 |
| 前端单元 | vitest + happy-dom + @vue/test-utils | stores、action registry（enabled/when 规则）、keymap 冲突、树构建、errorPresenter、i18n key 完整性 |
| 组件/交互 | vitest + mockBackend | 对话框流程（Push、Merge、Conflicts、Interactive Rebase 编辑器） |
| Web e2e | Playwright + `dev:web` mockBackend | 主要用户旅程，快速、可截图回归 |
| 桌面 e2e | WebdriverIO + `tauri-driver`（Linux/Windows） | 真后端 + fixture 仓库：首个切片旅程、冲突解决、push rejected |
| 性能 | `criterion`（Rust）+ nightly 大仓库 bench | 预算表回归，超标 CI 警告 |
| 视觉 | Playwright 截图（亮/暗/pearl/graphite） | 关键视图快照 |

---

## 1.16 打包与 CI

- **CI（GitHub Actions）**：`lint`（oxlint、oxfmt --check、`cargo fmt --check`、`clippy -D warnings`、vue-tsc）→ `test`（Rust 单元+集成 × git 版本矩阵、vitest）→ `bindings-check`（tauri-specta 生成无 diff）→ `e2e-web` → `e2e-desktop`（Linux/Windows）→ `build`（ubuntu/windows/macos，Tauri bundle）。
- **Sidecar**：`gitx-helper` 按 target triple 构建并通过 `bundle.externalBin` 打包；macOS 签名/公证同时覆盖 sidecar。
- **发布**：tauri-action 产出 dmg/msi(NSIS)/deb/rpm/AppImage；`tauri-plugin-updater` 签名更新；版本号与 changelog 由 tag 驱动。
- **不打包 git**：首次启动检测（#9）；Windows 引导安装 Git for Windows；后续可评估可选内置 MinGit。
- **依赖审计**：`cargo deny`（license + advisories）、`pnpm audit`；新增依赖需在 PR 中说明。

---

## 1.17 目录结构

```text
gitx/
├─ package.json / pnpm-workspace.yaml / .nvmrc / rust-toolchain.toml / Cargo.toml (workspace)
├─ apps/desktop/                 # Vue 前端（见 1.9）
│  ├─ index.html · vite.config.ts · components.json(shadcn reka-nova/neutral)
│  └─ src/…
├─ src-tauri/                    # app crate
│  ├─ src/main.rs · lib.rs(builder, plugins, menu, tray)
│  ├─ src/commands/<domain>.rs   # 薄层：参数校验 → crates 调用 → Job
│  ├─ src/events.rs · state.rs(AppState: workspaces, schedulers, jobs, ipc server)
│  ├─ capabilities/*.json        # Tauri 2 权限最小化
│  └─ tauri.conf.json
├─ crates/
│  ├─ gitx-core/ gitx-git/ gitx-read/ gitx-graph/ gitx-diff/ gitx-index/
│  ├─ gitx-watch/ gitx-meta/ gitx-helper/ gitx-testkit/
├─ e2e/ (playwright-web/, wdio-desktop/)
├─ fixtures/ (testkit 场景定义 *.toml)
├─ docs/ (开发者文档、glossary、ADR)
└─ .github/workflows/
```

---

## 1.18 通用 UI 组件（Part 2 复用）

| 组件 | 说明 |
|---|---|
| `ChangesTree` | 虚拟化文件树：group by directory/module/repo/changelist；状态色；checkbox（partial commit）；speed search；拖拽到 changelist |
| `DiffViewer` | CodeMirror 6 双栏/单栏（unified），Rust 计算 hunks；ignore whitespace 模式；word diff；hunk 操作按钮（stage/unstage/revert/move to changelist）；行级 checkbox；Next/Prev change `F7/Shift+F7`、文件间 `Ctrl+Alt+Shift+↓/↑`；大文件/二进制/图片占位与图片对比 |
| `MergeViewer` | 三栏（Local / Result / Theirs）+ 可选 Base；连接带；Accept Left/Right、Apply non-conflicting、Resolve simple（magic wand） |
| `CommitList` / `LogGraph` | 虚拟化，canvas graph 列，ref 胶囊，列可配置（hash/author/date） |
| `RefPicker` | 分支/tag/commit 选择 + 输入表达式（`HEAD~3`）+ 实时校验（`rev-parse --verify`） |
| `RepoPicker` | 多 root 时出现 |
| `FileViewer`（轻编辑器） | CodeMirror：gutter 变更标记、Annotate 列、Code author inlay、保存（`Mod+S`） |
| `ProgressDialog` / `StatusBarJobs` | Job 进度 |
| `EmptyState` / `ErrorState` / `Skeleton` | 统一状态组件 |
