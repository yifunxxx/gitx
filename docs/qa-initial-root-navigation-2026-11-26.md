# QA-036 首次读取与活动仓库切换续验

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
