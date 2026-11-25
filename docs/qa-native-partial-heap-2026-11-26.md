# 按块归属与列表改名：原生模型及堆回收诊断

日期：2026-11-26。接续QA034/008资源验收及[QA099模型复用](qa-changes-model-refresh-2026-11-26.md)。本轮新增确认缺陷0项、产品修改0项，补充六周期资源和标签关闭释放证据；整体七项目标继续，不以本组结果证明整个应用没有泄漏。

## 基线和程序身份

开始前读取台账，fetch及两分支快进检查成功，HEAD/交付`c3c6e2ff36f1773adc01b8157fe5973c796ff399`包含master`5241dd5d64683d03c6e3f5e901ea7293d2c199b3`，工作区干净，全程主线程。

沿用QA099已验证程序，产品提交`c747b5e331a6ec789b489134394856ea2fa8c7b4`，SHA256 `7BDFF147EFD2DD06A65C590F6414D15F07D50A4A39669CAA3AEFAB87CEB3A012`，没有重新构建或冒充新一轮完整测试。主进程PID32460、启动UTC时间2026-11-25T19:29:26.1154824Z。独立测试设置`app.gitx.qa099`和全新WebView profile；本机调试监听核对为`127.0.0.1:57516`，不对外监听。运行时Edge WebView 158.0.4370.33、V8 15.8.13.3，与11月23日历史实验版本不同，不作跨版本直接性能对照。

证据目录：`E:/IDEAproject/gitx/test-results/qa-native-partial-heap-20261126`。原始堆快照只保存在本地，不上传仓库。测试仓库沿用QA099的2000修改文件，HEAD为`832138fb76207e77e83d061e9a89598aa8e45ce1`，file-0000的两块分别归Changes/Feature。Changes展开，打开该文件一个左右差异标签，保留完整应用及Log面板。

## 方法与实际执行

- 原生GUI打开最近测试仓库并双击文件。首次诊断脚本仍匹配旧版标题`gitx`，发现当前标题为`native-repo — gitx`后停止，尚未写文件或采堆；日志保留为`setup-page-title-failure.log`。随后只修正测试脚本的页面选择条件，继续同一程序实例。
- 基线等待15秒，随后六轮、每轮12次：给file-0000前插唯一内容标记，同时修改default列表名称。每次开始前核对当前文件/元数据仍为本实验上次写入值，结束前只读检查真实DOM的差异标记和2000文件列表标题均已更新；72次全部确认，不把未消费的写入当成功刷新。
- 计划最小更新间隔1500ms；每轮恢复原字节并核对界面恢复，等待10秒后采堆。最后静置60秒。六轮采集UTC19:32:16.238至19:36:39.457，共约263秒，`cycles-result.json`无失败，72次更新及6次恢复日志完整。
- 每个样本执行两次GC，间隔400ms，再读取heap/DOM计数。baseline/final保存完整堆快照。只读诊断返回标量，不保留远端DOM对象句柄，不操作界面或调用产品API。
- 原生右键标签选择Close All Tabs，观察只剩Workspace，再取得closed-tabs样本与堆快照。该阶段在六轮正式采样后进行。

调试器、150ms间隔的只读状态检查、GC和快照均会扰动运行时。本次未测CPU、PrivateBytes或连续滚轮呈现延迟，写入到DOM观察的时间也不是输入到呈现延迟。没有启用额外全量测试/构建与采样争用。

## GC后堆与DOM

MiB按1,048,576 bytes计算。DOM节点计数来自调试协议，与连接到文档的元素数量口径不同。

| 样本 | GC后JS MiB | DOM节点 | 监听器 | 可见编辑器 |
| --- | ---: | ---: | ---: | ---: |
| baseline | 11.084 | 2095 | 821 | 2 |
| recovery-1 | 12.258 | 2095 | 821 | 2 |
| recovery-2 | 12.509 | 2095 | 821 | 2 |
| recovery-3 | 12.586 | 2095 | 821 | 2 |
| recovery-4 | 12.699 | 2095 | 821 | 2 |
| recovery-5 | 12.839 | 2095 | 821 | 2 |
| recovery-6 | 12.921 | 2095 | 821 | 2 |
| final，再静置60秒 | 12.921 | 2095 | 821 | 2 |
| closed-tabs | 12.262 | 1761 | 658 | 0 |

baseline至final增加1,926,208 bytes（约1.837MiB），最后静置阶段只增加20 bytes。关闭标签后减少691,412 bytes（约0.659MiB）。不能把这两个差值当作某个组件的精确retained size，也不隐去六轮中逐步增长的事实。

连接DOM元素在八个关闭前样本中均为931，关闭后822；CSS规则282条、85,893字符保持。所有恢复样本均显示原文件内容和Changes标题，状态Idle。detached节点baseline/final均为120、self size 12,672 bytes，关闭后降为54、5,744 bytes。

## 模型和快照分类

`AnalyzeModels.mjs`按真实对象的`section/label/files/model`属性识别当前分组，按`section/label/expanded/count`识别表头。baseline/final/closed-tabs三份快照均为3个分组、3个独立model和4个表头；没有残留名为`Heap Cycle ...`的旧分组或表头。关闭标签后Commit树仍在，保留三个当前模型是预期行为。

此结果支持“连续改名没有累积旧分组或目录模型”的本场景结论；属性形状识别并非整个应用所有缓存或闭包的完整保留路径证明。

| baseline → final类别 | 数量变化 | self size变化（bytes） |
| --- | ---: | ---: |
| code | +7567 | +1,845,788 |
| native | +2685 | +200,290 |
| object shape | +258 | +12,456 |
| object | +278 | +2,772 |
| closure | +3 | +88 |
| array | +75 | -1,840 |
| string | -112 | -1,044 |

代码类别主要正增量为InstructionStream +1,224,640 bytes、TrustedByteArray +319,408 bytes；只读观察表达式含每轮唯一标记，诊断本身也会编译不同表达式，因此不能把代码增量全部归给产品。分类净值与Runtime heap不是同一口径，不能直接相减当作泄漏精确分摊。关闭标签后普通object减少7256个、closure减少2804个，与编辑器、监听器和detached数量回落一致。本组没有确认随72次更新增长的旧分组、编辑器、DOM或监听器泄漏。

## 恢复与交付

正常关闭程序，13个已观察身份按PID和创建时间全部确认退出，窗口列表无目标，调试端口无监听；其中包含在一次进程树快照中观察到的短命Git相关进程，不扩大为捕获了所有瞬时子进程。所有2000文件哈希、HEAD、index原字节、status、changelists元数据与实验前一致。测试settings归档核对后移除，恢复原先不存在状态；用户settings哈希保持`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。用户安装版未更新。

关键证据为`target.json`、`fixture-before.json`、`updates.jsonl`、`restorations.jsonl`、`cycles-result.json`、各阶段JSON及三份heapsnapshot、`heap-analysis.json`、`model-analysis.json`、`summary.json`、原生截图、`observed-processes.json`、`observed-exit.json`和`restoration.json`。采集、分析及恢复脚本同目录保留。

本轮只交付报告、统一台账及[更新后的七项目标索引](qa-acceptance-2026-11-26.md)，不重复运行未变的产品全量测试。当前11项已知未关闭事项继续；持续快滚、原生终端/拖拽边界、CPU归因和最终组合验收仍未完成。提交前再次fetch及两分支快进检查成功，仍包含master5241dd5及交付c3c6e2f；提交推送结果在台账补记。
