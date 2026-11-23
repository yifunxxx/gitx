# QA-073 最近项目慢响应与主流程隔离

## 来源与基线

2026-11-23 续查 QA-036 等待流程。开始前成功 fetch，HEAD 与交付分支同为 `8e4576c86c71d210bcc869f78abcc3d7a388ede4`，工作区干净；包含远端 master `42df3f730be8ddd157a6aaca8d9a2b908638c950`（0.1.44）。续办时再次 fetch，无新提交。本项由主线程独立完成，未创建子代理。

QA-069 隔离了辅助读取已经返回的失败，但成功打开/创建仓库、启动 Git 检测和 Worktree 移除后的刷新仍串行等待最近项目列表。若 `workspaceRecent` 长时间未完成，共享打开控制器无法开始 Changes、Log、Branches 首次读取，必要操作已成功却仍显示等待。

后端最近列表读取当前仅等待设置锁并复制内存列表。本轮通过受控未完成 Promise 证明前端依赖问题；没有原生自然慢 IPC 的证据，不归因用户全部卡顿，也没有测量正常打开提速。

## 修改

- 打开文件夹、创建仓库应用成功结果后独立刷新最近项目，首次主读取立即继续。
- App 仍先加载设置，再启动最近列表与 Git 检测，Git 检测不再等待辅助列表。
- Worktree 移除完成后独立刷新最近项目，继续刷新工作树列表并给出完成反馈。跨仓库导航后仍可更新共享最近列表。
- 主操作继续等待必要的仓库读取，保持共享防重和导航归属保护；辅助列表晚到后更新菜单，不重复加载仓库。
- 保留 QA-069 的错误提示、旧列表和请求代次校验；store 销毁时使最近请求失效，禁止销毁后发起新读取。没有实现后端 IPC 取消。

## 自动验证

正式旧实现3文件58项中 **6失败、52通过**：folder/create/recent/clone 四入口的主读取、启动 Git 检测和 Worktree 移除后的列表刷新均未调用。日志 `E:/IDEAproject/gitx/test-results/qa073-recent-before.log`。

修复后定向 **8文件115项通过**，包括12项新增回归：上述慢响应场景、仍等待必要读取、最近列表晚到不重复刷新、A→B后旧最近列表成功/失败失效、销毁后成功/失败失效，以及设置先后顺序和卸载后的启动反馈。日志 `E:/IDEAproject/gitx/test-results/qa073-recent-targeted.log`。命令中的一个不存在测试路径没有被匹配，不计入实际8文件。

完整前端 **163文件1605项通过**，类型检查与 Vite 生产构建通过；相关6个 TypeScript 文件 Oxlint 与 `git diff --check` 通过。Vite保留既有大分块提示，构建退出码0。Windows `cargo build --offline -p gitx --features tauri/custom-protocol` 成功，未修改Rust逻辑，未重复完整Rust回归。

日志：`E:/IDEAproject/gitx/test-results/qa073-recent-full.log`、`qa073-recent-build.log`、`qa073-recent-native-build.log`。提交前再次fetch成功，master/交付分支仍为上述基线且均已包含。

## 原生与交付边界

专用程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-recent-flow-0144-20261123.exe`，SHA256 `6FCADD2D738D037C1575B572128A960DC04E04271C97336C5C24C3ED5017AF5B`。独立WebView profile，未启用trace，所有测试/构建已结束后启动。证据目录：`E:/IDEAproject/gitx/test-results/qa073-recent-native-20261123`。

原生确认：启动控制台显示Git路径及版本；Ctrl+O选择2000修改文件fixture时显示Loading与Opening project，完成后Changes计数2000、Log提交和main分支正常，任务恢复Idle；最近项目菜单已将当前fixture置首并标为当前。再次Ctrl+O正常打开选择器，点击取消后保留原仓库且最近入口恢复可用。第一次Escape输入后选择器仍在，随后重新激活并点击取消才得到确定结果；不把该Escape输入记为通过，也没有足够证据认定产品取消故障。没有删除Worktree或向原生IPC注入延迟。

正常关闭后7个观察进程身份均退出；2000文件哈希、HEAD、index树和status保持。确认设置仅增加预期最近项目后，通过排他句柄和当前字节比较恢复本轮备份，恢复SHA256为 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。5秒进程采样只用于退出身份核对，不作性能结论。用户安装版未替换。

受控慢响应只在组件/store回归中验证；普通原生打开不代表慢IPC已原生复现。QA-036交叉导航时序、持续滚轮及长期资源归因仍保留各自验收边界。

功能提交 `1ec392ddff34fd9a4dfc608cc38631594431b968` 首次推送成功，独立ls-remote核对同名交付分支完整SHA一致，master仍42df3f7。没有凭据请求；记录提交前再次fetch成功，无新提交遗漏。
