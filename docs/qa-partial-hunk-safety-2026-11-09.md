# 按块暂存的写入保护（2026-11-09）

从Tauri按块入口提取原有逻辑到可测试的GitRunner方法，5项真实Git回归全部失败：空选择给新文件添加空条目、过滤器运行两次并可能留下整文件暂存、删除变成空文件、未校验旧侧编码/类型、未解决冲突被写成普通条目。证据 `partial-hunk-safety-before.log`。

现在逐行和按块暂存共用目标与内容校验，先读取准确stage-0对象，再校验选择并计算内容，最后仅写一次index。拒绝冲突、特殊文件类型、NUL、无效UTF-8和超过5MiB内容；保留执行位和literal文件名。文件已删除时移除index条目；仍存在但清空的文件保留空条目。新文件不再先整体add。

- 新增8项真实Git回归通过；与逐行内容、逐行边界、取消暂存共4组27项通过（`partial-hunk-safety-final.log`）。覆盖单次过滤、过滤失败/锁失败保持、选择验证、CRLF/未选EOF、特殊路径、其他index条目和HEAD保持。
- 集成 gitx-diff + gitx-git all-targets **29组244项通过，2个ignored为子进程fixture**（`partial-index-rust-all.log`、`partial-index-rust-summary.json`）。这是本次暂存/取消暂存修复版本的全量结果。
- 独立生产Git库严格Clippy通过。独立应用cargo check补齐缺失helper构建资源后通过，保留refs.rs既有unused import警告；集成应用cargo check通过，新增未使用导入已清理。

未增加IPC字段。按块操作尚无界面按钮，不声称完成按块GUI验收；先前逐行GUI验证发生在本次共享入口重构之前。
