# QA007 / QA046 原生终端续验

日期：2026-11-28。开始前读取统一台账并fetch、检查master与交付分支成功；基线`7d16ec1`包含master`50a4802`。本次使用QA142最终程序的副本，产品与开始基线一致，不含随后实现的QA143修复。独立仓库没有remote，仅有单行、无换行的测试文件`paste-marker.txt`。

## 已观察结果

1. 启动程序成功，隔离仓库加载完成，工作区无变更。
2. 从File树双击测试文件，编辑器显示`终端粘贴验证 QA007 Unicode Ω`；Ctrl+A后AX明确返回完整选中文本，随后Ctrl+C复制。
3. 点击内置终端，PowerShell会话正常启动，显示隔离仓库提示符；粘贴按钮已可用。
4. 点击粘贴，WebView弹出查看剪贴板文本和图像的权限提示，粘贴按钮进入等待态。依Computer Use技能规则，已请用户自行处理，未点击权限选项。

启动程序采用隐藏窗口参数，首次元素点击报`coordinate input geometry is unavailable`；重新选择实际窗口并使用返回的Raise动作后恢复，截图及后续交互正常。这不是产品按钮失效证据。

截至本报告记录时，尚未取得粘贴成功、终端内选择复制、Ctrl+C取消输入或最终关闭结果。没有通过GUI执行Shell命令，也没有把启动/文件编辑器复制当成终端输入验收通过。运行中命令中断、旧Windows/Unix关闭及终端滚轮仍保留原边界。

## 现场与后续

证据目录：`E:/IDEAproject/gitx/test-results/qa-terminal-native-20261128`。程序`gitx-terminal-native.exe`的SHA256为`549e7eeb85beb5f3d5414a3b630176a2f493873366a14d6e47037fc55e884c11`。专用WebView profile与`app.gitx.qa142loglocate20261128`设置文件，个人设置未写入。

`target.json`记录根PID35288；`processes-waiting.json`记录目前10个存活身份（PID及创建时间），包含PowerShell25448、conhost25028和权限UI新增的WebView进程。`baseline.json`记录HEAD/index/status、测试文件及个人settings哈希。权限提示等待期间保留本测试窗口，未将其描述为已退出或全部资源已回收。

提交前`verify.py`核对HEAD/index/status、测试文件及个人settings均与基线一致，结果为`verification-waiting.json`；另再次按PID、创建时间和程序路径确认根进程仍存活。这个核对不代表已经完成窗口关闭或最终回收。

用户处理后继续验证并核对现场收尾。本轮没有在该原生流程确认新产品缺陷；审阅发现的快捷键问题另记[QA143](qa-terminal-keys-2026-11-28.md)。QA007/046保持未关闭，整体目标继续，用户安装版未更新。

## 20时后续验：旧现场结束与当前构建

本节更新上述“等待权限/进程仍在”的历史状态。续验前fetch并整合两分支成功，当前基线`01a5df2ecb730b647bf9ff8ffacc14026e481d29`，包含master`50a4802`。未代操作权限选项；旧窗口权限提示已消失，显示`Document is not focused`。重新从编辑器选择、复制已知单行文本，点击终端粘贴后完整内容出现，旧错误消失；Ctrl+C显示`^C`并回到空提示符。旧程序的10个记录身份均自然退出，`exit-old.json`及`verify.py`核对完成。首次Alt+F4及后续窗口遮挡使关闭时序没有连续测量，不作精确退出耗时结论。

旧程序不含QA143以后的终端修复，因此随后使用当前产品重新构建并验证。程序`current/gitx-terminal-current.exe` SHA256为`ef4a6de1689786b0c78769006b39d9232e9e2229d2d502473a0428f586a2f26f`，构建成功；沿用已由用户处理权限的专用profile与identifier，未改权限配置。产品源码/dist与QA161最终版本相同，QA162只改CI及文档。

当前构建的实际结果：

1. 打开同一独立仓库及`paste-marker.txt`，点击编辑器、Ctrl+A后AX明确选中`终端粘贴验证 QA007 Unicode Ω`，再Ctrl+C。
2. 新建PowerShell会话出现正确仓库提示符；点击粘贴后完整Unicode文本进入当前输入，没有权限提示或错误。文本无换行，未提交执行任何Shell命令。
3. Ctrl+C显示`^C`和新的空提示符。这证明取消未提交输入，不把它等同于中断运行中的命令。
4. 对`Unicode`双击及拖动后没有取得可靠可见选区/AX证据，未将终端选区复制计作通过，也未仅据工具操作结果认定产品缺陷。
5. 点击“关闭终端并结束进程”后会话标签消失、空态及禁用工具栏恢复。该会话PowerShell35728及ConPTY的conhost21160按创建时间和路径核对均退出；应用启动时的独立conhost36268在应用仍开着时继续存活，不误计为会话泄漏。
6. 点击关闭窗口后全部10个记录身份自然退出，无强制结束。`current.py finish`核对HEAD/index/status、文件字节及个人settings不变；专用settings已归档并移除。

当前证据：`current/native-target.json`、`current/native-identities.json`、`current/session-exit.json`、`current/native-exit.json`、`current/verification-final.json`、构建日志与CUA会话截图。根PID30268创建于20:49:07；以上身份记录防止把复用PID当成原进程。

仍未覆盖运行中命令的原生中断、终端选择复制和持续滚轮。另观察浅色背景上的PowerShell黄色/浅灰输入偏淡，登记QA163配色候选；代码仅映射默认前景/背景/光标/选择色，ANSI色仍为默认，下一步按真实xterm及主题切换核查。Linux关闭行为已有[QA162](qa-linux-ci-2026-11-28.md)有限自动证据，旧Windows及其他Unix保留。QA007/046继续，安装版未更新，全程主线程。
