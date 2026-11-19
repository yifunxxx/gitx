# QA-037 冲突文件只读差异路由

日期：2026-11-19。来源：同一 0.1.40 原生程序验收三栏合并时，在 `merge-scroll-gui-20261117` 的 Commit 树双击 `UU merge.txt`，普通 Diff 报 `fatal: Not a valid object name :0:merge.txt`。

## 已复现现象与影响

只读核查该测试仓库 `git ls-files -u -- merge.txt` 仅有 stage 1/2/3，`git cat-file -e :0:merge.txt` 重现相同错误。未修改原 fixture 的文件、索引或引用。

Commit 树点击、双击、Enter、右键 Show Diff 与 Ctrl+D 汇入 `openChangeDiff`。它没有识别 `FileChange.kind === "unmerged"`，按普通暂存/未暂存路径读取 stage 0，导致冲突文件不能正常查看差异。后端拒绝将已有的冲突阶段伪装成“文件已删除”是正确行为，应修复前端路由。

“Resolve Conflicts”按钮经后续原生点击已正常显示带 Loading 的弹窗，未登记按钮缺陷。

## 修改前回归

新增 **16 项失败**，已有 **39 项通过**。日志：`E:/IDEAproject/gitx/test-results/conflict-diff-before-20261119.log`。

- `CommitDiffSelection.test.ts`：树事件、右键 Show Diff、快捷键动作 × UU、AA、UD、DU；每项分别检查 staged、unstaged、changelist 三个分区。新增 12 项失败，39 项普通文件层级、暂存后重命名和原路径选择保持通过。
- `ChangesConflictDiff.test.ts`：真实 ChangesTree、真实 Pinia changes store，实际点击/双击/Enter；Ctrl+D 检查真实快捷键绑定并调用真实 action registry。新增 4 项失败，实际调用的对比侧仍包含 index。

## 修改

`openChangeDiff` 检查目标在 staged/unstaged 中的 `kind === "unmerged"`，冲突文件统一使用 HEAD → worktree。其余普通文件保持原来的 HEAD → index 或 index → worktree 以及重命名原路径规则。

该比较显示当前 HEAD 与工作文件（包括冲突标记或用户手动编辑），保留 Show Diff 只读语义；三栏可编辑操作仍经 Resolve Conflicts → Merge。没有修改 Diff 编辑权限、合并入口或后端错误分类。

## 验证

- 上述 16 项修复后通过；加上既有普通差异、Changes 选择与键盘回归，定向 **4 文件 / 83 项通过**。日志：`E:/IDEAproject/gitx/test-results/conflict-diff-after-20261119.log`。
- 独立 Rust 测试 `conflict_diff_sides.rs` 在临时仓库中生成真实 UU/AA/UD/DU 索引阶段，再调用产品 `read_blob_at` 和 `compute_hunks`。确认 HEAD 中没有 AA/DU 路径时为合法空侧，UD 工作文件删除时为合法空侧，四种情况都有实际差异；同一文件的 INDEX 读取继续报错。新增 **1 项通过**，原 `history_read_errors` **17 项通过**；日志：`E:/IDEAproject/gitx/test-results/conflict-diff-rust-20261119.log`。测试使用本工作目录默认 Cargo target，未重跑其他目标。
- 前端类型检查、三个修改 TypeScript 文件 Oxlint、Rust 新测试 rustfmt 及 `git diff --check` 通过。类型日志：`E:/IDEAproject/gitx/test-results/conflict-diff-types-20261119.log`。
- 后端 `diff_file` 原本已经按 HEAD/WORKTREE 读取两侧，将缺失侧交给差异计算并保留二进制/过大文件提示；未更改此逻辑。

## 边界与交付

HEAD → worktree 是当前版本与工作文件比较，不表达三栏合并的全部两方语义；需要选择冲突两方或编辑结果时仍使用合并编辑器。测试覆盖文本 UU、AA、UD、DU；本轮未新增二进制或子模块冲突专项验收，也未新增通用 Diff 写权限实现。

代码与定向自动验证已完成。完整前端、生产/原生构建、原生新版界面、用户安装版更新及提交/推送由整合验收补记。原始 `merge-scroll-gui-20261117` 仅执行只读命令，未修改。

整合验收：最终组合完整前端 **135 文件 / 1163 项**通过，类型检查、Vite 生产构建和 Windows 原生构建通过。日志 `continue-actions-tree-conflict-{tests,web,native}-20261119.log`。使用 `gitx-tree-open-final-0140-qa037-20261119.exe`（SHA256 `D6A3C6FEF9EEB2E24A60581C48BFF6B5CC65F12EDA9353C2D7AA3E40C9B98694`）在同一 fixture 双击 `merge.txt`，加载后标题显示 `HEAD → Local`，左侧本地 1600 行与右侧冲突标记/传入内容正常显示，不再报 stage 0 错误。本次原生验证覆盖 UU 双击读取；AA/UD/DU 和其他入口仍是自动回归证据，未冒充原生全部覆盖。

专用测试进程已结束，HEAD、文件 SHA256、索引字节、stage 内容、status 均与打开前一致，设置 SHA256 恢复一致；核验结果 `qa037-after-20261119.json`。安装版未替换。代码、测试和报告独立提交推送，哈希及远端核对在统一台账登记。
