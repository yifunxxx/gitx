# 部分暂存最终桌面复验（2026-11-09）

本轮完成并推送：`73a121d` 按块内容/换行保持，`b7062ca` 取消暂存写入保护，`1bcc4a4` 按块暂存边界与删除语义，`3de8755` 逐行回滚校验和文件替换。各项的失败复现、修复和测试分别记录于对应QA文档。

集成主程序/helper构建成功（`build-debug-partial-index-final.log`，1分46秒），13:13以独立WebView数据目录启动调试进程30480。GUI打开diff-interactions-qa，双击未跟踪的new-crlf-lines.txt，输入第二行进行部分暂存。左侧只出现selected，右侧仍显示first/selected/last，文件从未跟踪区移到Changes。

独立Git核对5项全通过：index精确为 `selected\r\n`，HEAD、refs、其他index条目及全部工作区文件字节不变。工作区尾行仍无末尾换行。证据 `partial-index-final-gui.txt`、`partial-index-final-gui-before.json`、`partial-index-final-gui-verified.json`。这是共享暂存入口重构后的新后端验证。

13:18正常关闭窗口。退出前按父子创建时间约束采样8个进程，退出后按PID+创建时间核对全部结束，Remaining为空。证据 `partial-index-final-process-tree.json`、`partial-index-final-closed-process-tree.json`。自动化会话已重置，原安装版未替换。

测试范围：暂存/取消暂存版本的集成Diff+Git all-targets 29组244项通过（2 ignored为子进程fixture），其后逐行回滚在两个工作区各9项通过；不把两轮相加作为最新全量。独立严格生产库Clippy与两处应用检查通过，独立refs.rs保留既有unused import、testkit保留既有Default建议。按块、取消暂存、逐行回滚API目前未在界面暴露操作按钮，因此对应验收来自真实Git回归。

六项总目标仍在进行。WSL实机、Ctrl+鼠标实际组合、更多长期资源与复杂异常流程仍有限制；集成工作区还有既有修复需逐项整理提交，不能将本批部分暂存修复完成当作整体验收完成。
