# QA008/034：浏览器主线程任务与窗口消息范围

日期：2026-11-28。开始前及提交前均读取台账、fetch并整合master与交付分支，基线`e9e16c4bcac9c45369c8cea6a087641228709461`包含master`50a4802dd23f61055668e165f6fe7c0b93b17680`。全程主线程，没有产品代码修改。

## 新证据与结论边界

接续[连续输入与同期栈](qa-scroll-delivery-2026-11-28.md)。该报告已有断档中的宿主位置/显示栈，但浏览器trace未开启任务与消息范围。本轮补充这些范围，取得一份无丢失的45秒样本：浏览器主线程53301次消息分派中，51063次message_id=1024，墙钟处理总量6429.994ms、单次最长57.986ms。

同PID/TID且时间完全包含的范围表明，这批1024消息内部实际执行了大量可访问性provider调用；它们不只是同时出现的独立计数。这里没有发送方PID，也没有为1024消息解释私有用途，不能据此把每条请求归给某个工具进程，或宣称找到了用户连续快滚停顿的根因。

本轮是逐次输入后读取界面的诊断，**没有重跑此前90次连续快滚**。有效样本内只有一次完整滚动更新，严格关联呈现9.975ms；另一反向输入发生在45秒采集结束以后，不计入性能数据。单次正常操作不能替代连续性能验收。QA008/034及原9项继续，七项目标未完成；新增确认产品缺陷0、产品修复0，用户安装版未更新。

## 方法与程序

- 使用QA157最终debug程序，产品提交`3ae153b4a09bb4782ab9e3e094ec300d8c3e1d1f`，exe SHA256 `66F23C4AFD2003E3077605CC955915B0DC285E0D9FDCF925282E0F7B85524E36`。当前基线此后只有文档改动。WebView运行时158.0.4370.45。
- 新隔离仓库2000修改文件、20目录，HEAD `955ea624b50180ea2f34638d92bb279a8a6c815d`，无remote；Commit平铺、普通双栏差异及Log可见。专用profile/settings，诊断端口60591仅用于本测试进程。
- 原生操作只通过第一方CUA。诊断协议只采trace和只读前后几何；没有合成输入或修改DOM/store。每次scroll后截图并记录调用/返回/观察时间，包含工具观察开销，不能当无观察器或实体鼠标基线。
- 第一场额外启用disabled-by-default调度事件，6次逐次滚动，trace约1.497GB、10557271事件，明确报告dataLossOccurred=true。这份只用于识别事件量及调整采集，排除出有效性能结论。
- 第二场保留benchmark/input/latency/toplevel/base/ui/accessibility，45秒自动结束。trace 565021774字节、4243737事件，dataLossOccurred=false。浏览器主线程事件覆盖45.097245秒；采集完成UTC08:18:15附近，UTC08:18:46.136为文件导出结束，不能把导出时间加到被测执行区间。
- 第二场首个输入UTC08:18:02.781–02.848，截图返回03.596；第二个输入08:18:18.437–18.518已在采集结束后。前后只读几何因此为200→300，后续反向操作把界面回到200，不将二者视为矛盾或丢事件。

首场资源采样180点在第二场前结束，不拿它计算第二场CPU或精确UTC映射。首场有丢失，不与第二场顺序样本计算提速或采集成本差值。

## 有效样本的范围归属

浏览器PID25464，CrBrowserMain线程16860。53301个完整DispatchMessage范围没有相互重叠；每个provider完整X事件只在同PID/TID、起止完全包含时归入对应消息。瞬时事件、flow及完整事件分开，原始事件数量不当作调用次数。

| 消息数值 | 完整分派次数 | 墙钟合计ms | 单次最长ms |
| --- | ---: | ---: | ---: |
| 1024 | 51063 | 6429.994 | 57.986 |
| 512 | 38 | 24.797 | 1.175 |
| 1030 | 2199 | 11.412 | 0.077 |
| 522 | 1 | 1.559 | 1.559 |

1024消息中完全包含的完整provider范围包括：GetPropertyValue 328583、GetPatternProvider 310606、get_ProviderOptions 166470、Navigate 119245、get_FragmentRoot 76450、GetRuntimeId 52471、get_HostRawElementProvider 24993、get_BoundingRectangle 23454。其他类型及未包含范围保留在`tasks-2-attribution.json`。provider自身可能嵌套，不相加声称独占CPU；Dispatch墙钟同样不等于CPU时间或整机占用。

主线程正常调度的ThreadControllerImpl::RunTask共163次、墙钟合计446.841ms、最长16.258ms。其中任务来源`ipc/ipc_mojo_bootstrap.cc::Accept`合计433.219ms；这是trace记录的调度来源，不是业务函数耗时的完整归属。ThreadController active范围最长456.425ms，不能当作单个不可中断任务。没有从本样本取得多秒阻塞任务，因此不把上述范围直接对应到旧4.606秒断档。

为复核输入，仅从完整第二份trace去掉accessibility类事件，生成131012事件的派生JSON；原文件仍保留，SHA256为`26dcab50d11d590099f7ab1f344ce3912cbb39bb520a8918f06df5d4eece20ed`。原有完整EventLatency/ScrollJankV4身份与Presentation/Display::FrameDisplayed关联检查通过，配对异常0；只得到一个可靠呈现，不能统计连续滚动间隔或p95。

## 收尾、过程问题与下一步

专用窗口正常退出，9个记录身份按PID/创建时间核对均已退出，诊断端口关闭。2000文件逐字节SHA、HEAD/index/status及个人settings全部与基线一致；专用settings归档移除。QA007旧测试窗口未操作，用户安装版未替换。

准备脚本首次手抄exe哈希有一处字符顺序错误，身份断言在启动前拒绝；核对原QA157记录后从该记录读取预期，复核已创建fixture并单独启动，没有重复创建仓库或忽略身份检查。一次脚本文本读取未指定UTF-8、一次导出完成前尝试读取trace失败，均修正后继续；完整日志与失败过程保留，不计产品缺陷。

下一次连续快滚采集应去掉高频accessibility逐调用事件，仅保留已证实有用的toplevel/base与输入范围，并设置短采集窗口；在真正的断档期间取得任务/消息分布，或使用不依赖当前CUA观察的连续输入对照。当前证据不能支持删除窗口回调、修改依赖或禁用可访问性，不重复无断档的单次滚动来替代验收。

证据目录：`E:/IDEAproject/gitx/test-results/qa-scroll-tasks-20261128`。保留两组原始trace/协议/输入时间/结果、`inspect-overflow.py`、`inspect-tasks.py`、`stream_events.py`、`attribute-tasks.py`及派生分析、fixture基线/核对、进程身份/退出及settings归档。报告与台账检查后独立交付，状态见统一台账。
