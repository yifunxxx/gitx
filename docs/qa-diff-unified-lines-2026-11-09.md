# 统一 Diff 文件行号（2026-11-09）

统一视图原使用补丁文档行号，包含 @@ 标题与删除行，与“暂存所选行”要求的新侧文件行号不同。现在按每个 hunk 的 newStart 映射上下文/新增行，标题、删除行和无换行标记显示占位点；跨块和展开模式保持实际文件行号。

13 项针对性回归通过（`diff-unified-lines.log`）。GUI 在两块修改的 stage.txt 中观察到新增行显示 5 与 25，输入 5 后只有第五行写入 index，第二十五行继续未暂存。HEAD、refs、工作区文件哈希与其他暂存条目均保持；`diff-stage-lines-gui-settled-verified.json` 5 项通过。首次即时读取早于写入完成，`diff-stage-lines-gui-verified.json` 保留该次不一致，不将其记作产品失败；等待稳定后重新读取整个 index 文件通过。

桌面证据：`diff-unified-file-line-numbers-gui.txt`、`diff-stage-line-five-gui.txt`，截图实际行号与映射一致。不会将这一个暂存案例概括为所有部分修改内容正确；后续继续检查多个修改块组合。
