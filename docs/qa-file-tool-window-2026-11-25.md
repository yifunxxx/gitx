# QA-082：File 工具窗 MVP 交付与验证

日期：2026-11-25。类型：功能改进。来源：用户明确要求实现 `docs/file-tab-plan.md`。

## 范围与基线

- 按计划的 Stop when / Definition of Done 完成 MVP U1–U6；E1–E5 已登记为必做增强单元，依计划另开实现任务。
- 初始工作区干净，主分支为 `e5c6b76`。前两次 fetch 分别连接重置、超时，第三次成功后快进到 `6bf02dbfde1f26bcfaafa1fdc0e46647305b1cf4`，随后创建 `codex/file-tool-window`。
- 原交付分支已被远端删除，最新主分支包含既有交付。实现过程中及提交前再次 fetch 成功，远端 master 仍为 `6bf02db`，已核对其为当前 HEAD 的祖先。
- 用户补充禁止子代理后，后续审阅、修正、自动化复核、原生测试及交付均由主线程完成；不把此前并行准备记作全程主线程。

## 修改位置与功能

| 位置 | 改动及影响 |
| --- | --- |
| `apps/desktop/src/stores/layoutStore.ts`、`components/layout/ToolWindowStripe.vue`、`App.vue` | Commit 下增加 File；持久化活动页签，共享宽度；再次点击 File 关闭 dock；隐藏面板仍保留实例。File 替换 Commit 浮层，返回 Commit 保留草稿及 float 偏好。 |
| `features/commit/focusCommitUi.ts`、`actions/definitions/m7.ts` | Commit 入口恢复 Commit 页签；Show File 为 Alt+1、Show Commit 为 Alt+0，保留 Ctrl+K；编辑器中可切换，输入对话框中不抢快捷键。 |
| `src-tauri/src/commands/filesystem.rs`、`commands/mod.rs`、`lib.rs` | 独立 `fs_read_dir` / `fs_read_file` / `fs_write_file` IPC；按单目录读取，目录优先，工作区相对路径；校验 canonical 路径边界，拒绝逃逸链接/junction。 |
| `apps/desktop/src/lib/backend/{bindings,index,mock}.ts` | 注册命令与类型，bindings 从 Rust 实际导出；补齐 web mock。 |
| `stores/fileTreeStore.ts` | 目录懒加载、缓存、generation 隔离、刷新合并；仅展平已展开子树，键为 kind + path；已加载可见名称过滤保留祖先；父目录先刷新，清理消失节点的选中/展开状态。 |
| `components/layout/FileToolWindow.vue`、`features/file-tree/projectFileStatus.ts` | VirtualList 和现有图标；单击选中，双击/Enter 编辑，F4 条件 Diff；Git 状态装饰；文件/目录菜单、键盘导航、失败重试、空态。菜单使用独立 `projectFiles` scope。 |
| `lib/projectFilePath.ts`、`stores/fileViewerStore.ts`、`features/file/FileViewer.vue` | 处理 folderPath 与 repoPath 不同的路径映射；仓库内文件沿用原有标签与保存通道，树打开先通过受限文本读取；非 Git 文件使用独立 FS 读写，隐藏无意义的 vs HEAD 文案，保留保存期间新草稿及导航归属保护。 |
| `composables/useRepositoryRefresh.ts` | 接入既有 worktree/ignore 刷新，status-only 仅更新装饰；非 Git 文件夹复用焦点及原有 5 秒节拍。没有引入另一套 watcher。 |
| `stores/settingsStore.ts`、`features/settings/schema.ts`、`crates/gitx-core/src/settings.rs`、en/zh-CN | 独立隐藏/忽略设置，默认 false，旧配置兼容；File 文案中英齐全。 |

没有改造 ChangesTree、Git 图线、终端实现或其他无关功能。复用了既有 Diff、History、Reveal、Terminal 和上下文菜单设施。

## 影响分析与回归重点

- 左栏从条件销毁改为保留内容，重点检查 dock 开关、宽度、滚动与草稿；float 仍只挂载一个 Commit 实例。
- File 与 Changes 手势不同，事件及上下文菜单隔离，避免 File 的 Enter/F4 或右键误走 Changes 动作。
- FS 根为工作区；Git 操作路径仍为 repo-relative。覆盖工作区位于仓库子目录、包含仓库、文件位于活动仓库之外，以及 Windows 大小写映射。
- 文件加载/保存、目录请求与菜单均需防止仓库切换或关闭后旧结果覆盖新页面。保存时用户继续编辑，基线只推进到已写入内容。
- 树首次显示才请求根；折叠子目录不递归列举。刷新只重新读取根和可见已展开目录，已缓存折叠目录失效后按需重读。状态更新保持树行节点身份。
- 独立设置避免 File 显示忽略项改变 Commit 的忽略文件策略。

## 自动化结果

本机使用 `test-results/env.ps1` 指定的 Node/Rust 环境，Rust target 位于 `test-results/isolated-target`。

| 检查 | 结果 | 本机日志 |
| --- | --- | --- |
| 完整前端 `pnpm --filter @gitx/desktop test` | 180 文件 / 1798 项通过 | `test-results/file-tab-full-final.log` |
| FileViewer 与树最后定向复核 | 2 文件 / 27 项通过 | `test-results/qa082-native/final-targeted.log` |
| `pnpm build`（vue-tsc + Vite） | 通过；现有大 chunk 提示保留 | `test-results/file-tab-build.log` |
| Rust filesystem 定向测试 | 8 项通过，包括非 Git、ignore 取反及已跟踪文件、路径逃逸、Windows junction、UTF-8/二进制/大小限制 | `test-results/qa082-native/rust-fs-final.log` |
| Rust 设置兼容测试 | 2 项通过 | `test-results/qa082-native/rust-settings-final.log` |
| `pnpm lint` | Oxlint、cargo fmt、Clippy 通过；8 条既有 Oxlint warning 未扩大处理 | `test-results/qa082-native/lint-final.log` |
| Windows 原生构建 | `pnpm tauri build --debug --no-bundle --config test-results/qa082-native/tauri.qa.json` 通过 | `test-results/qa082-native/build-delivery.log` |
| 差异检查 | `git diff --check` 通过；清除了无关格式变化 | Git 工作区 |

新增测试覆盖布局往返、按需列举、过期请求、刷新中再次失效、已展开目录消失、4000 节点虚拟化/滚动锚点、菜单 scope 与异步归属、条件 Diff/状态、非 Git 保存、设置兼容和快捷键。完整测试也包含既有 Changes、FileViewer、Commit 和刷新回归。精确竞态与失败重试属于受控测试证据。

## 本机原生验证

使用独立 Tauri identifier `app.gitx.qa082`、独立 WebView 目录和专用 fixture，用户安装版未替换。

第一版原生程序 `gitx-qa082.exe` 的 SHA256 为 `60A270AFEBEA4BC11992839B14083FF546096AF57B08EE40C5F96850B9B169F9`；完成仓库主路径。最后程序 `gitx-qa082-verified.exe` 的 SHA256 为 `D37AF29CB4208A8329D94886EB3F1D1E7CE08243207B262C96DF5AE5C16711B6`；包含非 Git 标题修正与 lint 清理，并完成 float 和非 Git 验证。最后提交前仅恢复无关空白格式及编写报告，没有追加逻辑修改。

| 场景 | 观察结果 |
| --- | --- |
| 仓库浏览与编辑 | File 位于 Commit 下；展开 src；单击只选中；双击打开实际工作树文本；M 装饰正确。 |
| 条件 Diff | F4 打开 Staged → Local，左右分别为 `base line` 与 `changed line`。 |
| 仓库保存 | 编辑为 `changed line QA082`，Ctrl+S 后核对磁盘。 |
| Commit 往返 | 输入提交草稿，经 Alt+0 / Alt+1 往返后保留。 |
| 中等目录与刷新 | 展开 1200 文件 bulk，End 到末尾；关/开 File 后保留滚动；外部新增 `item-1199-new.txt` 自动出现；过滤 `1199` 显示 bulk 祖先及两个匹配项。 |
| float 替换 | 通过现有 Find Action 启用 Float，输入 `QA082 float draft`；点击 File 后只显示 File dock；Alt+0 返回原浮层，草稿保持。 |
| 设置与主题 | 默认隐藏/忽略项不显示；打开两项设置后 `.hidden.txt`、`.gitignore`、忽略目录可见；浅色及 Liquid Glass Dark 均检查。 |
| 非 Git | 使用临时目录 `gitx-qa082-plain-20261125`，已用 Git 确认目录不在任何仓库；中文界面正常浏览、单击选中、Enter 打开；标题无 vs HEAD。 |
| 非 Git 保存和菜单 | 写入 `plain base QA082保存`，Ctrl+S 后未保存标记消失且磁盘内容一致；Diff/历史禁用；菜单打开复用当前标签。 |

测试准备中曾在 `cargo test` 后误复制同一 target 下不带 custom protocol 的调试可执行文件，出现 localhost 拒绝连接。已重跑 Tauri 构建并立即复制、核验哈希后完成验证。这是测试产物混用，不计作产品缺陷；错误产物不作为验收依据。

原生未逐项执行所有 Reveal/Terminal/History 菜单动作，相关参数路由有组件测试覆盖，复用的原有实现未改。没有将一次 1200 文件浏览宣称为长期压力或全面性能验收。

## 现场恢复

- 原生测试实例均已退出，最后核对 `gitx-qa082*` 进程数为 0。
- fixture 仓库 HEAD 保持 `e50e5faf4cbe0606606455e9f4afebad3293ed6a`，index 无改动；恢复 `src/app.txt` 为测试前 `changed line\n`，移除本轮创建的 watcher 测试文件。状态回到仅 ` M src/app.txt`。
- 非 Git `note.txt` 恢复为 `plain base\n`。
- 用户 `app.gitx.desktop/settings.json` SHA256 前后均为 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。仅专用 QA profile 的设置用于测试。
- 恢复证据：`test-results/qa082-native/restoration.json`；程序身份：`verified-binary.json`、`verified-process.json`、`verified-plain-process.json`。

## 限制、后续与交付状态

- 本轮新增并完成 QA-082 功能改进；现有 11 项 QA 未关闭事项保持，未据此推断项目全部问题数量。
- 树过滤仅检查已加载可见节点；全局文件名跳转不是本轮已交付功能。
- 新树入口支持 UTF-8 文本编辑，限制 5 MiB，二进制/无效编码明确失败；非 Git 保存不自动创建已删除文件。没有修改既有 Git 编辑入口的内容模型。
- **必做增强·优先：E1 CRUD；E2 树内移动/复制拖拽、多选及 changelist 拖放；E3 全局文件名跳转。**
- **必做增强·后期：E4 全局内容搜索；E5 紧凑目录、聚合状态及多根交互打磨。** 顺序和验收沿用原计划，另开实现任务。
- 代码实现、自动化检查及上述本机原生冒烟已完成；用户安装版未更新。
- 功能独立提交与推送结果在交付后补记到统一台账；当前完成提交前复核。
