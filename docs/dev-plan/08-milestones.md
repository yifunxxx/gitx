# Part 3 — 里程碑（Milestones）

> 返回索引：[../dev-plan.md](../dev-plan.md) · 每个编号的里程碑归属见 [09-traceability.md](./09-traceability.md)。
> 规模用相对尺度表示（S < M < L < XL），并给出功能条目数、主要后端命令/前端组件数作为复杂度依据；**不估算日历时间**。
> 每个里程碑都要通过：CI 全绿（三平台）、对应 AC 的自动化测试、性能预算无回退、亮/暗主题与 zh-CN/en 检查。

## 依赖图

```text
M0 Skeleton ──► M1 First Vertical Slice ──┬──► M2 Branches & Sync ──┬──► M4 Merge/Rebase/Conflicts ──► M5 Rewrite History
                                          │                         │            │                         │
                                          ├──► M3 History & Compare ┼────────────┼─────────────────────────┤
                                          │                         │            ▼                         │
                                          └──► M6 Local Changes Adv. ◄───────────┘ (unshelve 冲突复用 M4)   │
                                                                    └──► M7 Multi-root & Worktrees ◄───────┤
                                                                                                          ▼
                                                                                         M8 Settings, Polish & Release
```

- M2 与 M3 在 M1 之后可**并行**（分别以 refs/网络、Log/Diff 为主，冲突面小）。
- M6 的 changelist 部分只依赖 M1；Unshelve/Apply Patch 的冲突处理依赖 M4 的冲突 UI——可先实现非冲突路径。
- M5 依赖 M3（Log 右键与 commit 选择）与 M4（rebase 引擎、冲突状态机）。

---

## M0 — Phase 0 Skeleton（骨架）· 规模 L

**目标**：一个可打包、可测试、具备全部横切机制的空壳；后续每个功能只需「加 action + 加命令 + 加视图」。

| 工作项 | 内容 |
|---|---|
| 仓库与工具链 | pnpm workspace、Cargo workspace（`src-tauri` + `crates/*` 空壳）、oxlint/oxfmt/clippy/rustfmt、husky lint-staged、`.nvmrc`/`rust-toolchain.toml` |
| 应用外壳 | Tauri 2 Overlay titlebar + WindowControls（三平台）、TitleBar/ToolWindowStripe/ToolWindowHost/EditorTabs/StatusBar 空布局，splitpanes 持久化（1.10） |
| UI 基础 | dbx tokens + `vcs-tokens.css`、shadcn-vue 组件（button/dialog/dropdown/tooltip/input/tabs/select/scroll-area）、CustomContextMenu、ToastHost、Balloon、dialogService、EmptyState/ErrorState/Skeleton |
| IPC | tauri-specta 生成 bindings + CI 校验；`Backend` 接口 + tauri/mock 两实现 |
| Git 引擎底座 | GitRunner（env 注入、进程组/Job Object 取消、超时、脱敏）、RepoScheduler、Job 系统 + 事件、ProgressParser、StderrClassifier 首批规则、AppError |
| 外围机制 | gitx-helper sidecar（askpass/editor/seq-editor）+ 本地 IPC server；watcher 骨架；gitx-meta 存储与 schema 迁移；settings 读写；tracing 日志 + 脱敏；登录 shell PATH 获取（macOS） |
| Action Registry | registry/context/groups/keymap/ShortcutDispatcher、Find Action 面板、默认 IDEA keymap 表 |
| i18n | vue-i18n、zh-CN/en、glossary、key 完整性测试 |
| 测试/CI | gitx-testkit（fixture builder 首批 5 个场景）、vitest、Playwright web e2e（mock）、tauri-driver 冒烟、GitHub Actions 三平台矩阵 + 打包产物 |
| 功能条目 | **#9** Git executable 检测/Test；#120/#121/#122/#123/#124 的框架部分 |

**退出标准**：三平台安装包可运行；打开任一文件夹 → 检测 git → 在 Console 中看到 `git status` 命令与输出；一个示例 action 可同时出现在主菜单、右键、快捷键、VCS Operations Popup、Find Action；取消一个长 `git` 命令可杀掉整棵进程树。

---

## M1 — 首个垂直切片（First Vertical Slice）· 规模 L

**用户旅程**：Welcome → 打开/创建仓库 → 看到变更（staging 模式）→ 查看 diff → stage 文件/hunk → 写消息提交（含 hooks）→ 在 Log 中看到新 commit 与 graph → Undo 一个误提交的 commit 不在此里程碑（M5），但 Amend 可用。

| 条目 | 说明 |
|---|---|
| #3 #4 #5 #6 | Welcome、Enable VCS、Init、Add |
| #47 #48 #54 #56（staging 先行）#57（文件/hunk 级）#58 | Commit TW、列表、状态色、staging 模式 |
| #60 #61（HEAD amend）#64 | Commit、Amend、hooks |
| #97（基础） | DiffViewer 双栏/unified、hunk stage/unstage/revert |
| #102（基础） | Log：commits + graph + Changed Files + Details，无高级过滤 |
| #18（只读分支名）#121 #122 #123 | 主菜单、Quick actions、Console |

**主要组件**：ChangesTree、CommitMessageEditor、DiffViewer、LogGraph（canvas）、CommitDetails；**主要命令** ≈ 20（status/stage/diff/commit/log/graph/refs…）。
**退出标准**：E2E（真后端 + fixture）走通上面的旅程；80k 文件仓库 status 与 1M commit Log 首屏满足性能预算；外部终端修改后 1s 内 UI 同步。

---

## M2 — Branches & Sync（分支、Tag、Remote、Fetch/Pull/Push/Update、Clone）· 规模 XL

| 条目 |
|---|
| Setup/Remote：#1 #2 #12 #13 #14 #15 #16 |
| Branches：#18（完整）#19 #20 #21 #23 #24 #25 #29 #30 #35 |
| Tags：#36 #40 #41 #42 |
| Commit/Push：#62 #63 #68 #70 #72 #73（自动更新的非冲突路径）#74 #96 |
| Fetch/Pull/Update：#75 #76 #77 #78 #79 #80 |
| Chrome：#120 VCS Operations Popup（内容） |

**关键依赖**：askpass/keychain（M0 底座）、Update 引擎、push porcelain 解析。
**退出标准**：针对本地 bare remote fixture 与真实 HTTPS/SSH 远端的集成测试：clone→branch→commit→push→被拒→rebase 更新→push 成功；后台 auto fetch 不弹凭据；protected branch 不可 force push。

---

## M3 — History & Compare（历史与比较）· 规模 L

| 条目 |
|---|
| Log 完整：#102（过滤/Graph Options/右键）#103 Indexing #28 #90 |
| Compare：#26 #27 #97（全部选项）#98 #99 #100 |
| History/Blame：#104 #105 #107 #110 |
| Log 衍生动作：#31 #32 #37 #38 #39 #71 #91 |

**退出标准**：linux kernel 级仓库：索引后过滤 ≤300ms、blame 首批 ≤300ms、Repository at Revision 根目录 ≤200ms；rename 跨越的文件历史正确。

---

## M4 — Merge / Rebase / Cherry-pick / Conflicts · 规模 XL

| 条目 |
|---|
| #82 #83 #84 #85 #87 #88 #89 |
| 冲突：#93 #94 #95 |
| #22 Smart/Force Checkout、#114（Stash 方式）、#73 冲突衔接 |

**关键交付**：RepoOpState 状态机 + Banner、`gitx-diff::merge3`、MergeViewer（三栏 + 连接带）、DirtyWorktreeDialog、`with_clean_tree`。
**退出标准**：冲突矩阵（content / delete-modify / add-add / rename / binary / submodule × merge / rebase / cherry-pick / stash pop）全部可在 UI 中解决；外部终端开始的 rebase 可在 gitx 中继续；所有 Abort 可从备份恢复。

---

## M5 — Rewrite History（改写历史与撤销）· 规模 L

| 条目 |
|---|
| #86 Interactive rebase、#108 Reword/Squash/Drop/Fixup/Squash Into、#109 Undo/Revert/Reset、#92 Extract/Drop selected changes、#61（早期 commit amend） |

**关键交付**：in-memory 改写引擎（commit-tree / merge-tree --write-tree + CAS update-ref）、Interactive Rebase 编辑器、Undo 机制统一（backup refs）。
**退出标准**：所有改写动作提供 Undo；in-memory 路径不触碰工作区/索引（测试断言 mtime 与 index 不变）；protected 规则生效。

---

## M6 — Local Changes Advanced（Changelists、Shelve、Stash、Patch、Ignore、编辑器集成）· 规模 XL

| 条目 |
|---|
| Changelists：#50 #51 #52 #53 #56（双模式切换，默认改为 Changelist 模式）|
| 行级与编辑器：#55 #57（行级）#66 #67 #106 |
| Stash/Shelve：#111 #112 #113 #114（Shelve 方式） |
| Patch/Ignore：#101 #115 #116 #49 #8 #59 #7 |

**关键交付**：FileViewer（CodeMirror gutter）、hunk 内容锚点映射、临时 index 部分提交、shelf 存储。
**退出标准**：同一文件不同 hunk 分属两个 changelist 并分别提交正确；Shelve/Unshelve 3-way；行级 stage/commit 在 CRLF/无末尾换行/新文件场景正确。

---

## M7 — Multi-root & Worktrees · 规模 M

| 条目 |
|---|
| #43 #44 #45 #46（通用部分）#33 #17（通用部分）#81 #69 #9（WSL） |

**关键交付**：多窗口状态同步（`ui://sync`）、MultiRootOp 回滚、worktree 感知的 meta 存储（git-dir vs common-dir）。
**退出标准**：3-root workspace 同步分支操作与失败回滚；worktree 新窗口打开并独立工作；WSL 仓库基本流程可用。

---

## M8 — Settings, Polish & Release · 规模 L

| 条目 |
|---|
| #117 #118 #119 #124 #10 #34 #65（通用部分） |
| 横切：可访问性（键盘全覆盖、对比度）、性能 nightly bench 达标、诊断导出、updater、签名/公证、用户文档与 glossary 定稿 |

**退出标准**：Settings 全部声明式生成且可搜索；Keymap 自定义；发布通道（stable/beta）可自动更新；全部 123 个在范围条目的 AC 通过（traceability 表全绿）。

---

## 规模汇总

| 里程碑 | 条目数（主归属） | 主要新增后端命令（约） | 主要新增前端视图/组件（约） | 规模 |
|---|---|---|---|---|
| M0 | 1（+5 框架部分） | 10（app/job/settings/askpass） | 15（外壳 + UI 原语） | L |
| M1 | 18 | 20 | 8 | L |
| M2 | 36 | 35 | 12 | XL |
| M3 | 19 | 15 | 8 | L |
| M4 | 12 | 20 | 6 | XL |
| M5 | 4 | 12 | 3 | L |
| M6 | 18 | 25 | 8 | XL |
| M7 | 8 | 10 | 4 | M |
| M8 | 7 | 5 | 6 | L |

（合计 123 条 = #1–10 + #12–124；条目数按 [09-traceability.md](./09-traceability.md) 的主归属统计；分阶段交付的条目（如 #57、#97、#102）只计入首次出现的里程碑。）

## 风险与对策

| 风险 | 对策 |
|---|---|
| gix 对某些仓库特性（新 index 扩展、reftable）不支持 | `GitReadBackend` 双实现 + 自动回退 + 诊断记录；reftable 仓库强制 CLI |
| Windows 进程开销导致大量小命令慢 | 批处理（`--stdin`/`cat-file --batch` 长驻进程）、gix 读路径、缓存 |
| macOS GUI 应用 PATH 缺失导致 hooks/credential helper 失败 | M0 登录 shell 环境捕获 + 设置中可编辑附加 PATH |
| tauri-driver 不支持 macOS WKWebView e2e | macOS 依赖 Playwright web e2e + 手工冒烟清单 |
| 行级 stage/部分提交与 filter（LFS、eol）交互复杂 | 遇 filter 文件降级为整文件；`hash-object --path` 应用规则；专门 fixture |
| Changelist 内容锚点映射失败导致归属漂移 | 映射失败回落到 active 并通知，永不丢变更（只影响归属） |
