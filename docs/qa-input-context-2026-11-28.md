# QA149 普通输入控件的右键编辑菜单

日期：2026-11-28。开始前读取台账、fetch及master/交付分支整合成功，干净基线`fe42936f4cbb18a6573fd75dead1624cf74bbbd7`包含master`50a4802dd23f61055668e165f6fe7c0b93b17680`。全程主线程。

## 发现与修复

来源为右键事件路由审阅。CustomContextMenuHost无条件阻止原生contextmenu，且提交说明textarea位于changes容器内，右键文本会打开文件Git操作菜单；容器外的文本输入也没有原生编辑菜单。另有已被组件preventDefault的事件可能再次触发全局回退菜单。真实宿主与DOM事件回归确认。

现在优先尊重已处理事件；普通文本输入、textarea（含只读）及contenteditable内部保留系统的复制、粘贴、撤销等编辑菜单。contenteditable按有效属性向上查找，明确false终止继承，支持空值、true和plaintext-only。非文本输入（复选框、按钮等）和产品空白区域仍使用原Git菜单/页面菜单抑制规则。文件编辑器和终端已经消费的自定义菜单不被接管。

本项没有新增自定义快捷键，也没有通过JavaScript读取剪贴板或改写输入框内容；编辑禁用态与撤销栈交给原生控件处理。

## 自动验证

证据目录：`E:/IDEAproject/gitx/test-results/qa149-input-context-20261128`。

- 新增12项，旧实现9失败、3非文本正常对照通过，既有4项通过（`before.log`）。
- 修后相关4文件64项通过（`targeted.log`），包括宿主路由、菜单键盘/焦点、Changes来源隔离及位置计算。
- 完整前端213文件2384项通过、4项既有probe跳过，84.28秒、退出0（`full.log`）。类型/Vite构建通过，32.30秒（`build.log`），既有chunk警告保留。
- 相关oxlint/oxfmt、diff及双语Pages命令/设置/链接检查通过。本项没有Rust产品改动，不重复完整Rust工作区。

Windows debug构建通过，2分28秒（`native-build.log`），最终`gitx-qa149.exe` SHA256 `BADD3900E5B20D33E3E64048C675BE571FB16896F0C3D0DFB7FD07DB3A5C38C4`。专用identifier `app.gitx.qa149inputcontext20261128`、独立profile/settings，没有诊断端口。

## Windows原生验收

0.1.56最终程序根PID33568，创建时间2026-11-28 11:36:56.5357770+08:00。独立Git仓库一个修改文件，英文浅色界面；测试只编辑提交说明和查询输入，没有提交、暂存或修改仓库文件。

首次元素点击报`coordinate input geometry is unavailable`；重新选择同窗口并获取截图后坐标和元素输入均可使用。AX焦点持续报告Web文档，未据此盲打文字；通过可设置的Commit message元素填入已知测试文本，AX值和截图均确认。系统右键菜单随之显示，未出现Changes Git动作。

- 原生菜单“全选”选中完整测试字符串，截图和AX selected text一致。
- 选中文字后右键“剪切”清空输入，再打开右键“撤销”恢复同一字符串；提交按钮随文本更新，不执行提交。
- Log的Search commit messages输入右键显示原生编辑菜单，点击“粘贴”后值与已知测试字符串一致。此处使用原生菜单粘贴，没有操作WebView剪贴板权限提示，不代表QA007终端异步剪贴板已验收。
- marker.txt文件行右键仍显示文件Git菜单（Show Diff/History、Commit Files、Rollback、Stash等），没有被文本菜单规则接管；Escape正常关闭。
- 两个测试输入均清空并经AX值确认，再点击应用关闭按钮退出。观察到的8个进程身份按PID、路径和精确创建时间核对全部退出；专用settings归档后移除，cua会话重置。

上述普通原生输入/菜单通过；密码、只读和contenteditable种类及组件preventDefault边界以自动回归为证，未逐项原生重跑。系统原生菜单使用系统语言，此机为中文，不属于GitX翻译缺失；菜单包含WebView自带的附加条目，本项没有修改它们。

## 现场与交付

测试仓库HEAD `45b30c982661b0129fbdb9570b8b105dcd4f3b17`、index `f504ef07b512c06ef7b023584d085dc50b9a2c97`、status及marker字节哈希与初始一致。个人settings SHA256仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`；旧QA007仓库和权限现场保持，用户安装版未更新。测试剪切写入系统剪贴板的是已知QA文本，未读取或记录原有剪贴板内容。

提交前再次fetch及master/交付分支检查成功，无新提交。新增并完成QA149一项，回到原9项已知未关闭事项，整体七项目标继续；独立提交推送随后核对。
