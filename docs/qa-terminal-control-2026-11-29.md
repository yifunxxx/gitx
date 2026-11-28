# QA007/008/046：原生终端控制信号、连续滚轮与会话关闭

后续证据：[持续输出续验](qa-terminal-loaded-2026-11-29.md)已补普通/密集输出两场滚轮、切换和密集输出进行中的关闭。本报告下述“持续输出未测”是当时边界；精确呈现、普通Shell子命令拓扑及其他负载仍保留，不改变本轮静态历史数据的范围。

日期：2026-11-29（Asia/Shanghai）。开始前读取统一台账，fetch并ff-only整合master及交付分支成功；基线`ccbffa8df3dc113375eea55327ced592ad91b59b`包含master`b5987aea07606de7b98d01f7648db8b62f68f4ce`。续办及提交前再次同步，无新提交。全程主线程。

本轮补齐三项有限证据：GitX原生Ctrl+C向真实运行的控制台客户端传递中断信号；两场各90次连续滚轮到达更早的终端历史；关闭一个会话时保留另一个会话，最后全部测试进程自然退出。新增确认缺陷0、产品修改0，用户安装版未更新。

测试客户端由CLI启动后附加到测试ConPTY，并非由cmd执行的子命令。因此只验收实际信号链，普通Shell子命令拓扑仍待补验。终端滚轮没有取得GestureScroll严格呈现样本，不能沿用文件列表的逐帧延迟结论；持续输出负载、精确呈现和其他环境仍保留。原9项及整体七项目标继续。

## 程序与隔离现场

复用[QA164](qa-drag-regions-2026-11-29.md)最终Windows debug构建，与本轮HEAD的产品代码一致。该产品既有2610项前端/4既有skip、类型/Vite/Windows构建及精确CI run `46168119163`成功记录；本轮不重复构建或把旧自动结果算作新跑。

程序`gitx-terminal-control.exe` SHA256为`0c7bd07377398d5aab8bb00cab8a846f0688d08c3cbaba453a2812612d29d86e`；入口`index-DLv4wlS7.js` SHA256为`f401636f1e98dfc1d6740f6a2b2ea261b89ced9dc8c743046d0e8b56f199fbae`。WebView 158.0.4370.45，窗口1280×800、DPR 1。

新独立仓库无remote，只有`fixture.txt`，HEAD为`1bc00dfa6bfcc4beac5092369388526a8c7b13d6`。使用新profile和专用identifier `app.gitx.qascroll20261129`；根PID29148，诊断端口58109。未修改主检出源码或个人设置。

原生打开Terminal默认PowerShell会话，再通过下拉菜单选择Command Prompt创建第二会话。CLI按PID、创建时间和路径核对唯一测试cmd：PID13336，创建于本地01:32:53.260246，对应ConPTY的conhost34640。

## 运行中客户端的中断信号

CLI编译并启动专用`ConsoleClient.exe`（PID24260），核对目标cmd身份后使用`AttachConsole`连接其控制台。客户端打开CONIN$/CONOUT$、只读输入模式并注册控制信号处理，输出3000行历史及`QA007 RUNNING - waiting for native Ctrl+C`，然后等待信号。它没有修改输入模式、注入控制台输入或主动生成Ctrl+C事件；GUI只操作GitX控件和快捷键，没有输入Shell命令。

原生截图确认运行标记后，点击终端空白区域并按Ctrl+C。随后截图出现`QA007 INTERRUPTED signal=0`，cmd提示符保留。`helper-result.json`记录`received=true`、`signal=0`及启动时读取的输入模式487，UTC时刻为2026-11-28T17:34:08.1934541Z（本地11月29日01:34:08）。`helper-exit.json`按原进程身份确认客户端自然退出，未达到180秒等待超时或触发240秒watchdog。

GUI调用起点为1795887247994ms、返回为1795887248181ms；信号与该操作时序匹配。这不是实体键盘端到端延迟测量，也不将外部附加客户端视为cmd启动的普通子命令。

## 连续滚轮与输入链

两场在静态历史输出上各连续调用90次滚轮，前60向上、后30向下，每次pixels120；期间不逐条读取AX，结束后再读AX和截图。调用跨度3.940/4.151秒。工具调用完成不代表输入已呈现。

两份trace均正常导出、`dataLossOccurred=false`，EventLatency/ScrollJank异步配对异常为零。每场取得90个含Builder身份的Wheel及90个wheel EventDispatch，另排除1个合成结束Wheel。诊断连接只读取DOM/几何及trace，没有合成输入或调用产品命令；输入采集时没有构建、自动测试或trace解析并发。

| 指标 | terminal-1 | terminal-2 |
| --- | ---: | ---: |
| GUI调用 / 有Builder的Wheel / wheel EventDispatch | 90 / 90 / 90 | 90 / 90 / 90 |
| 浏览器入口最大间隔 ms | 62.121 | 91.269 |
| 入口→renderer接收 中位 / p95 / 最大 ms | 0.4015 / 2.134 / 2.488 | 0.884 / 2.150 / 2.646 |
| wheel EventDispatch 中位 / p95 / 最大 ms | 0.1215 / 0.227 / 0.895 | 0.113 / 0.165 / 0.395 |
| 原事件→renderer结束 中位 / p95 / 最大 ms | 9.4885 / 16.085 / 16.812 | 8.6295 / 16.427 / 16.738 |
| DraggableRegionsChanged消息 | 0 | 0 |
| GestureScroll严格呈现样本 | 0 | 0 |

EventDispatch仅表示wheel处理范围，renderer结束也不等于显示呈现。xterm自行处理滚动，本次没有用于文件列表严格呈现匹配的GestureScroll样本，不能据此声称90/90已逐帧呈现或帧时间低于表中耗时。

第一场开始可见历史2997–2999及运行/中断标记，结束可见2903–2910；第二场从2903–2910到2810–2817，原生截图与只读行内容相符，滚动条slider位置变化。xterm自绘滚动器的DOM scrollTop保持0不代表没有滚动。两场顺序执行、起点不同，净位移并不完全一致，不证明每个wheel固定移动相同行数，也没有逐帧排除中间画面空白。

## 采样范围与限制

第一场trace从UTC17:35:10.169到请求停止17:36:49.432，由显式stop结束；资源记录176点。第二场从UTC17:38:30.438到17:40:30.613，达到预设120秒安全上限自动结束，`stoppedByFile=false`。第二场GUI输入发生于UTC17:40:15.133–19.284，90个Wheel完整落在trace内，安全上限没有截断这次输入。

第二场资源采样先达到180点上限，未覆盖该场输入。因此本轮不提供第二场同期CPU、输入与资源UTC映射，也不借第一场资源数据代替。trace与观察器本身存在开销，本轮没有长期资源或持续输出负载结论。

## 会话隔离与收尾

关闭cmd会话后，截图回到PowerShell；`cmd-session-close.json`核对cmd13336及其conhost34640退出，而PowerShell34756及其conhost17356仍以原身份存活。应用启动时独立conhost34680仍在，不将其误计为已关闭会话的泄漏。随后关闭PowerShell，终端空态及禁用工具栏恢复；正常关闭GitX后窗口消失。

`exit-verification.json`核对13个应用/会话记录身份全部自然退出，helper另1个身份也已退出；诊断端口关闭，专用settings已归档移除。`fixture-verification.json`确认HEAD/index/status、文件字节和个人settings与基线一致。没有遗留采集或测试进程，无强制结束，也未操作系统权限提示。

这补充QA046在当前Windows普通会话中的关闭隔离证据，不代替旧Windows、其他Unix或原生高背压场景。两场滚轮及真实中断客户端证据更新QA007/008，但普通Shell子命令、精确呈现和持续输出边界继续保留。

## 证据与交付

证据目录：`E:/IDEAproject/gitx/test-results/qa-terminal-control-20261129`。保存准备/控制台客户端/trace/输入链/区域消息/汇总/退出核对脚本，helper ready/result/exit、会话身份及关闭核对、两场输入摘要与前后行、资源和原始trace。`summary.json`由`summarize.py`复算；原生画面见本轮CUA会话截图。

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| terminal-1-trace.json | 262884582 | `3a826445cf9146da5cdb2ce0060354e1a9db3a45f9a9617ba87b8719d8334c40` |
| terminal-2-trace.json | 65679890 | `05ade3c278fd07445bd0c233747fe56b4a5486250e4365b495f7ef98c9f21394` |
| ConsoleClient.cs | — | `20dbaeda5fe0f877d15600a46e150ece06f52e06a1fc656ead3ea18c55dcea77` |
| ConsoleClient.exe | — | `907f969afa65ca2169615370c5bcb385c788f97027f2ca299abea1fed21cff16` |

首次C#编译因旧编译器误读正斜杠绝对路径失败，改Windows路径后成功，失败时尚未启动客户端。个别AX快照先于异步界面变化，随后截图及进程身份给出实际结果，未据旧快照认定产品失效。第二场采样安全上限及资源缺口按上节保留。

本项仅补验收文档。470处报告/台账/索引本地链接、5个程序/源码/trace哈希与退出/现场证据核对通过，Pages检查通过（中英各22页、79命令、33设置、318链接及18图片），`git diff --check`通过。独立提交推送；完整提交SHA及远端一致性由本地`delivery.json`记录。旧终端报告的“尚未取得任何运行中中断/滚轮证据”由本报告按实际范围补充，不重复采集已通过的相同条件，也不将原9项算作9个已确认缺陷。
