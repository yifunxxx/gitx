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
