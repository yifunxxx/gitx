# QA052–055 原生验收与交付

2026-11-20 在包含 master efc2a8afe17af6f4c937c8c95c8f7e58dc834b0a 的2519c34c137f70c72322840cb02bfb3e17182171上验证。功能分别为QA052目录勾选6c36509、QA053位置菜单073556c、QA054选择器树形2519c34；QA055生成绑定契约c774bd4也已独立提交。推送成功并用ls-remote核对最终完整SHA一致。

阶段完整前端153文件/1459项通过，后续两处测试类型及空分区保护修正后定向46项、类型/Vite和Windows custom-protocol构建通过。早期定向数量仅为各自阶段证据，没有重复算成新覆盖。日志位于E:/IDEAproject/gitx/test-results/qa052-054-*及qa054-final-targeted-20261120.log。

专用程序gitx-tree-actions-0142-20261120.exe，SHA256 A9CE17990FB8DCF59FEF4A80819A94D054497295F4CBFBE3F6D286621E56E47D，原PID24600。证据目录E:/IDEAproject/gitx/test-results/qa052-054-native-20261120保存binary.json、process.json、终端和资源管理器观察文本及cleanup.json。

原生操作结果：

- Commit目录src勾选后仅其三个后代全选；取消b.txt后src及nested半选，docs保持未选。
- nested右键目录菜单只含位置、路径及刷新操作。打开内置终端显示src/nested实际提示符；docs/readme.txt打开第二会话显示docs，原会话保留。未在终端输入命令。
- src右键资源管理器打开正确目录，显示nested及a.txt，专用Explorer窗口已关闭，用户已有Explorer未动。
- Shift范围选择b/c，经Commit Files打开列表2/2，切树显示src/nested。取消b后1/2且目录半选，切回列表仍只选c；确认后左侧只勾c且提交说明聚焦，没有创建提交。
- Stash窗口使用同一树形选择器，四个候选按目录呈现，取消正常。移动/回退/Shelf的操作兼容与导航竞态来自自动回归，未逐一原生执行。

最后一条提交行为是2519c34的阶段设计；用户随后明确要求在同窗填写说明并实际提交，并要求紧凑行与右置状态。这些新增要求登记QA057，不能用本报告当作QA057最终验收。QA056仅在选择器保留同名删除文件，共享树其他调用方继续核查。

清理：fixture tree-actions-20261120五文件SHA256与测试前一致，HEAD仍993b4c7c3cc144053c6f983c1373685b7cd273e2，status一致、暂存区无变化。原程序及其WebView/终端shell等12个观测进程身份全部退出。设置仅recentWorkspaces发生测试变化，经检查恢复精确备份，SHA256为6DD5D73EAD1F19D1860AE9B143659A0753756E82DFF7B5F5FCCB588693F05335。

本轮只读安装版D:/gitx/gitx.exe为0.1.41，没有替换。本报告关闭QA052–055的本项交付，不代表总体七项目标完成，不宣称所有主题、缩放、暂存模式竞态和长期性能已原生验证。
