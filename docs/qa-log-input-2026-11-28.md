# QA151 Log键盘输入边界

日期：2026-11-28。开始前已读取统一台账，fetch并整合`origin/master`及`origin/codex/checkout-target-safety`成功。基线`f1eb4cb8bbebc33613ae7449307780cb7f56d239`包含master`50a4802dd23f61055668e165f6fe7c0b93b17680`（0.1.56），工作区干净，全程主线程。

## 发现与修复

来源为Log筛选、修订定位及提交行键盘处理的代码审阅。四个筛选框原来直接以Enter应用草稿，定位框仅检查isComposing，提交行没有排除已消费及keyCode229事件。

- 筛选框的候选确认、已消费事件、长按和附带修饰键的Enter会发布草稿并发起查询；四种字段都在真实LogView/Pinia链上复现。现共用Enter入口，拒绝这些事件，普通Enter仍可应用四个草稿并发起新的查询，Apply/日期/重试入口保持可用。
- 定位框的229、已消费、重复或修饰Enter仍会调用logLocate；现使用同一保护。已有isComposing行为保持，正常定位及筛选外目标处理继续通过。
- 提交行的229/已消费Enter仍打开差异，ArrowDown仍改变选择并读取详情；现在导航入口提前返回。正常Enter、方向导航和Shift范围选择保持。

这是输入事件边界修复，没有新增定时器、命令或可配置快捷键，不涉及Git写入。中英文History教程补齐普通Enter、候选确认和连续导航的操作说明。物理IME和精确长按证据不与合成事件混用。

## 自动验证

证据目录：`E:/IDEAproject/gitx/test-results/qa151-log-input-20261128`。

- 新增12项。首次运行发现正常对照误写字段author，改为实际authors数组后重跑旧产品：9失败、3正常/既有保护对照通过，已有46项通过，见`before-tests.log`；该测试笔误不计产品缺陷。
- 修后在正常提交对照中追加按住Enter的重复事件及后续新查询，相关4文件77项通过，含LogTreeNavigation的显示顺序和Shift范围选择，见`related-tests.log`。命令中另有一个不存在的LogLocateFeedback文件名未匹配，实际计数仅上述4文件，没有将其计入测试范围。
- 完整前端213文件2416通过、4既有probe跳过，86.92秒、退出0，见`full-tests.log`。
- 类型检查及Vite构建通过，既有大chunk提示保留，见`build.log`。相关oxlint/oxfmt、双语Pages命令/设置/链接检查及diff检查通过；没有Rust产品改动，不重复完整Rust工作区。

## 原生验证与交付

Windows debug构建通过，耗时2分35秒，见`native-build.log`。最终程序`gitx-qa151.exe` SHA256 `82049AE5E0B8E3D25E36591E1672C8CC62163A6986625C22702EBB613BC4B0BE`；专用identifier `app.gitx.qa151loginput20261128`，独立profile/settings，无调试端口。根PID24252，创建于2026-11-28 12:17:34.2862190+08:00。

最终浅色英文原生界面完成：

- 提交说明筛选框输入“中文”，实际聚焦后Shift+Enter保持全部三个提交且无筛选chip；随后普通Enter显示Text: 中文，仅剩“修复中文输入”及对应详情。
- Clear恢复三个提交，定位框输入start并聚焦。Shift+Enter保持当前中文提交，普通Enter选中start标签的初始提交，详情SHA为`5fa2e2a600993cdc51680273651bb23bf92a884e`。
- 聚焦初始提交行，Up选择中文提交；Enter打开`5fa2e2a…d6a70b6`比较，实际差异为notes.txt增加`Chinese filter target`。随后Shift+Up选中中文和最新提交两行，详情转到最新提交。

最初setValue只写入值，没有建立可靠的字段键盘焦点；其后两次无结果按键不计验收。一次元素点击报`coordinate input geometry is unavailable`，重新绑定窗口/截图并点击字段后恢复。AX焦点仅报告Web文档，且部分动作后的树有延迟，使用截图和后续实际键盘结果核对；以上工具限制不登记为产品缺陷。

关闭窗口后界面读取报告无前台PID，按PID/路径/精确创建时间核对已观察到的10个进程全部自然退出（含启动期临时进程，`native-identities.json`/`native-exit.json`）。fixture HEAD `c01b19d44abcf993fb0c956298406332322c18d3`、index `c4ca8c410a0b85e2aa070a6111a0c48d904cf889`、空status及notes.txt字节哈希保持，个人settings SHA256仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，见`native-verified.json`。专用settings归档后移除，旧QA007的PID35288、fixture及权限现场保持。

原生物理输入法候选、精确长按与已消费事件保留在QA009/010验收边界；当前Windows工具不支持pressKey的durationMs，不用连续单次按键冒充自动重复事件。中文setValue也不等于物理IME。自动回归已覆盖上述事件边界。

本轮新增并解决QA151一项，回到原9项已知未关闭事项；整体七项目标继续，用户安装版未更新。提交前再次fetch及master/交付分支整合成功，无新提交。功能`ec9cf82778aab699d629a9382b1f1995f930f749`首次推送成功，ls-remote完整SHA与本地一致，无凭据提示；交付补记前再次同步无新提交。
