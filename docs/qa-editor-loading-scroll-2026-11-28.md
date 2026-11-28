# QA153续修：首次打开文件时保留原标签滚动位置

日期：2026-11-28。开始前读取台账、fetch并整合master和交付分支成功，基线 `9f757bc2f955a6226ab06409e1f577b38953e520` 包含master `50a4802dd23f61055668e165f6fe7c0b93b17680`；确认遗漏后再次同步无新提交，全程主线程。

## 原生发现

补验[QA153文件标签状态](qa-editor-tab-state-2026-11-28.md)时，使用当前QA156最终程序0.1.56，SHA256 `857EEC84B9425C7F96C71139E0E13687D5F53BDBA2688600587AE4782B2B34A1`。独立settings/profile、无诊断端口；新仓库有600行宽文本notes.txt和other.txt。

在notes中插入未保存的q，选择第481行并水平滚到右侧，画面显示458–481行。首次双击other，显示Loading后加载完成；返回notes时正文草稿仍在，横纵滚动均回到开头。稳定截图仍为1–24行。通过编辑器右键Undo可以撤销q，说明没有丢失撤销历史，不能把缺陷扩大为所有状态失效。

对照：other已加载后，再次从notes第481行、横向右移处切到other并返回，画面保持458–481行，原选区和横向位置可见。这解释了此前两文件均预先加载的真实浏览器补验为何通过，旧证据继续有效，但未覆盖首次加载的host移除。

首次键入q遇本机中文输入法组合，导航键被候选框消费；Enter提交原始q后重新建立选区进行测试。该过程没有登记为产品缺陷。未调用剪贴板，未出现权限提示。

## 原因与修复

FileViewer原post watcher在Vue切换`v-if="tab.loading"`后才执行release。新文件加载会移除旧host，随后`view.scrollSnapshot()`读取已脱离文档的几何信息。缓存仍有正文/选择/撤销状态，但滚动快照已失效。

增加pre watcher，在标签实例、加载代次或可编辑状态改变时先保存快照并销毁旧视图；post watcher继续等新host挂载后恢复。普通正文变化、搜索输入和临时写入保护不触发这组身份变化。隐藏标签仍只保存EditorState，关闭/导航释放与先前设计一致。

## 自动验证

- 新增真实EditorTabs加载转换回归，旧实现1失败/16既有通过：记录scrollSnapshot调用时旧DOM已断开；修后在DOM仍连接时保存，并检查返回选区和撤销正确。
- 相关4文件104项通过，含FileViewer剪贴板、读写、编辑器样式和已有缓存生命周期覆盖。
- 完整前端215文件2474项通过、4既有probe跳过，97.86秒、退出0。
- 类型、Vite及两变更文件oxfmt/oxlint通过；Vite保留既有大chunk提示。Pages检查通过。本次仅前端生命周期改动，没有重跑完整Rust工作区。

证据目录 `E:/IDEAproject/gitx/test-results/qa153-native-resume-20261128`；before.log、related.log、frontend-final.log、typecheck.log、build.log和native-build.log。Windows debug构建通过，2分23秒，退出0。

## 最终原生复验与收尾

最终程序 `final/gitx-editor-final.exe` SHA256 `E848800CBFAB7C6BBB68103E4C8FD397138D54D6A3437AF72CB83AF9C3E427BF`，identifier `app.gitx.qa153loading20261128`，无诊断端口。PID10592，创建2026-11-28 15:04:17.7619510+08:00。新独立profile/settings，使用同一个fixture。

1. notes首行输入7作为草稿，键盘到第481行并选择整行；截图纵向458–481行、水平滚到右端。首次从文件树打开other，等待真实加载完成，再返回notes：选区、双轴位置及草稿均保持。切到Workspace再返回，同一画面仍保持。
2. 右键Undo恢复首行原文且脏标记消失；Ctrl+Shift+Z恢复7及脏标记，Ctrl+Z再次恢复。没有保存测试草稿到磁盘。
3. Ctrl+H展开替换，搜索0300、替换0999并启用Match case。切到other不显示该搜索面板；返回notes后两字段、大小写选项和展开状态保持，Find Next实际定位第300行。
4. 关闭搜索、关闭干净notes后从文件树重开：回到首行、无旧搜索面板，右键Undo/Redo/Save均禁用，旧撤销/重做没有泄漏到新实例。

初次AX点击报告coordinate input geometry unavailable，重新截图并按当前坐标操作成功，不算产品缺陷。UI动作与AX/截图均为第一方CUA；没有注入DOM/store或借诊断接口改状态。截图可证明可见行与横向位置保持，不声称原生精确像素测量；新定位代次/竞态继续以原QA153自动与浏览器证据为准，不冒充本次原生测试范围。

修复前和最终程序均正常点击关闭，各8个观察进程按PID/创建时间确认退出。fixture两文件SHA256、HEAD `2d2372c23b0c2804440970593c09011dd2e5e0ab`、index `d8c7977788037ab55b21ede660b7fb44dd23437e`、空status及个人settings哈希保持；两份专用设置归档移除。更早QA153已退出现场的8个身份也确认退出，旧fixture仍保持，其设置归档移除。QA007旧PID35288身份仍匹配并保留。用户安装版未更新。

本轮补修并闭合QA153，新增稳定编号0，已知未关闭由10项回到9项，整体七项目标继续。提交前再次fetch及master/交付分支整合成功，无新提交；功能与报告独立提交推送，结果见台账。
