# Smart 操作暂停与本地修改恢复

日期：2026-11-10。对应 QA-016。整体测试优化目标仍在进行。

## 复现与修改

初始独立分支的普通 Smart 和交互式 Smart 分别实现 stash push/pop。命令成功返回也可能只是停在 edit，因此旧代码会提前把本地暂存/未暂存内容放回变基的索引。此外，空工作区的 stash push 成功退出但没有创建记录，旧实现仍会 pop 已有 Stash。冲突期间 pop 失败后没有记录后续恢复入口。

隔离回归初始 7 项中 6 项失败，日志 `smart-rewrite-baseline.log`；这是失败用例数，不等于独立缺陷数量。已提取集成目录现有 Smart 模块并加强恢复过程：

- 普通合并、变基、挑选和交互式变基共用保存/恢复流程。edit、冲突及再次暂停期间保持本地修改与操作索引隔离；Continue/Skip/Abort 或合并完成后才恢复。
- 每次保存使用唯一名称，查找本次创建的对象并记录 SHA。干净工作区不恢复任何 Stash；暂停期间其他客户端新建 Stash，不会改变恢复目标。
- 使用 `--index` 恢复，覆盖同文件的暂存与未暂存差异、未跟踪文件；恢复标记保存到实际 Git 目录，重建 Runner 后仍可完成恢复。
- 保存与恢复使用独立取消令牌，避免用户取消操作时中断必要的数据恢复。取消发生在序列开始之前则恢复本地修改；已有 edit 暂停时取消 Continue 不破坏其状态。
- 恢复标记通过临时文件和原子替换保存，区分未应用、正在应用、已应用。应用失败或中断后不会盲目自动重试；应用完成但未清理时只清理保存副本，不覆盖用户后续编辑。兼容此前只有 operation/sha 的记录。
- 补全普通 rebase 的脏索引/工作区错误识别，以显示 Smart 选择；保留“操作进行中”、取消和存储错误，避免把没有开始的新操作误报为新冲突。恢复错误不会再次进入普通脏工作区 Smart 重试。
- 中英文提示同步说明暂停期间保留和恢复失败后的处理。

## 验证

使用真实 Git 和临时隔离仓库验证，未操作用户项目历史。新测试覆盖干净工作区已有 Stash、edit 继续/中止、连续两次 edit、重建 Runner、暂停期间插入另一条 Stash、merge/rebase/cherry-pick 冲突后的继续/跳过/中止、命令失败恢复、普通及交互式 rebase 运行中取消、取消 Continue、恢复冲突及拒绝重复操作。

- 独立分支关联 Rust 回归 41 项通过：`m4_merge_rebase` 5、`m5_rewrite_history` 7、`smart_rewrite` 11、`stash_safety` 11、`update_local_changes` 7。
- 恢复中断及旧标记兼容测试 2 项通过，独立分支本轮合计验证 43 项 Rust 测试。集成目录关联回归 45 项通过：对应五组分别为 6、10、11、11、7 项；两处测试大量重叠，不能相加作为覆盖数量。
- 两处前端定向回归各 2 文件 / 20 项通过；两处类型检查及生产构建通过，保留既有 Vite 分块体积提示。本轮未重复上一轮 680/802 项全量前端回归，因为前端变动只有 Smart 说明文字及其断言。
- 首轮新增恢复状态测试受 Windows 全局 autocrlf 设置影响，未跟踪文本恢复为 CRLF；已明确隔离仓库配置为 `core.autocrlf=false` 后复核。本文的字节/暂存断言限于该受控配置，不把 Git 的换行转换行为宣称为本轮已解决的问题。

日志位于 `E:/IDEAproject/gitx/test-results/`：`smart-rewrite-baseline.log`、`smart-rewrite-main-regression.log`、`smart-rewrite-recovery-state-final.log`、`smart-rewrite-integration-regression.log`、`smart-rewrite-main-ui-final.log`、`smart-rewrite-integration-ui-final.log`、`smart-rewrite-main-build-final.log`、`smart-rewrite-integration-build-final.log`。独立分支原生构建通过，日志 `smart-rewrite-native-build.log`；变更范围 Oxlint、新增 Rust 文件格式检查及 Git diff 检查通过。

## 边界与交付

本轮数据保护验证使用 Rust 接口驱动真实 Git，并非原生 GUI 执行重写的验收。上一轮界面验证不能替代本轮后端变化的原生 GUI 验证；最终同版本整体验收仍属 QA-010。

独立分支测试构建保存为 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-smart-rewrite-20261110.exe`，SHA256 为 `64B2AF89EADB93D65B105249A2763EBA16B43BAE2CF451564BA72384CF4E6AF1`。本轮未启动该测试程序。

检查恢复入口时另登记 QA-019：squash/不自动提交合并、提交面板直接完成合并，以及外部 Git 完成操作后的恢复行为需独立复现和核查。本轮 edit/冲突暂停回归不覆盖这些路径。

集成目录保留独立修改，仅同步 Smart 模块、定向测试、错误分类保护和说明文字。用户安装版 `D:/gitx/gitx.exe` 未替换。功能提交 `1fda65f` 已推送并经 ls-remote 核对远端一致。
