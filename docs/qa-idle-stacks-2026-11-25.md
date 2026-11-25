# QA-040：普通启动、窗口状态与线程快照续查

整理日期：2026-11-25。原始采样于北京时间11月24日进行，接续[此前隔离记录](qa-idle-isolation-2026-11-20.md)。本轮取得更完整的线程等待栈，但未确认高CPU根因，没有修改产品代码或关闭QA-040。

## 版本与采样

开始前同步到ee500ca，包含master42df3f7及当时交付分支。使用产品55d0040的QA081最终程序，SHA256 `8AAB496E2AA45295C761C4DA1BE14C58BB06E8E557142786651CA75108931DC7`；PID8924，StartedUtc `2026-11-23T16:07:32.2011190Z`。普通Process.Start启动、全新WebView profile、没有额外浏览器参数。首段前没有显式窗口枚举/截图/UIA读取，但UIAutomationCore已加载，因此仍不是无UIA基线。

| 阶段 | 主进程平均CPU核 | WebView无type进程平均CPU核 | 证据边界 |
| --- | ---: | ---: | --- |
| 启动后首段40秒 | 0.20583 | 未在同一40秒窗口单独汇总 | 主线程与UIA起始线程分别4.641/3.391 CPU秒 |
| 首轮进程树约84秒 | 0.23178 | 0.12207 | renderer为0.00335核；首尾读取非原子 |
| 后续30秒 | 0 | 0 | 同一进程，无产品修改；未连续记录窗口状态 |
| 首次窗口枚举后30秒 | 0 | 未采 | 随后的截图调用报告窗口已最小化 |
| 恢复窗口并截图后30秒 | 0.18390 | 0.07967 | 截图显示欢迎页、无仓库；恢复/激活/截图是组合操作 |

零值表示进程计数器在该窗口内无增量，不表示无限精度的绝对零活动。窗口被发现最小化的时刻晚于零CPU采样，不能回推此前整段窗口状态；恢复后占用回升也不能单独归因为截图、激活或外部客户端。没有更改产品或系统无障碍、安全、隐私设置，没有终止其他工具进程。

## 栈证据与限制

诊断工具使用进程创建时间校验、PSS线程上下文与地址空间克隆，再从克隆读取内存进行StackWalk64。没有远程写入、注入、调试附加、手动SuspendThread或窗口/UIA调用。快照仍会造成采集扰动，因此与CPU基线分开。

本机SDK编译通过；9个系统PDB从微软公开符号服务获取，全部匹配、无unmatched，GitX本地PDB匹配。初始仅导出符号的smoke曾出现重复首帧及一次无模块的展开结果，修正首帧处理并加载匹配符号后，正式30次采样无未知模块帧、30次快照释放均成功。正式每次捕获2.283–3.228ms，墙钟范围UTC16:18:20.466–16:18:27.184。

正式采样中的三线程均无CPU计数增量：

- 主线程：`NtUserGetMessage → GetMessageW → tao event_loop::run_return`。
- UIA线程：`NtWaitForMultipleObjects → OverlappedIOManager::IoThreadProc`。
- 另一UIA工作线程：`NtUserMsgWaitForMultipleObjectsEx → WorkerThread<WinEventsManager::ThreadState>::ThreadProc`。

这些是低占用期间的等待栈，不是此前高CPU期间的执行热点。旧smoke里`UiaRaiseNotificationEvent+大偏移`只是最近导出符号，不能当作真实函数名称；正式符号已明确为OverlappedIOManager。下一步需要在高占用且窗口状态固定时取得调用栈或请求客户端证据，不能用等待栈关闭归因，也不据此加入产品轮询抑制。

## 收尾与交付

证据目录：`E:/IDEAproject/gitx/test-results/qa040-idle-stacks-20261124`。包含target、baseline-cpu、baseline-tree-summary、later-cpu、browser-cpu、after-window-list-cpu、restored-cpu、restored-browser-cpu、formal-main-stacks、formal-main-stack-summary、symbol-validation及诊断源文件。未采集/上传用户内存转储或完整命令行。

11月25日继续时，原7个进程身份均已退出；这里只核对退出，没有声称由测试动作关闭。用户设置SHA256保持 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，未打开仓库、未替换安装版。原始记录保留。本轮未重跑产品测试，因为没有产品改动。

用户要求先拉最新代码后，fetch成功并确认原HEAD已在master中，交付分支远端已删除；本地快进至`5241dd5d64683d03c6e3f5e901ea7293d2c199b3`（0.1.47）。以上仅是0.1.44程序历史证据，不代表最新程序已测。新增确认缺陷0项、修复0项，当前12项已知待办保持；独立记录提交推送结果在统一台账补记。
