# 逐行暂存内容与换行保持（2026-11-09）

真实回归复现六种错误：同块部分替换保留了被替换的旧行；选中修改顺带删除另一个块；前部整块插入使后部部分修改偏移并丢行/重复行；CRLF 变为 LF；未选中的末尾换行变化混入 index；新文件选中行丢失行结束符。

现在按原始编辑块顺序构造结果，使用源文本的精确行字节。相邻替换行按原顺序对应，未选中行保留；只有该编辑块的全部新增行被选中时才移除多出的旧行。纯删除块没有新侧行号，需通过块或整文件操作。取消暂存复用同一配对规则，方向相反。

验证：

- 修复前 7 项测试中 6 失败、1 通过；`partial-lines-before.log`。
- 9 项内容回归通过，含所有 16 种四行选择组合，在 LF/CRLF/CR、有/无末尾换行下核对暂存及逆向还原的逐字节结果；`partial-lines-diff-final.log`。
- 2 项真实 Git 回归在两个工作区通过：前部插入和后部部分替换暂存后取消暂存，其他已暂存文件、HEAD 和工作区字节保持；CRLF/无末尾换行精确保留。`partial-lines-git-isolated.log`、`partial-lines-integrated.log`。
- 集成 `gitx-diff` + `gitx-git` all-targets 共 25 组 / 212 项通过，2 ignored 为子进程 fixture；`partial-lines-rust-all.log`。该全量针对本项算法，早于后续逐行写入边界修复的构建。
- 生产库与新增内容测试严格 Clippy 通过。独立基线的全 targets 严格检查被两个既有 manual_contains 测试告警阻止；`partial-lines-clippy-targeted.log`、`partial-lines-clippy.log`。

桌面多块组合需要使用重新构建的后端继续复验；前一次单行桌面通过不作为本项新后端证据。
