# 提交与 Amend 会话、草稿保护（QA-020）

## 发现与修复

受控异步基线复现旧提交完成后清空新会话草稿/勾选项、重复提交，以及旧 Amend 说明覆盖当前输入。最初 27 项行为测试在独立分支全部失败，在集成目录 22 项失败、5 项通过；两处已有保护不一致。

- 提交固定发起时的仓库、会话、说明、模式、hooks 设置和文件选择。仓库切换、同路径重新导航、身份替换或 store 销毁后，旧完成结果不再修改当前界面、弹提示或发起刷新。
- 每个仓库保留独立的提交进行状态。离开后返回仍不能重复提交，A 完成也不会解除 B 的提交禁用。
- 草稿同步保存到所属仓库；按输入修订版本判断是否可以清空，连“修改后又改回相同文字”也保留。提交期间改变的勾选项不清空。持久存储失败时保留本会话副本并提示，不把成功提交误报为失败。
- Amend 立即进入加载状态，加载完成前禁止提交；可取消，失败后显示原因并重试。迟到结果不能覆盖手动输入；成功 Amend 后恢复未使用的普通提交草稿。
- 原生复查进一步复现后端 `head_message` 吞掉所有 Git 错误并返回空字符串，导致真实失败无法进入前端重试。改为保留错误及取消结果；真实空提交说明仍然是成功读取。
- 提交面板保持输入框可编辑，执行时禁用模式和 hooks 切换。Fixup 目标切换绑定原会话，防重复和失效后续，取消或冲突不显示完成提示。
- 窄提交面板中的“目标”标签不再拆成两行，选择器使用内容宽度。
- Ctrl+K 支持勾选的 Changelist 文件；仅在本会话确实提交成功后切到 Log。按钮与快捷键消费已由 store 报告的异常，避免重复错误。Changes、重写状态、分支与 Log 的刷新集中在 store，刷新失败不引导重复提交。

同步到 `E:/IDEAproject/gitx` 的内容只包含本功能相关文件、翻译块和 `head_message` 方法，保留集成目录的独立修改。没有修改 Git hooks 语义。

## 自动验证

- 新增 52 项回归：store 生命周期 31 项、提交面板 12 项、快捷键 9 项；加上上一轮合并恢复 3 项，两处最终定向各 55 项通过。
- 完整前端回归：独立分支 88 文件 / 746 项，集成目录 105 文件 / 866 项通过。测试有重叠，不相加。
- 两处类型检查与生产构建通过。首次构建发现刷新回调联合返回类型不满足 TypeScript 推断，改为明确的异步 void 回调后重新通过，并再次执行上述 55 项定向回归。
- 修改文件的 Oxlint 通过；Vite 保留既有的大分块提示。
- 原生追加发现对应的真实 Git 基线：3 项中无 HEAD 和取消错误传递两项失败，完整正文/真实空说明一项通过。修复后三项均通过，扩展普通提交、历史重写和 Smart 合并恢复回归：独立分支 23 项、集成目录 26 项通过。

## 原生验证与交付

首轮程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-commit-lifetime-20261111.exe`，SHA256 `CFA021B2ACB3FE78B28178EA69A83DDA5C250888FA994572B1A17FF1519CE3A2`。

已执行以下原生流程：

- 独立测试仓库的 pre-commit hook 等待显式释放，最长 180 秒自动失败。等待期间提交、Amend 和 hooks 开关禁用，说明仍可编辑。
- 释放后故意让 hook 失败；等待期间输入的 `QA retained after failure` 保留。磁盘核对 HEAD、索引、状态仍与基线一致。
- 重试成功提交，等待期间写入 `QA next ordinary draft`；完成后草稿保留，Log 列出新提交，工作区干净。Git 实际提交说明为点击时的 `QA successful commit` 和正文 `Body kept.`，没有被后续草稿替换。
- 勾选 Amend 后显示加载状态，并读取完整标题和正文。修改说明后执行成功，恢复普通草稿 `QA next ordinary draft`，退出 Amend，历史条数仍为 2。
- 切换到无首提交仓库后草稿正确隔离；该场景暴露后端吞错，已新增回归修复。

最终测试程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-commit-lifetime-final-20261111.exe`，SHA256 `38D4F2EF40AFC78497E51A08134B7299FDC556DD36098B2185FB47F8E2A5E5B0`。最终原生构建通过，包含后端错误传递和窄布局修正。

- 重启后普通草稿仍然保留。无 HEAD 时显示明确的错误原因、重试按钮，并禁用提交与目标选择；错误重试不会覆盖草稿。
- 通过命令行在隔离仓库创建首提交，再点原生重试按钮；成功读取完整标题和正文，错误消失、提交恢复可用。取消 Amend 后恢复原来的 `QA unborn ordinary draft`。
- “目标”在默认窄提交面板中保持单行。深色错误文字、加载和禁用反馈可见。
- 最终磁盘核对：重试和取消没有改变外部创建的 HEAD、索引或工作区；前一测试仓库只增加一次普通提交并随后 Amend，历史条数保持 2，完整正文及文件内容符合预期。

跨会话迟到结果、重复请求、存储失败、Fixup 入口失效与快捷键由自动回归覆盖，不把这些写作已逐一原生实测。两个专用测试程序均已正常退出；隔离测试仓库保留。

日志目录：`E:/IDEAproject/gitx/test-results/`。自动验证见 `commit-lifetime-baseline-*.log`、`commit-lifetime-full-*.log`、`commit-lifetime-*-final.log`、`commit-lifetime-build-*.log`、`commit-lifetime-native-build*.log`、`commit-head-baseline.log`、`commit-head-rust-*.log`。夹具初始状态与核对见 `commit-lifetime-gui-before.json`、`commit-lifetime-gui-failure.json`、`commit-lifetime-gui-amend.json`、`commit-lifetime-gui-verified.json`、`commit-lifetime-gui-retry-{head,verified}.json`。

QA-020 已完成代码、自动回归和原生验证，功能提交 `bd7606f` 已推送并经 ls-remote 核对远端一致。整体目标仍在进行，原安装版 `D:/gitx/gitx.exe` 未替换。
