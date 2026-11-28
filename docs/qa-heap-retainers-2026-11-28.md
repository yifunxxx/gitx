# QA034：差异刷新后的堆对象保留路径

日期：2026-11-28。开始前读取台账、fetch及master/交付分支检查成功，干净基线`9e6c9637e5c6c69162f5c7a2bcf9629412590869`包含master`50a4802dd23f61055668e165f6fe7c0b93b17680`。全程主线程，本轮没有产品修改。

## 结论及范围

补齐[前次六周期实验](qa-resource-heap-2026-11-28.md)缺少的对象分类和保留路径。当前同进程六轮刷新后，快照自占字节净增1,895,448，其中`code`类型净增1,622,684字节，占净增约85.61%；普通`object`净增408字节、`closure`28字节，第三到第六轮两类均没有净增长。浏览器性能记录及可访问性缓存也取得明确的快照引用路径。

两侧CodeMirror实例在基线、第三轮、第六轮都只有2个，身份随刷新替换，原生关闭全部标签后为0。相应Vue依赖对象没有随六轮增加，关闭后下降；DOM和监听器也释放。这一场景没有发现历史编辑器或响应式依赖累计存活的证据，不据内存总量增长修改产品生命周期。

这是当前仪器化实验的分类结论，不能把它倒推为前次1.846MiB余量的逐字节归因；两次写入正文、恢复时长及GC时机不同。本轮未验证原8秒输入断档，未覆盖所有规模和长期路径，QA034/008及原9项保持未关闭，整体七项目标继续。

## 程序、场景和干预

- 复用QA145最终0.1.56构建，产品提交`e2a7e888026eedb31ea09b2ab18ffb65962b5b3d`；当前HEAD只多交付记录。EXE SHA256为`2ED28B58377E584AA9D78F0E4026881A8290684DDBCCF64D84472625714813AC`。
- 独立程序`E:/IDEAproject/gitx/test-results/qa-heap-retainers-20261128/gitx-heap-retainers.exe`，PID27220、创建本地时间10:26:52.175811；独立identifier `app.gitx.qa145terminalclose20261128`、专用settings和新profile，仅本机18439端口提供诊断。用户安装版和个人settings不变。
- 复用2000修改文件fixture，HEAD `34f39afb588c87fb55038045fc4601e249ad831b`。原生界面实际为平铺Commit列表，双击打开0000、0001、0002三个只读差异标签，活动0002、底部Log可见；没有用协议调用应用store或合成UI输入。
- 场景准备后重置Computer Use会话，采样期间不做原生操作；关闭标签前重新连接，关闭后再次重置。没有加载UIA客户端观察器，本轮不声明所有可访问性连接都为空，也没有新CPU归因。
- WebView158.0.4370.45、V8 15.8.13.4。先读取实际CDP协议，再使用HeapProfiler.enable/collectGarbage/takeHeapSnapshot。同一诊断连接在四份快照间保持，保留进程内对象身份；场景读取只返回标量/字符串，不保存远端对象句柄。
- 六轮各45次、约1秒间隔，只改活动文件0002；每次在原正文后附加本轮编号、时间，恢复后等15秒。共270次写入及6次恢复，写入前核对字节，finally恢复；不等于270次独立Git刷新。与此前替换正文、恢复45秒的自然实验不同。
- 基线、第三轮、第六轮及关闭标签后均明确执行GC和堆快照。快照会改变运行和回收，**不是自然内存曲线或滚轮帧时间测量**；只用来检查当时存活对象。四次采集约1.8–2.0秒，不把这段停顿当作产品交互延迟。

## 测量与对象分类

下表MiB均为1,048,576字节。Runtime JS堆与包含V8/Blink native节点的快照自占字节采用不同口径，不相减推导泄漏。

| 阶段 | GC及快照后JS堆MiB | 快照自占MiB | 快照节点 | DOM节点 / 监听器 | EditorView实例 |
| --- | ---: | ---: | ---: | --- | ---: |
| 基线 | 11.857 | 17.846 | 340621 | 2078 / 836 | 2 |
| 第三轮 | 12.832 | 18.978 | 341033 | 2078 / 836 | 2 |
| 第六轮 | 13.517 | 19.653 | 342915 | 2078 / 836 | 2 |
| 原生关闭全部标签后 | 12.271 | 18.232 | 324481 | 1781 / 654 | 0 |

基线至第六轮快照`code`净增1,622,684字节，包含InstructionStream +1,294,528、TrustedByteArray +391,668等，BytecodeArray同时减少182,220字节；这不是简单累加所有编译相关类别。取样路径可见`closure → code → instruction_stream`，例如函数`resolve`的21,376字节InstructionStream由Vue模块上下文中的函数保留。没有声称这些代码缓存一定达到长期上限。

`native`净增289,852字节；其中实际native PerformanceResourceTiming数量63→250→250，LayoutShift 8→146→150，关闭标签后分别仍250/150。取样路径从Window到GlobalPerformanceImpl、Performance、PerformanceEntry向量，再到对应记录；DOMRectReadOnly取样由LayoutShiftAttribution保留。实际产品只安装可选的longtask观察器，没有layout-shift或resource观察器。此处证据是浏览器Performance缓冲的存活路径和本组数量，未擅自清除性能记录，也不把观察到的150/250扩大为所有浏览器的保证上限。

另外取样的32,776/24,584字节哈希表由`HTMLDocument → AXObjectCacheImpl`保留。可访问性缓存存在不等于泄漏或高CPU根因；没有因它禁用可访问性。

EditorView按对象同时拥有`contentDOM`、`scrollDOM`、`docView`、`inputState`的形状识别，并核对构建中类名`Ne`。三个阶段对象ID分别为186335/463935、677331/677985、782987/783625；闭合快照没有该形状实例。Vue依赖类`Cf`/链接类`w2`根据本次产物的构造器字段识别，只统计object实例：

| 类型 | 基线 | 第三轮 | 第六轮 | 关闭后 |
| --- | ---: | ---: | ---: | ---: |
| Cf | 14821 | 14821 | 14821 | 13810 |
| w2 | 15896 | 15893 | 15893 | 14719 |

第三轮相对基线新出现57293个对象身份，其中9494个仍在第六轮存活；这包含运行时代码和native对象，不能将全部新身份算作业务对象泄漏。关闭后快照自占减少1,490,293字节，其中object减少344,068、closure减少97,792；JS堆下降约1.246MiB。页面仍保留工作区、Commit和Log，因此关闭后不应预期整个页面对象归零。

## 分析可信度与限制

分析器依据快照自带meta解析节点/边，核对节点数、边数、边界和每个快照对象ID唯一性。差分按`type + name`分组并同时比较对象ID。保留路径为排除weak边后的根广度优先路径，**不是支配树或某个对象的retained size**；未把某条取样路径扩展为所有同名对象的唯一持有者。第六轮342915节点中342836可按该规则到根，余79不被强行归因。

形状识别和Vue类名只适用于本次构建；计数脚本初稿按名字包含了同名构造器，已改为限制object/native类型，表格使用修正结果。最初原生点击报`coordinate input geometry is unavailable`，刷新截图后恢复；第一次文件点击后的立即状态尚未显示标签，后续截图确认成功，未把较早状态当失败或重复建立相同标签。

## 恢复、验证与交付

原生右键Close All Tabs后只剩Workspace，采样确认0编辑器；之后通过窗口关闭按钮退出。8个观察到的GitX/WebView/helper身份均按PID及精确创建时间确认退出，18439监听关闭，专用settings归档后移除。2000文件SHA、HEAD和完整status保持，270次写入/6次恢复核对通过，程序SHA保持。个人settings SHA256仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。

QA007旧窗口及权限现场单独保留；其仓库/索引/文件和个人settings也复核保持，不声称全部历史测试进程已退出。当前实验没有操作权限提示。

证据目录：`E:/IDEAproject/gitx/test-results/qa-heap-retainers-20261128`。包含prepare.py、capture.mjs、四份heapsnapshot及SHA、snapshots.json、writes.jsonl、六轮scene、analyze.py/analysis.json、三份paths.json、check-editors.py/editor-instances.json、verify.py/verification.json、identities.json/exit.json、settings-final.json。原始快照只保存在本地，报告提供必要汇总。

本轮新增确认缺陷0、产品修复0，完成这组当前版本的对象保留路径及关闭回收验证。未改产品，不重复上一轮2338项/构建；分析、证据一致性和文档检查后独立提交推送，交付见统一台账。

提交前再次fetch及master/交付分支检查成功，无新提交；报告数据断言、分析脚本语法、367处本地报告链接及Pages检查通过。当前产品源码与复用程序对应提交无差异。
