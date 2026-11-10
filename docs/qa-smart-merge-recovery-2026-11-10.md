# Smart 合并暂存结果与本地修改恢复（QA-019）

## 发现与修复

真实 Git 基线复现两条失败路径：Smart Squash 没有 `MERGE_HEAD`，原恢复逻辑会把合并暂存结果当作已经完成，提前应用本地 Stash；从普通提交面板完成 `--no-commit` 合并则没有调用恢复入口，本地修改一直留在保存记录中。

本轮修改：

- Smart Squash / 不自动提交的合并记录等待提交状态。合并结果尚在索引中时继续隔离本地暂存、未暂存和未跟踪文件；部分提交后仍等待剩余结果处理。
- 普通提交及部分提交成功后检查恢复记录。恢复失败通过成功结果中的 warning 单独提示，保留提交 SHA 和保存副本，避免诱导重复提交。
- 操作在外部 Git 完成或中止后显示明确的恢复入口。状态刷新只读取；按钮固定保存对象 SHA，拒绝过期目标，受仓库写锁和前端忙碌状态保护。
- 已恢复但清理失败的副本只清理，不能再次应用；恢复结果不确定时提示检查当前文件和 Stash，不提供自动重试。
- Squash 是否产生暂存结果在恢复本地修改前判断。已合并或空提交不会把恢复回来的本地索引误报为待提交合并。
- 补测发现没有普通操作标记的 Squash 冲突会被报告为零个冲突；保留真实未合并文件数并显示解决入口，不提供不存在的 Merge 中止/继续命令。

仅同步本轮相关修改到集成目录，保留其独立的提交、Undo、部分索引等实现。代码审查另发现普通提交 store 的异步来源和草稿保护缺口，登记 QA-020，另行复现处理。

## 自动验证

- 最初两项真实 Git 基线失败，见 `smart-merge-recovery-baseline.log`。
- 新增真实 Git 回归 12 项全部通过：Squash、普通面板、部分提交、失败重试、外部完成/中止、错误 SHA、恢复冲突、空合并、空提交、旧 Stash 隔离、恢复后清理、Squash 冲突和外部撤销。部分测试包含多个场景，数量不代表缺陷数量。
- Rust 扩展回归独立分支 56 项、集成目录 60 项通过，包含上述 12 项、Smart 重写、合并/变基、历史重写、普通提交、Stash 安全、保留本地修改的更新及 2 项旧记录/恢复中断单元测试。
- 两处最终前端定向各 32 项通过，覆盖恢复按钮、禁用/错误/导航、冲突入口、成功提交与恢复告警；完整前端回归独立分支 85 文件 / 693 项、集成目录 102 文件 / 813 项通过。完整回归后新增一项无 Merge 标记冲突的组件测试，两处定向再次通过。两处测试有重叠，不相加。
- 两处最终类型检查和生产构建通过。主分支变更文件 Oxlint 无错误，mock.ts 保留既有 unnecessary spread 提示；Vite 保留既有分块大小提示。
- 独立分支原生构建、集成目录 `cargo check -p gitx --locked --features tauri/custom-protocol` 通过。使用实际测试程序导出接口，并用 TypeScript 检查恢复请求、恢复状态、仓库状态和提交结果的兼容性。导出器的 Result 包装与项目直接抛错的 adapter 不同，校验按请求参数及成功载荷进行；原生点击进一步验证实际 IPC。`bindings:check` 本身仅检查文件存在，不作为签名证据。

## 原生界面验证

测试程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-smart-merge-20261110.exe`。
SHA256：`1F42D350D4DC9912EACAAA2C642BBA9AF5ADA466AC8C814BA0BDCAAAFCAF8031`。

使用独立仓库 `smart-merge-gui-external-20261110` 和 `smart-merge-gui-pending-20261110`。夹具通过真实 Git 创建分支、暂存/未暂存/未跟踪内容及 Stash，再写入对应的持久恢复记录，构造重启后状态。Smart 保存记录的实际创建流程由上述 Rust 接口回归覆盖，不能将夹具准备写成原生 Smart 合并入口实测。

- 外部完成场景：打开仓库后显示“操作已经结束”与恢复按钮；“查看 Stash”正确打开保存列表。点击恢复后立即禁用按钮，完成后横幅消失、Stash 列表清空，Changes 显示恢复的两个文件。
- 待提交场景：显示“请先提交或撤销合并的暂存结果”，没有提前恢复按钮。选中 `incoming.txt`，输入说明并从普通提交面板提交；提交完成后提示消失、说明清空、本地文件恢复，Log 显示新提交。
- 磁盘核对：两个仓库的本地文件分别保持 HEAD 的 `base`、索引的 `staged local` 和工作区的 `unstaged local`；未跟踪草稿内容准确恢复。外部完成仓库 HEAD 不变；面板提交只新增 `incoming.txt`，没有混入保存的本地内容。两处 Stash 和持久记录均已清理。

原生覆盖深色界面的呈现、查看、执行禁用、恢复和提交成功；过期请求、失败/恢复冲突、部分提交和清理失败由自动回归验证，不声称已逐一原生实测。

专用测试程序已正常退出。隔离仓库及其恢复结果保留，原安装版没有替换。

本地日志与证据位于 `E:/IDEAproject/gitx/test-results/`：`smart-merge-recovery-rust-main-final.log`、`smart-merge-recovery-rust-integration.log`、`smart-merge-recovery-unit-*.log`、`smart-merge-recovery-all-*.log`、`smart-merge-recovery-frontend-*-final.log`、`smart-merge-recovery-build-*-final.log`、`smart-merge-recovery-native-build.log`、`smart-merge-recovery-contracts-final.log`、`smart-merge-gui-{before,verified}.json`。

QA-019 已完成代码和验证，待提交推送并补记远端 SHA。`D:/gitx/gitx.exe` 未替换。总体目标仍在进行。
