# gitx 开发计划（Development Plan）— 索引

> **产品**：gitx —— 复刻 IntelliJ IDEA 内置 Git UI（`git4idea` + 平台共享 VCS UI）的桌面 Git GUI。
> **底座**：dbx 技术栈与视觉语言（Tauri 2 + Rust + Vue 3 + TypeScript + Pinia + Tailwind v4 + shadcn-vue/reka-ui + Lucide），见 [base-stack-and-style.md](./base-stack-and-style.md)。
> **范围**：[project-context.md](./project-context.md) 定义——在范围 = checklist **#1–10、#12–124**（共 123 条，编号 = [idea-git-features.md](./idea-git-features.md) Appendix A 的 A.1–A.15 连续计数）；deferred = **#11、#125–141**。
> **性质**：纯计划文档，不含代码；术语保留 IDEA/Git 英文原名。

---

## 文档结构

| 部分 | 文件 | 内容 |
|---|---|---|
| Part 1 软件框架 | [dev-plan/01-framework.md](./dev-plan/01-framework.md) | 架构总览、Git 引擎选型、进程/取消/进度、askpass/凭据、watcher、multi-root、IPC 契约、错误模型、前端分层、布局、Action Registry、反馈系统、设置/主题/i18n/诊断、易用性·美观性·健壮性、测试、打包/CI、目录结构、通用组件 |
| Part 2.1 | [dev-plan/02-setup-remotes.md](./dev-plan/02-setup-remotes.md) | #1–10 Setup/Clone/Init · #12–17 Remotes/Auth |
| Part 2.2 | [dev-plan/03-branches-tags-worktrees.md](./dev-plan/03-branches-tags-worktrees.md) | #18–35 Branches · #36–42 Tags · #43–46 Worktrees |
| Part 2.3 | [dev-plan/04-changes-commit-push.md](./dev-plan/04-changes-commit-push.md) | #47–59 Local Changes/Changelists/Staging · #60–74 Commit/Push |
| Part 2.4 | [dev-plan/05-sync-merge-rebase.md](./dev-plan/05-sync-merge-rebase.md) | #75–81 Fetch/Pull/Update · #82–92 Merge/Rebase/Cherry-pick |
| Part 2.5 | [dev-plan/06-conflicts-diff-history.md](./dev-plan/06-conflicts-diff-history.md) | #93–101 Conflicts/Diff/Patch · #102–110 Log/History/Annotate/Edit History |
| Part 2.6 | [dev-plan/07-stash-ignore-settings-chrome.md](./dev-plan/07-stash-ignore-settings-chrome.md) | #111–116 Stash/Shelve/Ignore · #117–124 Settings/Chrome/Shortcuts |
| Part 3 里程碑 | [dev-plan/08-milestones.md](./dev-plan/08-milestones.md) | 依赖图、M0–M8 内容与退出标准、规模、风险 |
| Appendix | [dev-plan/09-traceability.md](./dev-plan/09-traceability.md) | #→章节→里程碑 追踪表（123 条全覆盖）+ deferred 清单 |

Part 2 每个条目统一结构：**UI**（位置、交互、菜单/右键、空/错/加载状态）· **实现**（后端命令 → git 调用；前端组件/store；事件）· **边界** · **验收（AC）** · **里程碑**。

---

## 关键架构决策（摘要）

1. **Git 引擎 = Hybrid、CLI-first**：所有写操作与网络操作走系统 `git` CLI（hooks、credential helper、GPG/SSH 签名、LFS、用户 config 行为与终端一致，Console 可复现）；gitoxide（gix）只用于只读热路径（Log rev-walk、blob/tree、refs、ahead/behind），每个读接口都有 CLI 回退；不引入 libgit2。最低 git 2.31，新特性按版本门控。
2. **所有长操作都是 Job**：RepoScheduler 按 Read/Write/Network/NetworkWrite 调度防 `index.lock` 竞争；进程组/Windows Job Object 取消整棵进程树；`--progress` 解析为节流进度事件；结果走 `job://finished`，命令与输出全部进入 Console（已脱敏）。
3. **askpass/editor sidecar（gitx-helper）+ 本地 IPC**：git/ssh 的凭据、host key、提交消息、interactive rebase todo 都经 helper 回连 app 弹出 gitx 对话框；凭据只存 OS keychain，默认尊重用户 credential helper；后台任务永不弹凭据框。
4. **类型安全 IPC**：tauri-specta 生成 TS bindings（CI 校验无 diff）；命令名 `<domain>_<verb>`；大结果用 Tauri Channel 流式分页；每个 repo 单调 `version` 防止竞态回退；稳定 `ErrorCode` + 恢复动作，前端负责文案与交互。
5. **单一 Action Registry**：沿用 IDEA action id（`Git.Fetch`、`Git.Log.ContextMenu`…），一份定义驱动主菜单（含 macOS 原生菜单）、右键、快捷键（IDEA 默认 keymap，可自定义）、VCS Operations Popup、Quick Actions 和 Find Action；disabled 必须给出原因。
6. **Repo 状态来自磁盘**：RepoOpState 状态机（Merge/Rebase/Cherry-pick/Revert 进行中、Conflicted、StoppedForEdit）从 `.git` 状态文件与 status 推导，由 watcher 驱动；外部终端操作同样被识别，Banner/Widget/Action 启用规则统一读取它。
7. **永不丢失用户工作**：破坏性操作前自动 Safety Snapshot（`stash create` + `refs/gitx/backup/*`，默认保留 14 天）；untracked 删除走 OS 回收站；删除分支/tag/stash、reset、改写历史均提供 Restore/Undo；提交消息草稿与 rebase 计划持久化。
8. **gitx 自有元数据不污染工作树**：changelists、shelf、favorites、UI 工作区、Log 索引（SQLite + FTS5）存于 `<git-dir|common-dir>/gitx/`；可共享设置才进入 `.gitx/settings.json`（需用户确认纳入 Git）。行级 stage/部分提交在 Rust 侧基于内容构造 blob（`hash-object` + `update-index`、临时 `GIT_INDEX_FILE`），不拼接补丁。

---

## 里程碑一览

| 里程碑 | 主题 | 规模 | 依赖 |
|---|---|---|---|
| **M0** Phase 0 Skeleton | 外壳、UI 原语、IPC、GitRunner/Job/错误、helper、watcher、settings、Action Registry、i18n、测试与 CI | L | — |
| **M1** First Vertical Slice | 打开/创建仓库 → Changes（staging 模式）→ Diff → Stage → Commit（hooks、amend）→ 基础 Log | L | M0 |
| **M2** Branches & Sync | Clone、Remotes、凭据、Branches/Widget、Tags、Fetch/Pull/Update/Push（含 rejected、force-with-lease、protected） | XL | M1 |
| **M3** History & Compare | 完整 Log 过滤/选项/右键、Log Indexing、Compare、File/Selection History、Annotate、Repository at Revision | L | M1（可与 M2 并行） |
| **M4** Merge/Rebase/Conflicts | Merge、Rebase、Cherry-pick、Conflicts 对话框、三栏 Merge 编辑器、Smart Checkout/Merge | XL | M2 |
| **M5** Rewrite History | Interactive rebase、Reword/Squash/Drop/Fixup、Undo/Revert/Reset、Extract/Drop changes | L | M3 + M4 |
| **M6** Local Changes Advanced | Changelists（含 per-hunk）、行级 stage/部分提交、FileViewer gutter、Shelve/Stash、Patch、Ignore | XL | M1（冲突路径依赖 M4） |
| **M7** Multi-root & Worktrees | Worktrees、多 root 同步分支操作、Sync upstream、Submodule update、Commit TW 窗口模式、WSL | M | M2 + M4 |
| **M8** Settings, Polish & Release | 声明式 Settings 全页、Keymap、共享设置、Commit Checks、工作区恢复、性能/可访问性/发布 | L | 全部 |

**首个垂直切片（M1）**：Welcome → Open/Init → Commit TW（Staged/Unstaged/Unversioned）→ `Ctrl+D` Diff → stage 文件/hunk → `Ctrl+K` 提交（hooks、Amend）→ Log 中看到新 commit 与 graph；退出标准包含性能预算（80k 文件 status、1M commits Log 首屏）与外部修改 1s 内同步。

---

## 待协调者/用户确认

以下在范围编号内、但与 deferred 条目重叠或需要 gitx 适配的条目，计划中采用了「只做通用/托管无关部分」的处理，需要确认：

| # | 处理方式 | 重叠/原因 |
|---|---|---|
| #17 `Github.Sync.Fork` | 只做「Sync Fork with 'upstream' remote」（纯 git，无 GitHub API） | 与 #136 Sync Fork（deferred）重复 |
| #46 Open Review / Open PR in Worktree | 只做「Open ref/PR 号 in Worktree」（手动输入，无 PR 列表） | 与 #134 Checkout PR / Open in Worktree（deferred）重叠 |
| #65 Commit Checks / After Commit upload | 只做语言无关检查（冲突标记、TODO、大文件、密钥、自定义命令） | #140 Deployment、#141 语言相关检查 deferred |
| #69 Commit TW view modes | 只做 Docked/Window/Float 与 toggle controls | #139 Modal Commit deferred |
| #81 Submodule update behavior | 只定义 superproject 更新时的子模块 update 行为 | #11 Submodule clone/register deferred |
| #3 / #10 / #53 / #55 / #106 | IDE 概念的 gitx 适配：Welcome 屏、`.gitx/settings.json`、外部编辑冲突用 balloon、内置轻量 FileViewer 承载 gutter/annotate/Code author | gitx 不是 IDE |
| 首个切片默认模式 | M1 先做 Staging 模式，M6 完成后默认改为 IDEA 的 Changelist 模式 | 实现顺序决定，需确认最终默认值 |
