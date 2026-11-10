# Stash 操作与交互验证（2026-11-10）

本轮以 `480da4b` 为基线，修复 Stash 的目标身份、创建选项、错误处理、备份和交互。Shelf 的应用与删除流程另行处理。

## 修复内容

- 前端以完整 SHA 保存选择并传递操作目标，新增 Stash 导致编号变化后仍操作原对象。后端拒绝空、缺失、任意修订和有歧义的引用。
- Stash 列表改为单次 Git 调用和 NUL 字段解析。Git 以退出码 0 报告“没有修改”时，返回 `NothingToCommit`。
- 创建统一经过 store 和选项弹窗，提供包含未跟踪文件、保留暂存修改；选定路径在弹窗前复制。空路径集合不再隐式处理整个仓库，路径按字面匹配，使用 stdin 避免命令行长度限制。
- Apply 使用完整 SHA；恢复暂存区失败后不再隐式重试。Pop/Branch 先保存备份，成功应用后再移除 Stash；任何备份失败都阻止后续删除。
- 备份引用使用完整 SHA。Drop 在备份后重新解析编号；Clear 备份全部对象后，通过预期 tip 的 `update-ref -d` 拒绝误清空期间新增的 tip。
- 操作期间按仓库防重复提交，包括等待弹窗的阶段。仓库变化或导航已经开始时，旧弹窗和迟到结果失效。成功、失败都刷新列表、工作区、冲突和操作状态。
- Drop/Clear 提供确认，清空确认期间列表发生变化则取消执行并要求重新检查。
- 增加可聚焦行、方向键/Home/End、Delete 确认、鼠标右键和 Shift+F10 菜单，Esc 返回原行；双击保持选择，不自动修改工作区。
- 桌面实测发现并修复两个公共 UI 问题：菜单自然高度漏计边框而出现多余滚动条；首次异步加载确认框未获得焦点而不能使用 Esc。异步对话框挂载后仅为当前顶层对话框设置焦点。

## 自动验证

- 首轮原实现测试复现 3 项失败：空 Stash 成功、空引用误选、备份失败仍删除。
- `cargo test -p gitx-git --test stash_safety --locked`：11 项通过。覆盖选定字面路径、无修改、空选择、Unicode、稳定 SHA、保持/恢复暂存区、Apply/Pop 失败不重试、冲突保留、备份失败、Clear/Restore、从 Stash 创建分支，以及真实 reference-transaction hook 在备份后插入新 Stash。
- 原 `m6_local_changes`：7 项通过。
- 当前分支前端：40 文件、304 项通过；集成目录前端：65 文件、471 项通过。
- 两处 `vue-tsc` 和生产构建通过；最终集成桌面内嵌前端构建通过。Vite 保留既有大 chunk/混合导入提示。
- `cargo clippy -p gitx-git --lib --locked -- -D warnings` 和 `cargo check -p gitx --locked` 通过。
- 测试目标的严格 Clippy 最初被既有 `gitx-testkit::FixtureBuilder` 的 `derivable_impls` 提示阻断；仅允许该 lint 后测试目标检查通过，未修改测试工具实现。

## 原生桌面验证

环境：Windows、Git 2.34.1.windows.1；独立测试仓库 `E:/IDEAproject/gitx/test-results/repos/stash-safety-20261110`。运行新构建的独立命名可执行文件，没有替换安装目录里的程序。

1. 在有暂存、未暂存和未跟踪文件的仓库中创建 `QA GUI options`，同时勾选两个选项；实际 Git 状态仅剩 `M  staged.txt`，未跟踪内容已保存在 Stash。
2. 选中 `QA oldest`，通过外部 Git 新增 Stash；该条从 `stash@{2}` 变为 `stash@{3}`，选择仍保留。
3. 验证 Home、方向键、Shift+F10、Esc、鼠标右键、双击。菜单目标与选择一致，关闭后焦点返回列表。
4. Delete 打开确认框，取消后四条 Stash 均保留。最终构建首次打开确认框即支持 Esc 取消。
5. 无工作区修改时创建 Stash，显示“没有可保存到 Stash 的修改”，没有新增条目。
6. 选择 `QA GUI options` 并勾选恢复暂存状态，应用后实际状态为 ` M README.md`、`M  staged.txt`、`?? untracked.txt`，各文件内容与创建前一致，四条 Stash 均保留。
7. 最终构建复核三项右键菜单没有多余滚动条。两次桌面测试均通过窗口关闭按钮退出，进程检查无残留测试主进程。

证据文件位于 `E:/IDEAproject/gitx/test-results/`：`stash-gui-before.json`、`stash-gui-applied.json`、`stash-main-tests-final.log`、`stash-integration-tests-final.log`、`stash-main-build-final.log`、`stash-integration-build-final.log`。

最终桌面测试文件 `gitx-stash-qa-final.exe` SHA-256：`ABF7591CCC09686A7CC7DFAF080A5F3E1E40A93A4B28DAEB4643AC4BB0501867`。

## 验证边界

GUI 验证了删除确认和取消；实际 Drop/Pop/Clear 删除效果由独立临时仓库的真实 Git 测试覆盖。未进行 WSL 桌面验证。

应用内写入由现有仓库调度器串行化。Drop 最终仍使用 Git 的 reflog 编号删除接口，重新解析和最后删除之间无法与任意外部 Git 客户端组成原子事务；本轮的 hook 测试覆盖备份期间插入，不宣称消除所有跨客户端时序窗口。
