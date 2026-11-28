# QA008/034：0.1.56 连续滚动与断档同期线程栈

日期：2026-11-28（Asia/Shanghai）。开始前、续办时均成功 fetch 并整合远端 master 和交付分支；基线 `b23726320c8ae9eee13f0abd5ab84a214a931c48` 包含 master `50a4802dd23f61055668e165f6fe7c0b93b17680`。本轮只增加验收证据，没有产品修改，全程主线程。

## 结论

当前版本仍复现连续滚动输入递送断档。三场最大更新间隔分别为 7.230、0.873、4.606 秒；长空档也存在于浏览器的鼠标处理入口之间，进入该入口后的 Wheel 到渲染线程接收最大仅 1.971 毫秒。

与[上次未覆盖断档的采栈](qa-input-host-stacks-2026-11-26.md)不同，本次负载场景有 **19 个线程快照落在 4.606 秒断档内**。主线程在其中 16 个快照进入窗口位置、显示或消息调用；可见 EmbeddedBrowserWebView 模块帧。这是宿主消息路径的同期线索，尚未证明调用来源、工具激活行为与停顿之间的因果关系，不能据此修改列表算法、删除窗口事件或禁用可访问性。

QA008/034仍未关闭；新增确认产品缺陷0、产品修复0，已知未关闭事项仍10项，整体七项目标继续。此次没有更新用户安装版。

## 程序、输入及有效性

- 使用QA156最终0.1.56 debug程序，产品提交 `faafda98e1cc86f85e3d5c13fead3ab389f48953`，与当前基线产品相同；exe SHA256 `857EEC84B9425C7F96C71139E0E13687D5F53BDBA2688600587AE4782B2B34A1`。WebView运行时158.0.4370.45。
- 独立仓库含2000个修改文件、20个目录，HEAD `2956174180336ad4de3a3ce40858c35b96f3f85d`，无remote；Commit平铺列表、普通双栏差异、底部Log。专用settings/profile及仅测试进程的本机诊断端口。
- 每场90次第一方CUA原生scroll调用，每次pixels120，前60次向下、后30次向上；输入后获取AX和截图。诊断协议仅用于trace和只读几何，没有合成输入或修改DOM/store。工具调用不等于90次已被OS或浏览器逐个接收的Wheel，不能以调用数扣除更新数认定丢事件。
- loaded-1实际写入同一个活动文件120次，首末30.492秒，结束逐字节恢复。输入调用期间17次、更新跨度内36次、最长断档内18次；不是把全部120次称为滚动同期负载。
- 三份trace均正常结束、dataLoss=false，EventLatency/ScrollJankV4配对错误为0。呈现必须同时满足完整结果ID、DAMAGING、唯一Presentation、Display::FrameDisplayed及首事件ID一致，其他更新不算已确认呈现。
- Python保留64位身份，WIN_QPC使用资源采样前后时间戳映射UTC；全部更新均在映射区间内，offset变化范围分别1.668、1.372、1.139毫秒。该对齐精度足以判断秒级空档内的采栈，不用于证明亚毫秒跨系统延迟。
- PSS快照只读克隆采栈，按线程ID和创建时间计算CPU；13批各30个，共390个快照，全部COMPLETE且FREE_SNAPSHOT返回0。采栈、trace、AX均有观测开销，三场为顺序样本，不是随机对照，不据场间差异宣称负载或采样造成/改善停顿。

## 滚动结果

单位ms；p95为nearest rank。呈现数据从trace滚动事件起算，不是从物理鼠标或工具调用起算。

| 场景 | 调用跨度（秒） | 更新 / 已确认呈现 | 呈现中位 / p95 / 最大 | 最大更新间隔 | 工具返回后更新数 |
| --- | ---: | ---: | --- | ---: | ---: |
| static-1 | 5.068 | 83 / 83 | 10.324 / 12.532 / 17.317 | 7229.824 | 38 |
| static-2 | 4.471 | 90 / 59 | 11.019 / 14.163 / 15.195 | 872.585 | 65 |
| loaded-1 | 4.505 | 88 / 76 | 10.229 / 16.240 / 27.389 | 4605.924 | 77 |

列表scrollTop依次从0→3000、3000→4715、4715→7715，结束截图显示有效文件行和正确差异。各场位移不同，没有证明每个输入的精确像素映射或全部中间画面无空白。

使用[历史输入链分析方法](qa-input-pipeline-2026-11-28.md)复算本次原始trace：按完整Wheel trace身份关联渲染接收，并以唯一同PID/TID范围关联浏览器入口、Builder、Forward。261个有Builder的Wheel全部覆盖，14个合成结束Wheel逐条单列。

| 场景 | 有Builder的Wheel / 合成结束 | 浏览器入口最大间隔 | 入口→渲染接收中位 / p95 / 最大 |
| --- | ---: | ---: | --- |
| static-1 | 83 / 1 | 7229.646 | 0.543 / 0.845 / 1.044 |
| static-2 | 90 / 7 | 872.019 | 0.422 / 0.842 / 1.971 |
| loaded-1 | 88 / 6 | 4605.804 | 0.539 / 0.871 / 1.284 |

最长浏览器入口空档中没有其他Wheel Builder。Wheel与Gesture身份不同，上表不把近似时间当作跨事件身份。结论限于已记录入口前或入口之间未覆盖的路径；不证明更早的Windows接收时刻，也不认定前端已收到全部连续输入。

## 断档同期证据

loaded-1输入调用UTC06:37:04.398–08.903；更新UTC06:37:04.468726–17.814579。最长更新空档UTC06:37:05.962286–10.568142，19个快照首末覆盖4.233649秒。

| 宿主线程 | 同期CPU增量 | 平均占用（核） | 19个快照栈顶/可见路径 |
| --- | ---: | ---: | --- |
| 主线程10748 | 1.625秒 | 0.38383 | NtUserSetWindowPos 10、NtUserShowWindow 3、NtUserMessageCall 3、NtUserGetMessage 3；位置/显示栈含EmbeddedBrowserWebView，再经user32 DispatchMessage/Tao事件循环。 |
| 30484 | 0.296875秒 | 0.07012 | PeekMessage 13、MsgWait 4、PostThreadMessage 2；18个可信栈前缀出现UIAutomationCore WinEventsManager。 |
| 35648 | 0秒 | 0 | 19次UIAutomationCore OverlappedIOManager等待；不能用等待栈解释CPU消耗。 |

EmbeddedBrowserWebView仅有导出符号（symtype4），`DllCanUnloadNow+大offset`和`GetHandleVerifier+大offset`只能表明模块范围，不能解释成这些函数在反复执行。完整栈保留在correlation.json。

断档内资源采样同样显示CPU主要在宿主/浏览器：static-1的13点覆盖6.601秒，宿主0.63909核、Browser0.35742核、Renderer0.00237核；loaded-1的8点覆盖3.874秒，宿主0.44768核、Browser0.24602核、Renderer本采样CPU增量0。线程与进程区间不同，不相加或直接作比例。static-2空档只有1个资源点，无法计算区间CPU。

static-1没有采栈；static-2的150个快照结束早于最长空档，不声称同期。loaded-1的AX读取发生在UTC06:37:08.903–11.944，截图返回14.543，部分与断档重叠；工具行为也需作为待区分因素。

## 代码核查与下一步

审阅当前WindowControls、useWindowTitle和Rust窗口事件：窗口按钮仅在点击时执行最小化/最大化/关闭，标题跟随folderPath；应用窗口回调处理Destroyed回收。没有找到与每次状态刷新绑定的窗口位置/显示调用。

本地锁定依赖wry0.57.1的WM_SIZE处理会更新WebView bounds、WM_MOVE会通知父窗口位置；Tao0.37.2也处理窗口位置/尺寸消息。这些是路径说明，现场栈未证明进入了对应Wry调用，不能据静态存在认定依赖缺陷。没有修改依赖。

后续应区分连续原生输入、窗口激活/位置通知和WebView处理之间的实际消息来源，或取得可重复且不依赖本采样客户端的对照。避免重复同样快照、以单次大delta替代持续快滚，或将历史QA040已关闭的工具会话静置成本当成本次根因。其他功能验收继续推进。

## 收尾及证据

正常点击本轮Close window后，窗口消失；按PID及创建时间确认9个观察进程和3个辅助进程均退出，诊断端口60114关闭。2000文件哈希、HEAD、index tree、status及个人settings哈希全部匹配；专用settings已归档再移除，用户安装版未修改。QA007原终端进程身份仍匹配并保留。

QA153旧PID30736本轮被conhost复用、原窗口已退出；只更新现场状态，不触碰复用进程，也不将退出当作原生验收通过。

过程失败如实保留：static-1在trace写完前提前解析失败，等待写入正常退出后重算成功；static-2首次请求120快照超出工具1..30限制，未采样，改为分批；无样本日志解析、Python3.9七位小数UTC解析后续修正。均为测量流程问题，没有登记为产品缺陷。

证据目录 `E:/IDEAproject/gitx/test-results/qa-scroll-delivery-20261128`：三份原始trace及ready/result/analysis、417个资源点、13份成功采栈日志及首次失败日志、correlation/gap-stack-summary/final-analysis、三份pipeline及pipeline-summary、baseline/exit-verification/settings-final和全部脚本。原始trace SHA256与呈现/输入链分析一致。报告数据、脚本语法及文档检查完成后独立提交推送；状态见统一台账。
