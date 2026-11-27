# QA-036 首次读取与活动仓库切换续验

最新状态（2026-11-27）：本页末尾的“快捷键保留焦点与显式放行”已补齐首次status旧成功/旧失败两组原生时序，QA036现已关闭。以下早期失败记录保留其当时结论，不再作为当前待办。

日期：2026-11-26。开始前及续办时读取台账、fetch并检查两分支；基线`6e8d8f974e45c6199ccbc9666d12a33aa356b052`包含master`e2e33d96e3bc0aed8c206fe22562ab9432c8d27a`和最新交付。本轮只补测试与证据，没有新增已确认产品缺陷或修改产品逻辑，全程主线程。

## 原生普通切换通过，首次读取竞态仍未验收

沿用QA108最终程序，产品提交`f603ac2340b826c330fc30789e7e007b75f04ecd`，程序SHA256为`7C736EFF116D001B56EB68CDE4B1AF4D924DA952E3F64C9F7AA1EA557151FD32`。独立profile及`app.gitx.qa108`测试设置，复用已核对的parent/nested父子仓库。

找到无需展开系统select弹层的原生输入路径：点击File筛选输入，Shift+Tab聚焦活动仓库选择器，Down选择nested。普通切换后分支为qa-child、Log为CHILD；Commit面板只显示child-only.txt，任务回到Idle。工作区目录及File树仍以parent为根，这是同一工作区切换Git活动根的正常行为。

此前[跨项目报告](qa-navigation-native-2026-11-26.md)中的“无法可靠输入活动根”限制在普通路径上已解除，但不能据此宣称首次主读取竞态已通过。本批四次延迟首个parent status的尝试均未在GitRunner约30秒超时前完成切换/显式释放；代理退出且没有released记录。保留`trial-timeout*`目录和检查记录，不把随后普通切换成功计为旧响应隔离证据，也未改产品超时来迁就工具。停止同一方法的重复尝试。

此前报告的后台status旧成功/失败两组有效原生证据仍成立。首次主读取期间切根的精确原生时序保持未验收。

## 自动回归补强

扩展`useWorkspaceInitialReads.test.ts`既有一项切根测试为四种组合：旧成功/旧失败，以及切根后是否再次打开一个尚在读取的新项目。使用真实FileRootSelector的select change、workspace/changes/log/branches/jobs stores及面板生命周期；后端响应由测试控制，不冒充原生IPC。

分别延迟旧status、Log和refs。成功响应包含可辨识的PARENT提交、父分支和分支状态；失败响应包含旧读取错误。验证：

- 切根保持工作区路径，新仓库读取开始，旧打开操作立即失去界面等待归属。
- 晚到成功不替换当前文件快照、提交、refs或分支；晚到失败不写入当前错误或弹出toast。
- 旧任务结束仅移除自身；新项目的任务及loading一直保留到它自己的status完成。
- 最后任务归零，当前仓库身份正确；卸载释放待决测试请求。

分支面板的再挂载沿用既有测试场景，测试不声称覆盖App所有后台刷新组合。最终五文件73项相关回归、类型检查、相关Oxlint及文档检查通过；新增测试数据首次类型检查缺少RefsList的recent/current/detached字段，已补齐后复查通过。本轮产品代码未变，复用QA108构建，不重跑或宣称重跑整版构建/原生所有流程。

## 现场恢复

`cleanup-verification.json`核对本批累计记录的42个PID/创建时间身份全部退出，测试Git代理为0。parent及nested的HEAD、索引树、status和三个文件SHA256均与baseline一致，保留原有未暂存修改。测试settings归档移除；用户settings SHA256仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，安装版未更新。

证据目录：`E:/IDEAproject/gitx/test-results/qa-initial-root-navigation-20261126`。包含代理源码及哈希、各次目标/进程身份、超时现场、普通切换与Commit截图、回归日志、baseline和恢复核对。此次新增缺陷0、产品修复0，QA036继续保留精确原生验收边界；11项已知未关闭不代表全部潜在问题，整体七项目标继续。提交与推送结果见统一台账。

## 同日后续门控尝试：仍未取得精确原生证据

基线`56ae0ad144e914a05e3350a1a42f624790d73031`，开始前及收尾提交前均fetch并检查master/交付分支，无新提交。沿用QA110程序，SHA256 `B69649D47091893ABC8C56AF32A97CB117EB52517850AFBD284CC23AB01153B7`，独立profile与测试设置，stdout/stderr写入文件。代理真实执行父仓库首次status后最多等待25秒，产品30秒超时不变；代理SHA256 `A5D14945ECD48A3B3ABAE9E3928F1E106257F31FCCBD17A314D113813E19852D`。

- success：先通过GUI保存File布局再重启。首次输入报告`coordinate input geometry is unavailable`；恢复输入前门控已在25014ms自动返回。
- success-live：同一已激活窗口先打开nested，从最近项目返回parent；确认框就绪后才启用门控。首个窗口读取为空，重新绑定后短暂见Opening project，但输入前门控已在25005ms自动返回。

两次`explicit=false`，均没有release文件；不属于首次读取竞态成功证据。未继续重复同一25秒方法，未开始失败响应组。最后Down普通切根后再次观察确认qa-child/CHILD及Idle，不重复计为新的验收覆盖。

证据目录`E:/IDEAproject/gitx/test-results/qa-root-read-final-20261126`包含Setup/Launch/Observe/Verify脚本、代理源码、baseline、两个阶段的waiting/released及UI记录。`verification.json`确认累计14个观察PID/创建时间身份退出，代理0；两个仓库HEAD/index/status、三个文件和用户settings哈希保持。测试settings已归档移除；用户安装版未更新。本轮新增缺陷0、产品修改0，保留精确原生时序缺口。

## 11月27日当前版本续验：方法仍不满足时序

基线964cf08包含master50a4802/0.1.56，开始前fetch及两分支检查通过。使用QA128升级后构建的0.1.56程序、新父子仓库、独立profile及测试设置，证据目录`E:/IDEAproject/gitx/test-results/qa-root-initial-20261127`，程序/代理哈希见`binary.json`。未改产品源码或超时。

先完成普通导航和File布局，再从nested项目重新打开parent。两次代理均成功拦截首次parent status，界面显示Opening project；只读诊断每200ms记录标题、活动根、分支和任务状态。第一组`success-timeout`在25006ms自动返回，第二组`success-live`在25000ms自动返回，均为`explicit=false`，切换没有在窗口内完成。第二组增加仅在观察到nested活动根、旧代理仍存活且未满24秒时写测试release文件的收尾逻辑，但条件从未达到；没有release证据。不能把这些记录算作竞态验收通过。

普通路径下UIA set_value显示名未改变select，聚焦后Down可切换；直接设置不构成可靠替代。停止重复相同25秒尝试，未执行失败响应组。7个记录的进程身份全部退出，两个仓库HEAD/index/status及三个文件哈希保持，个人settings保持，测试设置已归档移除。详见`process-exit.json`、`baseline.json`、`verification.json`和各组`observations.json`。用户安装版未更新。

本组新增产品缺陷0、修复0；补充当前版本的方法边界，QA036首次读取竞态仍缺有效原生证据。后续应采用能在30秒产品超时内完成输入的验证途径，当前相同多步工具流程不再反复重试。

## 11月27日两阶段门控：识别阶段可提前放行，首次status仍未验收

QA129交付后的干净基线 `0c6f8ceefb189b50b223c057c256fdeca8b6b154`，开始前及提交前fetch、master/交付快进检查成功。重新构建0.1.56独立程序，SHA256 `779c7bfa9dd44d6db7d4841d1098d5455d6e66e956061a72b872d0c7865e87c9`；证据目录 `E:/IDEAproject/gitx/test-results/qa-root-two-stage-20261127`。构建日志位于QA129目录的 `native-build.log`，没有安装或替换用户程序。

为减少首次status门控内的操作，改为同项目通过系统目录选择器重新打开：先延迟workspace_open的rev-parse，焦点到Active repository后放行，再延迟父仓库首次status。代理真实执行Git后缓存输出，每阶段仍最多25秒；产品代码/30秒超时保持。只读CDP诊断每100ms读取活动根、焦点、任务和可见文本，仅在对应代理存活、未满24秒且满足焦点/子根条件时写测试release文件，不向DOM或应用store注入操作。

| 组别 | 仓库识别阶段 | 首次status阶段 | 结论 |
| --- | --- | --- | --- |
| success-tab-timeout | 25002ms自动返回 | 25018ms自动返回；子根首次观察晚于返回5850ms | 经筛选框和Shift+Tab安排焦点仍太慢，没有精确验收证据 |
| success（直接展开选择器） | 12770ms显式放行，已观察选择器焦点 | 25007ms自动返回；子根首次观察晚于返回10845ms | 下拉项鼠标输入因其属于WebView独立Chrome Legacy Window被工具拦截；重新激活及Enter后切换正常，但不满足旧请求存活时序 |

两组status均为explicit=false，因此没有补齐旧成功隔离证据，失败响应组未运行。第二组证明第一阶段安排焦点的方法可行，仍不能以此替代首次status竞态验收；不再重复这两种25秒输入流程。原生截图中的普通qa-child/CHILD及Idle只代表普通切换。首次准备还有工具几何缺失、文件夹对话框索引不可用，改用新截图完成路径输入；这些均未计为产品缺陷。未进行高CPU归因或连续滚轮测量。

测试程序正常关闭，7个观察PID/创建时间身份均已退出，代理0；两仓库HEAD/index/status及三个文件SHA256保持，个人settings保持原哈希，专用settings核对归档后移除。见 `verification.json`、`process-exit.json`、两组waiting/released及observations。恢复脚本第一次按系统GBK读取UTF-8诊断文件失败，显式UTF-8后完整校验通过；该脚本问题未影响产品或仓库内容。新增产品缺陷/修复0，原11项及整体目标继续。

## 11月27日快捷键保留焦点与显式放行：首次读取边界通过

开始前及提交前fetch、master/交付分支检查成功，基线`67c8410d8fac191ad35f3cc2430eee36a4c71e76`包含master`50a4802`，无新远程提交。复用QA133最终0.1.56程序，SHA256 `1bc4360852448b82680fae6767e26c436af03c8ff9cd2ed41c288802d5bfda77`，产品源码与本轮基线一致。本轮不改产品代码，不重复整版构建；最新全量2177前端/构建证据归属QA133，本轮另跑首次读取、根选择及详情反馈3文件29项通过。

独立证据目录`E:/IDEAproject/gitx/test-results/qa-root-keyboard-20261127`包含新父子仓库、专用profile、`app.gitx.qa133details20261127`测试设置、代理源码及只读诊断。代理SHA256 `2701b59f1e00aa7d823406982e580fe1adbfd2d0c3ab2bbdf9f004c021368177`；只拦父仓库本组首次识别及status，先执行真实Git并缓存输出，每阶段仍最多25秒，产品30秒截止保持。

最初两次仍超时，分别归档为`success-focus-timeout`与`success-shortcut-timeout`。前者识别/status均自动返回，后者通过Ctrl+O保留了选择器焦点、识别61ms显式放行，但恢复窗口观察后的Down仍晚于status自动截止。这两次不计验收通过。

最终流程在打开前以筛选框/Shift+Tab把焦点置于关闭的活动根选择器，再按Ctrl+O并选择同一工作区目录，系统对话框关闭后焦点仍在选择器。观察确认焦点后，才创建测试`allow-preflight`文件；只读诊断确认焦点和代理存活后释放识别。在同一次编排内等待首次status代理出现，检查PID/路径和未释放状态，紧接着通过原生工具按一次Down。诊断只读取DOM，只有观察到子根且旧代理仍存活、未满24秒时才写status释放文件；没有通过脚本改变DOM或应用store。

| 场景 | 识别等待 | 首次status等待 | 子根观察 / 旧响应释放时间（UTC毫秒） | 结果 |
| --- | --- | --- | --- | --- |
| 旧成功 | 22250ms，显式 | 989ms，显式 | 1795780118500 / 1795780118511 | 旧父仓库快照没有覆盖当前子仓库 |
| 旧失败 | 22001ms，显式 | 990ms，显式 | 1795780310680 / 1795780310694 | 注入`QA_CONTROLLED_OLD_STATUS_FAILURE`没有显示为当前错误 |

两组status等待起点都早于子根观察，子根观察早于旧响应释放；均未触发25秒自动截止。释放后活动根一直保持nested，原生最终分支为qa-child、Log为CHILD；切到Commit后只显示child-only.txt，没有父仓库修改。打开提示结束、任务最终Idle，失败组在100ms只读变化采样及原生最终界面中均未出现旧错误提示。文件树继续以工作区parent为根属于设计行为，不误判为活动根未切换。UIA部分即时树与document_text滞后一帧，因此用截图及随后刷新确认最终文本；精确先后由代理/只读诊断时间戳共同证明。

本轮补齐首次主读取status的旧成功/旧失败原生边界。延迟Log/refs、再次打开新项目期间旧任务结束和新等待保持仍由既有四种联合回归提供精确证据；不把本轮原生两组声称为所有IPC乱序的原生重跑，也不证明自然运行一定出现此延迟。

正常关闭后7个记录的PID/创建时间身份全部退出，代理为0；首次收尾观察仍有两个WebView短暂存活，后续核对自然退出，未强杀。两个仓库HEAD、索引树、status及三个文件SHA256与基线一致，个人settings哈希保持，专用settings归档移除。`verification.json`逐项检查时序、最终界面、仓库及进程；诊断摘要首次默认GBK读取失败，改用UTF-8后验证通过，产品数据不受影响。

结合QA036已交付的打开/创建防重、等待、导航归属、Clone与Enable VCS入口，以及此前跨项目后台status两组原生证据，本轮关闭QA036。新增编号/产品修复0，完成既有验收事项1项；剩余10项为QA064、046、040、034、023、032、007、008、009、010，整体七项目标继续。用户安装版未更新，提交推送状态见统一台账。

验收证据提交`cf7e7c374ffe57b952ca2759c4ee41fd6063cc9e`首次推送成功，远程完整SHA一致。补记前再次fetch及master/交付分支检查成功，无新提交。
