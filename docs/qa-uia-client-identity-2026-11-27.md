# QA040：UI Automation 客户端身份与静置对照

后续结论更新：[客户端生命周期对照](qa-uia-session-lifecycle-2026-11-27.md)已取得同进程断开/重连及2000文件前台对照，闭合本测试环境静置高CPU归因，QA040关闭。下文保留本轮当时的结果和范围；原8秒输入断档在QA008/034继续，产品未因本归因修改。

日期：2026-11-27。接续[有 CPU 增长的宿主栈](qa-input-host-stacks-2026-11-26.md)。开始前读取台账，fetch 及 master/交付分支检查成功，基线 `d53d77651d14ff14a49b250c9988866a7b4bad28` 包含 master `50a4802dd23f61055668e165f6fe7c0b93b17680`。本轮只增加诊断证据，没有产品代码修复，全程主线程。

## 新增结论

后续[窗口消息与重绘归属报告](qa-window-messages-2026-11-27.md)已补齐请求频率、WM_GETOBJECT有效配对及Tao内部窗口重绘计数，并验证解除观察钩子后仍有高CPU。连接身份仍不能作为每条请求发送方的证明；下一步转向内部重绘安排/处理成本，原8秒滚轮断档仍未关闭。

首次取得本轮原生测试中的 UIA 客户端身份：专用 GitX 进程的 `IUIAutomationClientInfoSource` 报告 `codex-computer-use.exe`，PID20488，创建时间 UTC12:14:40.029802。按 PID/创建时间核对，路径位于 Codex 的 `cua_node/node_modules/@oai/sky/bin/windows`。两个观察组均只报告这个客户端；不能据此断言所有历史采样也只有它。

同一份诊断程序关闭观察器时，首次显式工具调用前的30秒主进程平均 CPU 为 **0.008852核**，采样首尾 `UIAutomationCore.dll` 均未加载；工具初始化、枚举及一次界面树/截图读取后，另一个30秒样本为 **0.466559核**。这是此前缺少的低占用对照，而不是产品优化前后比较。

开启观察器的前台组也取得 **0.308190 / 0.446814核** 的两个样本，客户端观察覆盖这两个样本；观察线程整个149点期间仅增加0.0625 CPU秒。与此同时，另一个已连接客户端的组仍出现低占用乃至计数增量0，因此**连接不等于持续请求，更不等于全部 CPU 的归因**。

本轮确认了测量环境中的具体可访问性消费者，并收窄后续隔离方向。尚未取得每次请求来源/频率与 CPU 的对应关系，也未重现原8秒级滚轮递送断档；QA040、QA008、QA034保持未关闭。没有据此关闭可访问性、修改Tauri/Tao或宣称用户的卡顿全部来自测试工具。

## 接口与诊断边界

- 本机 Windows build26340。Microsoft 的 `IUIAutomationClientInfoSource` 文档列出最低build26100，本机对应CLSID注册在系统UIAutomationCore。使用官方头文件中的COM接口/CLSID经 `CoCreateInstance` 创建，调用 `GetConnectedClients` 和 `IUIAutomationClientInfo` 的PID/名称属性。
- 本机SDK为19041，缺少新声明；诊断C++仅复制已核对的最小ABI。没有采用此前待查的 `UiaGetClientInfoSource` 名称：本次获取的官方头文件没有该声明，猜测的文档路径404，不能当作可用API。
- 观察器每约1秒读取一次连接快照，同时记录当前进程和观察线程CPU、UTC FILETIME及查询耗时。SAFEARRAY、接口、BSTR、COM初始化均对称释放；两组所有387次非空数组销毁均返回S_OK，389次查询无失败，两个观察循环均记录COMPLETE。
- 观察器是测试程序自己正常加载的本地DLL，在单独线程运行；不注入其他进程、不改目标内存、不暂停线程、不注册连接回调，也不改变产品的可访问性输出。它会主动加载UIAutomationCore，因此启用组不属于“无UIA”基线。
- 一次性独立进程查询及延长至5点的无窗口对照都没有返回客户端。该对照防止把接口结果直接理解成当前机器全部客户端清单；它仍不能给出请求速率或目标窗口级调用归属。
- 未重复此前失败的ETW权限请求，没有提升权限、改变系统设置或停止测试工具进程。

官方定义及文档已随原始证据保存：

- [Microsoft接口文档](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationcore/nn-uiautomationcore-iuiautomationclientinfosource)
- [GetConnectedClients返回值及释放要求](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationcore/nf-uiautomationcore-iuiautomationclientinfosource-getconnectedclients)
- [Microsoft win32metadata头文件](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/UIAutomationCore.h)

## 实际程序与测试过程

产品逻辑基于上述0.1.56源码，复用此前已构建的前端dist。临时Cargo example启动同一个 `gitx_lib::run()`，另起可选观察线程；构建后临时源码已移除，最终仓库只有文档变化。三组使用完全相同的诊断EXE：

`90ecca0f012e95399956d7bf8087b76e2584d1aec742e7a99153e24585111509`

观察DLL SHA256：

`4cad900fa4f9b89340694c0d7c3cb706a773a845fcfdb51811e32f217b180c1f`

专用identifier为 `app.gitx.qa040clients20261127`；每组全新WebView profile，最近项目为空、无仓库、后台Fetch关闭。stdout/stderr写真实文件，没有CDP端口、trace或Git写入负载。通过脚本启动且不创建控制台窗口；实际GUI观察/前台恢复/关闭均用规定的Computer Use接口。

诊断example最初没有公共控件manifest，两次启动在运行产品逻辑前退出（第二次退出码`0xC0000139`）；补入正常GitX的Common-Controls6清单后运行。失败证据单列 `control-loader-failed`，不计有效CPU组。example仍没有应用图标资源，启动stderr有一次图标读取失败；这是诊断程序与正常打包产物的差异，不冒充发布版验证。

独立C++工具最初两次因测试代码的无效 `setvbuf` 参数退出，移除后调用成功，原日志保留；没有将这些诊断工具错误登记为产品缺陷。

## 七个短样本

CPU核数为主进程累计CPU秒/墙钟秒，**不是整机百分比**，不包含WebView子进程。所有样本约30秒、7点，使用相同的只读采样脚本，按PID和创建时间核对身份。时间均为UTC。

| 组 / 采样 | PID | 首点时间 | CPU秒 / 平均核数 | 可确认条件 |
| --- | ---: | --- | ---: | --- |
| control / before-ui | 21728 | 12:13:40.628 | 0.265625 / 0.008852 | 观察器关闭，显式工具初始化之前；首尾UIA模块未加载 |
| control / after-ui | 21728 | 12:15:17.430 | 14.000000 / 0.466559 | 工具12:14:40启动，12:15:01.502–02.158读取界面树/截图；欢迎页截图正确，首尾UIA已加载 |
| observed / before-ui | 26988 | 12:16:28.186 | 0.593750 / 0.019787 | 观察器开启，本组显式窗口枚举之前；约12:16:28.967起已报告工具客户端 |
| observed / after-ui | 26988 | 12:20:22.339 | 0 / 0 | 树返回GitX欢迎页，但截图显示覆盖的浏览器，不能称前台静置；观察器在12:20:28.707最后采样后结束 |
| observed / after-activate | 26988 | 12:21:30.237 | 7.765625 / 0.258773 | 恢复前台后截图确认为GitX欢迎页；观察器已结束，不属于同时采客户端组 |
| observed-foreground / screenshot-only | 21664 | 12:23:12.630 | 9.250000 / 0.308190 | 明确恢复前台，截图正确，未显式读取本进程界面树；观察器在途且报告同一客户端 |
| observed-foreground / after-ui | 21664 | 12:24:44.777 | 13.406250 / 0.446814 | 12:24:29.522–29.624读取界面树/截图，仍为欢迎页；观察器在途 |

control高占用样本的两条热点线程分别增加8.09375和5.890625 CPU秒；前台观察组最后样本的两条热点分别增加7.453125和5.921875 CPU秒。形态与旧主线程/UIA热点相近，但本轮没有重采栈，不直接给第二条线程命名或把其全部CPU归给某个函数。

两组连接观察：

| 组 | 快照数 / 有客户端快照数 | 覆盖时间 | 观察线程CPU增量 | 查询中位 / 最大 |
| --- | ---: | --- | ---: | ---: |
| observed | 240 / 239 | 12:16:27.958–12:20:28.707 | 0.0625秒 | 0.05905 / 0.4555ms |
| observed-foreground | 149 / 148 | 12:22:45.293–12:25:14.382 | 0.0625秒 | 0.0535 / 0.5225ms |

两组都从第1点起持续报告同一个PID，直到最后一点；第0点为空。第二组在最后CPU采样结束后显式写入停止文件，观察器正常结束。观察器的线程CPU不包括它可能间接触发的其他线程开销；启用/关闭组也不是随机化试验，不能用它们的差值计算准确的观测成本。

## 对后续验收的调整

1. “本轮还没读UIA树”及“只截图”都不能再写成无UIA基线。已运行的工具会在新测试进程的显式读取之前成为客户端；本轮前台只截图组也有较高CPU。
2. 后续性能结果同时记录工具生命周期、客户端连接、窗口前台/遮挡状态和产品CPU。需要隔离工具生命周期的独立对照，不能通过多采几次相同等待栈补齐因果链。
3. 保留本轮启动到显式工具初始化前的低占用对照，不能将其与11月20日/26日的不同版本、不同窗口状态样本直接当作修复前后数据。
4. 继续检查能够归到产品的输入/消息处理及持续滚轮递送。当前证据不关闭8秒级断档，也不证明没有产品侧可优化开销。

## 恢复与交付

三个测试窗口均正常关闭，按PID/创建时间核对每组8个观察身份均退出（共24个身份；其中PID可能复用，不能只按数字去重）。两组观察器正常退出，无测试诊断监听。专用settings分组归档后移除；没有打开或改写仓库。

个人settings SHA256保持 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，安装版未更新。证据目录：`E:/IDEAproject/gitx/test-results/qa040-client-source-20261127`。

- `client-source.cpp/build.cmd/qa-client-source.rs/build-gitx.ps1/gitx.manifest/tauri.qa.json`：可复查的诊断源码和构建方法。
- `control/observed/observed-foreground`：目标身份、CPU原始点、客户端TSV、界面读取时间、settings和退出核对。
- `client-identity.json`、`standalone*.tsv`：客户端身份及无窗口对照；最初失败文件保留。
- `analyze.py/analysis.json/*/parsed-samples.json`：可复算汇总；`verification.json`为恢复检查。

提交前再次fetch成功，master与交付分支均无新提交。仅检查文档、差异及本轮诊断构建/采集/释放，不重复执行未变产品的完整测试。本轮新增产品缺陷0、修复0；补齐客户端身份证据及低占用对照，已知未关闭仍10项，七项目标继续。独立提交推送结果补记到统一台账。
