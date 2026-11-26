# QA008/034：原生连续滚动与输入递送边界

日期：2026-11-26。开始前读取台账、fetch 并检查 master 与交付分支，干净基线 `5bea847b25074ce45f60e5bf84af206bc5a85afd`，包含 master `fdc51568d102e731aeaafb3fa62b9f7a28dff12c`。全程主线程，本轮没有产品源码修改。

## 运行版本与方法

基于上述 0.1.49 源码重建 Windows debug/no-bundle 程序，复用 QA117 已通过类型/Vite 构建的同一前端输出。独立 identifier `app.gitx.qascroll26`、独立 settings 和 WebView profile，stdout/stderr 写入真实文件；只对这个测试进程启用 `127.0.0.1:50460` 诊断监听，没有修改用户安装版。

程序 `E:/IDEAproject/gitx/test-results/qa-scroll-native-20261126/gitx-scroll.exe`，SHA256 `59b5a7a92da3bc74eeb4480bed3410e4abc18300f3c4f4798d9fac0172ab3129`，主进程 PID32292，创建时间 `2026-11-26T09:00:42.2805583Z`。WebView 为 Edge/Chromium158、DPR1、1280×800 内容区域，ANGLE/NVIDIA GTX1060/D3D11。Commit 树视口高305px，2000修改文件、20目录；同时打开普通双栏差异，底部 Log 保持可见。

通过第一方原生输入工具在观察到的 Commit 区域坐标连续调用 scroll，参数每次120px，前三分之二向下、后三分之一向上。调用返回后读取可访问性状态和截图；没有通过 CDP 合成输入、修改 DOM 或调用应用 store。诊断连接仅采集 `benchmark/cc/input/latency` trace 和前后只读列表几何，运行时协议保存到证据目录。

## 有效采集与失败尝试

| 组 | 工具调用次数 / 耗时 | 调用间隔中位 / p95 | Trace滚动更新 / FIRST之外的更新 | 可严格关联呈现的更新 |
| --- | --- | --- | --- | --- |
| static-1 | 30 / 1.812秒 | 58 / 79ms | 12 / 9 | 7 |
| static-2 | 90 / 5.129秒 | 55 / 77ms | 84 / 80 | 75 |
| loaded-1 | 90 / 4.923秒 | 53 / 75ms | 85 / 82 | 84 |
| loaded-3 | 90 / 4.931秒 | 53 / 76ms | 83 / 82 | 83 |

`loaded-2` 不列入有效性能组：测试窗口一度被其他窗口覆盖，恢复前台耗时超过 trace 最初90秒上限，trace在本组输入前结束，滚动更新为0。其文件写入和进程采样确实执行，但不能补造呈现数据。随后将采集上限延长至300秒，并同时启动采集/资源/写入器，`loaded-3` 完整覆盖目标更新。全部组原始证据保留，失败组不删除。

三次负载写入各120次、间隔约250ms，仅改当前差异文件，结束后逐字节恢复。不是每250ms重写2000文件，也不代表每次写入均触发一个独立Git刷新。`loaded-3` 实际写入 UTC09:19:44.358至09:20:14.930；其83次更新中47次发生在写入期间，其余属于后续排空/恢复。不能把整组都称为持续写入期。

## 呈现与输入断档

分析保留64位整数 ID，按名称/类别/PID/scope/ID配对异步事件；要求同PID/result_id的唯一 ScrollJankV4 与 Presentation、首个真实update身份一致、DAMAGING、EventLatency终点等于Presentation且有对应Display时间。四组所分析的 EventLatency/ScrollJankV4 配对问题为0，采集报告 dataLossOccurred=false。

| 组 | 可关联呈现延迟中位 | p95（nearest rank） | 最大值 | 全部更新相邻间隔最大值 |
| --- | ---: | ---: | ---: | ---: |
| static-1 | 13.406ms | 16.873ms | 16.873ms | 1398.049ms |
| static-2 | 10.520ms | 13.922ms | 15.415ms | 8472.825ms |
| loaded-1 | 9.990ms | 14.197ms | 33.171ms | 9108.430ms |
| loaded-3 | 9.850ms | 14.215ms | 16.812ms | 8562.076ms |

这些是已经进入 Chromium EventLatency 的更新到其关联呈现事件的时间，不包含未被关联的工具调用，更不是物理鼠标到显示器的完整延迟。工具调用数、浏览器MouseWheel事件数与有效更新数不一致，不能拿调用次数作为呈现总量。

`loaded-3` 出现一个包含83次更新的手势，跨度14.371392秒；资源采样 QPC 完整包围该区间。以 WIN_QPC 和87个UTC/QPC括号插值，首末更新约为 UTC09:20:06.465和09:20:20.837。工具90次调用在09:20:06.364至09:20:11.295返回，36次更新晚于最后调用返回；最长断档约09:20:10.691至09:20:19.253。UTC/QPC偏移范围约0.950ms，远小于8.562秒断档，但没有逐次调用与原生事件ID的一一对应。

工具调用之后、排空之前的截图与最终scrollTop也不一致：`loaded-3` 截图仍在file-0298附近，后续稳定到file-0212附近，最终只读scrollTop4749、挂载47行；与反向输入仍在后续生效的现象相容。不能将较早截图视为全部输入完成，也不能据此判断是产品丢帧或工具后台排队。

本轮比旧三次离散手势增加了连续更新和同组资源证据，但尚未区分工具递送、窗口/宿主消息处理、外部可访问性客户端及应用自身等待，QA008/034保持未完成。下一步优先对照输入事件的到达时刻并取得宿主调用栈；不因上述较低的已接收事件延迟而宣称整体滚动流畅度达标。

## 资源线索与边界

`loaded-3` 87点采样覆盖 UTC09:19:44.925至09:20:31.954，按 PID+创建时间识别8个进程；最长断档内的采样区间CPU中位数：GitX主进程约0.777核、WebView browser约0.316核、renderer和GPU均0核。CPU是各约半秒区间的累计增量，不是线程栈，也不证明每个瞬间都空闲。

这支持下一步检查宿主/消息及外部客户端路径，而不是无证据修改前端行计算。没有取得本次高占用调用栈，QA040根因仍未确认；本组含trace、UIA及文件刷新，不能与无仪器静置基线直接比较，也不用于证明内存无泄漏。

## 恢复、同步与交付

程序通过窗口关闭按钮退出，8个观察到的PID+创建时间身份全部消失，诊断监听关闭。2000文件哈希、HEAD及status全部与基线一致，三次写入器都确认恢复。独立settings归档后移除；个人settings SHA256保持 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。

证据根目录 `E:/IDEAproject/gitx/test-results/qa-scroll-native-20261126`：

- `prepare.py/launch.py/tauri.qa.json/native-build.log/target.json/baseline.json`：fixture、构建和程序身份。
- `trace.mjs`、各组 `*-protocol/ready/result/trace/analysis.json`、`analyze.py`：原始事件、只读几何、丢失标记与可复算关联；loaded-2单独标无有效输入。
- `input-summary.json`：原生工具返回的调用时刻汇总；逐次原始数组和截图在聊天工具记录中。
- `load.py/*-writes.json`、`sample.ps1/*-resources.json/*-identities.json`、`resources.py/resource-analysis.json`：实际写入、资源和时钟对照。
- `exit-verification.json/verification.json/settings-final.json`：观察进程退出、文件/设置及监听核对。

提交前 fetch 发现远端已合入5bea847并删除交付分支，master升级到 `84ececcbe96602161d63611770c30e3028ae66d5`（0.1.50）。已快进整合；差异只有5份版本清单/锁文件，无产品逻辑或外部依赖更新。本报告保留0.1.49实际执行身份，不冒充0.1.50重新构建或原生复测。本轮交付只有证据/文档，不重复运行前轮完整逻辑套件；文档检查后重新推送交付分支。

新增产品缺陷0、产品修改0，补齐一组连续输入/呈现/资源线索；原11项已知未关闭及七项目标继续。既有搜索替换教程/快捷键已交付，本次没有新增用户功能。
