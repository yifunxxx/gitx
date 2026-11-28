# QA164：CSS拖动区域更新阻塞原生滚动

日期：2026-11-29（Asia/Shanghai）。接续QA008/034的持续输入核查，开始前读取统一台账并fetch、整合master及交付分支，基线`3f1ceac1b837a402b86f778553b474ad382ef0c0`包含master`b5987aea07606de7b98d01f7648db8b62f68f4ce`（0.1.57）。修改前再次同步成功，无新提交。全程主线程，未更新用户安装版。

本轮确认并修复一项具体原因：全局CSS拖动区域在滚动时反复更新，浏览器主线程处理区域消息占据了两段最长输入间隔的大部分时间。移除重复CSS机制后，两场相同操作中的秒级断档消失，对应区域消息为零。QA164按此范围关闭；终端、后台写入负载、其他列表及长期组合仍属QA008/034，不能据此宣布所有滚动场景或整体目标完成。

## 原因与修改

修前两份有效trace中，浏览器入口最大间隔分别为971.806ms和9494.154ms。同一`CrBrowserMain`线程大量出现`Receive mojo message`，接口标签为`blink.mojom.LocalMainFrameHost`、`ipc_hash=410473785`。按Chromium公开生成规则计算：

```text
SHA256("blink::mojom::LocalMainFrameHost::DraggableRegionsChanged")
前8位十六进制 = 18775539，十进制 = 410473785
```

公开接口定义说明该消息通知浏览器更新由`app-region` CSS定义的拖动区域。最长间隔内部的非重叠墙钟区间归属如下；这里计算消息区间的并集，避免重复累加嵌套任务。

| 修前场次 | 两次入口处理之间的空档 ms | 该消息数 | 消息墙钟并集 ms | 单条最长 ms |
| --- | ---: | ---: | ---: | ---: |
| continuous-2 | 971.361 | 40 | 920.394 | 33.230 |
| before-confirm | 9493.380 | 525 | 9075.613 | 23.423 |

单条消息并不长，连续大量区域更新使输入迟迟得不到处理。消息载荷约37600–37992字节。上述内部空档扣除了左侧处理时间，因此略小于入口起点之间的间隔；不能把9秒间隔描述成单次JavaScript长任务，也不能将墙钟并集当作纯CPU时间。

原CSS为标题栏声明`drag`，并为应用外壳、按钮、输入、overflow滚动区域和虚拟列表声明`no-drag`。项目实际锁定的Tauri 2.12.5已通过注入脚本处理`data-tauri-drag-region`，包含交互子节点排除、拖窗和双击最大化；当前权限已允许`start-dragging`。

本次仅移除[全局CSS](../apps/desktop/src/styles/globals.css)中的`app-region`/`-webkit-app-region`规则、[App](../apps/desktop/src/App.vue)的三个`app-no-drag`类和[VirtualList](../apps/desktop/src/components/common/VirtualList.vue)的两个内联utility类，添加维护注释。[TitleBar](../apps/desktop/src/components/layout/TitleBar.vue)的两处Tauri拖动属性保留。虚拟列表算法、焦点保护、窗口回调、权限和依赖均无修改。

源码依据归档于本轮证据目录：`mojom_cpp_generator.py`第231行的`_IpcHash`、`interface_definition.tmpl`第157行的完整方法名生成及`frame.mojom`第1531–1533行的接口。来源分别为：

```text
https://raw.githubusercontent.com/chromium/chromium/main/mojo/public/tools/bindings/generators/mojom_cpp_generator.py
https://raw.githubusercontent.com/chromium/chromium/main/mojo/public/tools/bindings/generators/cpp_templates/interface_definition.tmpl
https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/public/mojom/frame/frame.mojom
```

取得的是公开main源码。运行时Edge revision在Chromium仓库未找到，精确版本请求另遇429，未取得运行时私有完整源码；方法归属由公开规则、实际接口标签/哈希和移除前后消息变化共同支持。Tauri依据为本机锁定依赖的`tauri-2.12.5/src/window/scripts/drag.js`，不是未核实的最新版文档。

## 原生前后对照

同一无remote的测试仓库有2000个修改文件、20个目录，HEAD为`6c4212125cf7b69dfe1a7deaf46f666417725bf3`。普通双栏Diff、Commit平铺和底部Log组合；窗口1280×800、DPR 1，同机WebView 158.0.4370.45、同专用profile/settings。修前修后独立构建，采集期间没有产品构建或测试并发。

每场90次第一方CUA滚轮调用，前60次向下、后30次向上，pixels 120；输入中不逐条读取accessibility。工具调用完成不代表Windows已逐条接收，不能依据调用数与trace数之差声称丢输入。CDP仅采集trace和读取几何，没有注入DOM、store或输入。四份有效trace均`dataLossOccurred=false`，EventLatency和ScrollJank配对异常均为零。

| 场次 | 更新数 / 严格确认呈现数 | 呈现中位 / p95 / 最大 ms | 最大更新间隔 ms | 浏览器入口最大间隔 ms | 整份trace区域消息数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| continuous-2（修前） | 89 / 37 | 12.431 / 14.668 / 15.361 | 971.885 | 971.806 | 464 |
| before-confirm（修前） | 82 / 80 | 12.707 / 18.238 / 22.231 | 9494.305 | 9494.154 | 1562 |
| fixed-1（修后） | 90 / 90 | 8.511 / 12.186 / 18.059 | 85.211 | 85.178 | 0 |
| fixed-2（修后） | 90 / 88 | 8.214 / 12.617 / 18.471 | 100.139 | 100.112 | 0 |

严格呈现样本同时校验事件身份、DAMAGING、唯一Presentation和`Display::FrameDisplayed`，不满足条件的不计入呈现通过数。表中呈现耗时是实际关联到的样本，不包含还没进入浏览器的等待。入口到renderer最大耗时修前0.935/2.228ms、修后2.362/2.615ms；主要改善在入口之间的断档，不能宣称所有阶段都变快。

滚动位置修前分别3000→6795和6795→9795，修后0→3000和3000→6000。对照为顺序运行且起始位置不同，没有随机化；区域消息消失及输入间隔改善支持本项原因，但不外推其他机器、实体鼠标、所有列表或后台写入负载。区域消息数来自整份trace，采集时长不同，不以其绝对计数计算跨场吞吐提升。continuous-2没有覆盖输入的同期资源采样，不能借continuous-1采样代替；其余三场资源记录各自保留。

## 自动与操作验证

完整前端221文件、2610项通过，4项既有skip；修前/修后类型检查、Vite和Windows debug构建通过。产品修改文件的格式检查、App/VirtualList lint通过。此项是CSS删减，没有另加只镜像源码字符串的静态测试；因果验证依靠上面的原生trace对照。最终文档检查另见交付记录，未因仅补文档而重复整套测试或构建。

修后原生验证通过：双击文件打开普通双栏差异；标题栏双击最大化、按钮恢复1280×800；最近项目菜单打开和Escape关闭；文件复选框勾选/取消；提交文本输入`QA164 input check`并以Ctrl+A/Backspace清空。只读全DOM样式检查确认`app-region != none`元素为零，Tauri属性仍有HEADER和DIV两处。

拖窗与滚动条拖动保留限制：工具两次标题栏拖动和一次滚动条拖动均没有可确认位移，窗口只读位置仍为164/157。工具接口只有起止点，未能控制Windows按住时长，现有证据不能区分工具即时释放与产品行为。**不把拖动写成通过，也不登记为已复现的新缺陷**；实体拖窗/滚动条拖动继续归QA009补验。保留Tauri脚本逻辑及双击成功不等于拖窗实测通过。

两个测试程序均正常关闭，修前9个、修后9个记录身份按PID及创建时间核对自然退出，诊断端口64172/59075关闭。修前首次退出核查尚有两个WebView身份，稍后自然退出，未强杀。两次专用settings均归档移除；最终2000文件逐字节、HEAD/index/status和个人settings全部保持。未修改`E:/IDEAproject/gitx`主检出源码或用户安装程序。

## 证据与过程限制

证据根目录：`E:/IDEAproject/gitx/test-results/qa-scroll-input-20261129`，修后文件位于`after/`。包括`trace.mjs`、严格呈现与输入链分析脚本、消息区间归属脚本、四场trace/result/ready/analysis/pipeline/drag-messages、输入调用时刻、进程身份/资源、退出核查、fixture/settings核对和构建/测试日志。

| 对象 | SHA256 |
| --- | --- |
| 修前gitx-scroll-0157.exe | `92ff7dd627b48d7be89293195d59673e71e69c1c7cfe74e67de7ab98be3ef195` |
| 修前index-D-3QhKar.js | `835e98e5859d3c66f6376047eb1c25b5c8e548cc2331159ae194c64081281e6a` |
| 修后gitx-scroll-fixed.exe | `0c7bd07377398d5aab8bb00cab8a846f0688d08c3cbaba453a2812612d29d86e` |
| 修后index-DLv4wlS7.js | `f401636f1e98dfc1d6740f6a2b2ea261b89ced9dc8c743046d0e8b56f199fbae` |
| continuous-2-trace.json | `b663a99b43acf8cdafd647a36481069a0e685b2d3129b39d05043a4bfac43a2e` |
| before-confirm-trace.json | `d445d45c1cd40cd5bc8a8f22ed31efa95dc727ee5d38ec253d1de266c5333688` |
| fixed-1-trace.json | `96e14266d0cde36842c5ef881b314475aff926a78dbb229a3b4a859bac72b7f6` |
| fixed-2-trace.json | `d36e19f5407dde01bafdec8037c74f182d2f416b19c72e4ac3e28aa0d4c55efc` |

过程失败保留：准备脚本误以为CommitToolWindow有独立chunk，断言阻止启动，改为核对实际index入口后启动，未覆盖旧fixture。首场continuous-1的30秒trace早于输入结束且没有输入事件，完全排除；其采集UTC16:26:52–16:27:22、输入开始16:27:26，后续改为输入后显式停止并设120秒安全上限。fixed-1首次解析早于导出完成而报JSON截断，等待采集退出0后原文件完整并成功解析，哈希保持。两次AX点击因几何不可用失败，刷新截图后坐标操作恢复；一次Python默认GBK读取失败，显式UTF-8后完成。以上不计作产品缺陷，未修改安全或可访问性设置，未操作用户其他窗口。

## 交付状态

本轮新增并解决QA164一项，原9项继续；QA008/034中的历史“尚未归因”由本项证据补充，不继续把已解决的CSS区域更新作为未知根因。后台负载、终端和长期资源边界仍待验。QA163反相与缓存此前已关闭，验收索引同步补后续证据。产品代码、自动检查和上述原生范围已验证，用户安装版未更新。提交前再次fetch并ff-only整合两分支成功，仍为上述基线，无新增产品修改；`node scripts/check-docs.mjs`通过（中英各22页、79命令、33设置、318链接及18图片），`git diff --check`通过。独立提交推送的完整SHA与精确CI结果随后补记。
