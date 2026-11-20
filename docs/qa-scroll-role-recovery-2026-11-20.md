# QA-034/008/040：滚轮呈现与 WebView 角色恢复采样

日期：2026-11-20（Asia/Shanghai，正文时间为 UTC，换算北京时间加8小时）。本轮完成约8分钟的独立 profile 原生记录，新增可识别 WebView 角色的资源与退出证据；没有修改产品代码。实际滚轮间隔很大，仍不构成持续快滚验收。总私有内存下降主要来自 trace 服务释放内存，renderer 恢复末窗仍比基线高约41MiB；既不能称完全恢复，也不足以认定泄漏。QA-040 的持续CPU来源仍未完全归因。

## 程序、场景与实际时间

使用0.1.40 debug程序 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-terminal-close-0140-20261120.exe`，SHA256 `4B147C6E4523C68D99A01962E1E8452BFB03FD3392029009725DF2CD5DC3CA07`。PID25952，创建时间`2026-11-20T03:05:46.3636724Z`。它包含QA-046终端关闭修复；本记录不把更晚产品修改视为已在这个二进制上验收。本次未替换用户安装版。

专用仓库 `E:/IDEAproject/gitx/test-results/repos/changes-load-20261119` 有2000个预设修改文件。打开3个普通差异标签，写入目标为`group-00/file-0002.txt`。启动器仅向该子进程注入独立WebView profile及`benchmark,cc,input,latency`、360秒JSON trace参数，没有修改用户或机器环境变量。profile不隔离应用设置，因此另有设置备份及恢复。

阶段按实际UTC/QPC标记，而非计划时长划分：

| 阶段 | UTC开始—结束（2026-11-20） | QPC时长 | 实际行为 |
| --- | --- | ---: | --- |
| baseline | 03:09:17.068—03:10:16.167 | 59.099秒 | 已打开仓库及差异，未执行文件写入或滚轮 |
| static-scroll | 03:10:16.216—03:11:32.367 | 76.153秒 | 3次delta +1200滚轮，每次后观察截图 |
| load-scroll | 03:11:32.432—03:12:41.027 | 68.597秒 | 活动文件连续写入60次；2次delta +1200滚轮，每次后观察截图 |
| recovery | 03:12:41.081—03:13:59.638 | 78.559秒 | 确认原文件已恢复，停止写入和滚轮 |

上表边界保留毫秒精度，完整时钟括号在`markers/*.json`。QPC与UTC读取不是同一瞬间，持续时间以QPC为准。采样自03:05:49开始，包含此前界面准备期，共490.657秒、164点，收到owner stop文件后正常结束，`ErrorType=null`。准备阶段不并入baseline。

实际60次负载写入从03:11:32.727至03:12:31.717，相邻写入间隔0.945–1.059秒，中位数0.995秒；只改一个活动文件，并非逐次重写2000个文件。03:12:32.777–03:12:32.819另有1次恢复写入，哈希恢复为`90696BFDDD90BBF15FC21049A2182401B28B9CFEB3EDE692AB3C1D955D09E318`，此后约8.26秒才开始recovery。写入器会在每次锁内比较自身上次内容，检测外部修改时停止并拒绝覆盖；本轮未触发该保护。HEAD在开始和恢复前检查，未声称每次写入都检查HEAD。

## Trace覆盖与滚轮呈现

`scroll-trace.json`共383909300字节、1914183条事件，SHA256 `dda7503eb83ff83af1a89b60ea4b99b1e5405ef8b4b0cd057c2e999abdf712c6`。实际WIN_QPC跨度360.149962秒，UTC近似03:05:51.808496—03:11:51.953723。它完整覆盖baseline和static-scroll，仅覆盖load-scroll前19.522秒、writer前19.251秒（20次写入），不覆盖recovery。负载期两次实际滚轮未出现在trace中，不能给出负载下滚轮呈现延迟。

时钟域由trace metadata确认WIN_QPC，采样与marker的QPC频率为10000000。按同一单调时钟直接归属阶段，并以各UTC/QPC括号的中点分段插值展示近似UTC。锚点的UTC减QPC偏移范围相差7.431毫秒，不能固定使用启动时一次偏移；没有注入trace原生同步事件，也不声称绝对UTC达到亚毫秒精度。首事件映射到目标创建后约5.445秒，并与粗粒度`trace-capture-datetime`相符，仅作交叉支持。

异步事件按`name＋category＋PID＋ID种类/值/作用域`排序配对，保留64位整数精度，衍生JSON中的ID输出为字符串。EventLatency共391对、ScrollJankV4共3对、InputLatency::GestureScrollUpdate共3对，这些选定事件没有重复待配begin、孤立end或未闭合项。trace buffer的overwrite/drop/loss相关计数为0且final flush succeeded为1；这不扩大为所有可能事件均被捕获的保证。

实际只有3个`FIRST_GESTURE_SCROLL_UPDATE`，普通`GESTURE_SCROLL_UPDATE`为0。按`scroll_begin_arrival_us`分成3组，每组1个update。相邻输入开始相差23.390179秒、14.478484秒，完全不构成持续手势；不能从3次大delta工具调用推断持续快滚、FPS、丢帧或尾延迟分位数。

| 静态输入开始UTC（近似） | 对应Presentation UTC（近似） | 输入至呈现延迟 | 关联依据 |
| --- | --- | ---: | --- |
| 03:10:40.628647 | 03:10:40.650513 | 21.867ms | 同PID/result_id的唯一Presentation，时间等于EventLatency结束 |
| 03:11:04.018295 | 03:11:04.040603 | 22.308ms | 同上 |
| 03:11:18.496451 | 03:11:18.513595 | 17.144ms | 同上 |

三者均为DAMAGING，且同时间的GPU `Display::FrameDisplayed`提供旁证；每个时间有两条相同Display记录，按一个观察处理，不当成两帧。Display记录本身没有输入请求ID，不能独立作为关联依据。本轮没有non-damaging或未能确认Presentation的update。三个输入的FRAME_SWAP分别早于Presentation，不能把InputLatency区间末端当作最终显示时间。`ScrollJankV4.vsync_interval_us`原值6944000与显式`EventLatency.vsync_interval_ms=6.944`的命名单位不一致，本报告不根据前者字段名换算。

另有3个`GESTURE_SCROLL_END`的异步区间持续约22.477、13.851、14.329秒。这些结束事件没有本表所用的update/Presentation关联，故保留在`non_update_scroll_events`，不冒充滚轮输入至显示延迟，也不据此判定页面冻结。三个已确认update样本只说明这三次静态输入的呈现时间，不能据此宣称卡顿全面解决。

## 资源计算边界

每次采样先后核对根进程`PID＋StartTime`，CIM拓扑与逐进程StartTime允许小于1毫秒的CIM时间精度差，读取后再次检查根身份。采样记录只持久化严格白名单的`--type`、`--utility-sub-type`值，不保存完整命令行。`webview-no-type-switch`只代表读到命令行但未见type开关，不独立证明它一定是browser进程；本轮独立trace的`process_name`另将同PID31184标为Browser，并将28476、30832、20420分别标为Renderer、GPU、TracingService。因此本轮可以在这一独立依据下称31184为Browser，而不推广为所有无type开关的进程都是Browser。

共记录8个成功读取的进程身份：根进程出现164点，其余7个WebView出现163点，第一点早于WebView启动。样本42有1个、样本53有3个短命子进程在读取前消失，分别记录`ProcessCommandException`；它们都在准备期，正式四阶段完整快照均为同8个身份、没有skipped。不能据此证明已采到全部短命Git子进程。

实际采样开始间隔2.908–3.100秒，中位数3.005秒；单次读取耗时中位数0.434秒、最大2.584秒。进程读数并不同时发生，因此每个身份的CPU以自身QPC间隔和累计CPU增量计算。表内常驻树CPU是相邻两点身份集合相同且无skipped时，各身份实际CPU速率之和按样本间隔加权的估计；不把它写成原子整棵进程树计数。1核表示一个逻辑核的平均消耗，不是整机百分比。

各阶段只采用起止均完全落在标记窗口内的快照和相邻区间，跨阶段区间排除；进一步收紧至开始标记QpcAfter与结束标记QpcBefore，并使用快照自身QPC括号，所有窗口样本、CPU及内存结论保持相同。末30秒窗口不借用窗外数据、不插值。内存为成功采到进程的PrivateBytes总和，MiB＝2²⁰字节，表中为快照中位数与范围。此轮启用trace，存在采样、GUI观察及trace写出开销，不能与此前无trace实验直接比较产品优化幅度。

| 窗口 | 完整快照 / 根CPU覆盖秒 | 根CPU（核） | 常驻树CPU估计（核） | 总私有内存中位数（MiB） | 采样范围（MiB） |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 19 / 53.932 | 0.313 | 0.551 | 344.453 | 343.570–366.012 |
| static-scroll | 25 / 71.931 | 0.237 | 0.555 | 356.477 | 343.070–370.324 |
| load-scroll | 23 / 66.009 | 0.445 | 1.364 | 377.602 | 325.906–1564.219 |
| recovery全部 | 26 / 74.915 | 0.194 | 0.626 | 320.031 | 318.777–322.738 |
| baseline末30秒 | 9 / 23.886 | 0.302 | 0.532 | 344.027 | 343.570–344.340 |
| recovery末30秒 | 10 / 26.861 | 0.185 | 0.624 | 319.623 | 318.777–320.047 |

03:12:16.168–03:12:16.652的样本130达到本次总私有内存采样峰值1564.219MiB，其中PID20420（`tracing.mojom.TracingService`）单独占1248.539MiB。同期仍在写入负载且trace处于停止/写出阶段，因此该峰值不能直接归为应用业务内存膨胀。它定位了主要内存所在的进程，没有分配调用栈证据，不能进一步断言具体内部缓存结构或瞬时峰值上限。

## 恢复末窗的角色分布

比较baseline全窗与recovery末30秒，各身份私有内存中位数如下。各身份中位数的和未必等于总和的中位数。

| PID / 已观察角色 | baseline（MiB） | recovery末30秒（MiB） | 差值（MiB） |
| --- | ---: | ---: | ---: |
| 28476 / renderer | 58.895 | 100.047 | +41.152 |
| 30832 / gpu-process | 105.402 | 108.199 | +2.797 |
| 31184 / Browser（trace名称；采样未见type开关） | 44.156 | 46.086 | +1.930 |
| 25952 / GitX根进程 | 22.387 | 23.266 | +0.879 |
| 20124 / storage utility | 7.578 | 7.586 | +0.008 |
| 6092 / crashpad-handler | 2.941 | 2.898 | −0.043 |
| 31112 / network utility | 12.438 | 12.301 | −0.137 |
| 20420 / tracing utility | 90.656 | 19.215 | −71.441 |

总中位数比baseline低24.830MiB，但renderer保留约41.152MiB，trace服务释放约71.441MiB掩盖了这一差异。恢复末30秒renderer累计CPU增量为0，不能据此排除保留对象或泄漏；该单轮短恢复也不能区分正常缓存、高水位保留与泄漏。需要后续不带trace、保留角色识别的多周期对照及必要的分配归因。

CPU分布同样没有恢复为零：baseline中根进程为0.313核、由trace识别的Browser进程为0.229核；恢复末30秒分别为0.185核、0.435核，renderer为0核、GPU约0.004核。根进程下降并不代表总CPU问题解决，也不能归因为本轮没有发生的产品修改。未做无UIA客户端基线或调用栈归因，因此QA-040继续待核查。

## 恢复、退出与证据

程序由GUI正常关闭。03:14:28的`restoration-initial.json`确认2000个文件内容哈希0差异，HEAD、index和status全部与备份一致；仅应用`recentWorkspaces`字段发生变化。03:14:51按备份精确恢复设置，恢复后和备份SHA256均为`6DD5D73EAD1F19D1860AE9B143659A0753756E82DFF7B5F5FCCB588693F05335`。

03:17:09的只读`observed-identities-after-exit.json`按8个成功采样身份逐一检查，全部`CurrentIdExists=false`、`SameIdentityAlive=false`，没有读取错误，也没有强制终止任何进程。该检查不覆盖此前未成功采到身份的短命进程，不扩大为全系统无残留结论。

原始来源目录：`E:/IDEAproject/gitx/test-results/qa-scroll-continuous-20261120/run-01/`。

- `target.json`、`launch-plan.json`、`markers/*.json`：程序身份、profile/trace参数及实际时钟边界。
- `scroll-trace.json`、`analyze-scroll-trace.py`、`trace-analysis.json`、`selected-trace-events.json`：原始trace、完整复算脚本及ID精确的派生事件/关联、时钟与覆盖边界。
- `metrics/samples.jsonl`、`metrics/identities.json`、`metrics/manifest.json`：增量原始采样、角色、完整性与停止原因。
- `resource-analysis.json`、`resource-analysis-conservative.json`、`resource-boundary-crosscheck.json`、`resource-attribution.json`：窗口统计、保守QPC边界复查、源文件哈希、按身份CPU/内存与峰值归属；复算脚本在上级目录`analyze-resources.py`、`attribute-resources.py`。
- `fixture-load/before.json`、`original.bin`、`writes.jsonl`、`result.json`：60次负载、单独恢复写及原内容哈希。
- `restoration-initial.json`、`settings-restoration.json`、`observed-identities-after-exit.json`：fixture/设置恢复与观察身份退出。

本轮新增的是有限静态滚轮、角色、采样干扰及恢复证据，没有关闭持续快滚、QA-040或整个目标。后续需要能实际产生持续输入的原生实验，以及不带trace的角色恢复对照；不重复用离散滚轮充当持续快滚，也不把本轮trace服务的峰值误判为业务内存泄漏。
