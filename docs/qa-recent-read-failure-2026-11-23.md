# QA-069 最近项目读取失败与仓库打开隔离

## 来源与同步基线

2026-11-23 续查 QA-036 打开/切换项目流程。开始前成功 fetch，工作区干净，HEAD 与交付分支均为 `9e6b6b8042d0e2aa11819c79ac9779e9547ea7f3`；远端 `master` 为 `42df3f730be8ddd157a6aaca8d9a2b908638c950`（0.1.44），已核验是 HEAD 的祖先。主智能体独立完成，没有创建子智能体。

`workspaceStore.openFolder/initRepo` 已调用 `applyOpenRes` 切换仓库后，继续等待 `loadRecent`。如果 `workspaceRecent` 拒绝，共享打开控制器会在 `opened = true` 之前进入失败分支，跳过布局展开及首次 Changes、Log、Branches 读取。启动的 `App.vue` 也串行等待 `loadRecent`，同一错误会使后续 Git 检测无法执行。

这是有条件的错误传播缺陷。真实 Rust `workspace_recent` 当前只等待设置读锁并克隆内存列表；本轮以受控后端拒绝复现前端错误路径，没有证据证明用户遇到过该 IPC 故障，也不把它描述为磁盘权限或设置文件损坏问题。

## 修改

- 最近项目刷新独立处理失败，中英文提示为“无法刷新最近项目列表”，保留最后一次成功的列表。
- 辅助读取失败不再向成功打开/创建仓库、启动初始化或 Worktree 删除流程传播。
- 仍按最近列表请求代次丢弃过期成功响应；补充同样丢弃过期失败，避免新列表已成功后弹出旧错误。
- Worktree 删除完成后使用同一反馈路径，删除其只在控制台输出异常的重复捕获。
- 仓库打开、初始化本身的错误仍走原来的失败/重试流程；正常初始加载与共享等待行为保持。

## 验证

正式旧实现新增4项回归均失败，其余24项通过：打开文件夹/创建仓库两条路径的首次读取均未调用，直接最近项目读取失败向上传播，过期失败同样向上传播。日志：`E:/IDEAproject/gitx/test-results/qa069-recent-before.log`。

修复后首轮定向8文件/111项通过，覆盖共享打开、Clone、Welcome、Commit启用Git、工作区请求代次、Worktree、仓库生命周期与双语键一致性。随后增加一项 Worktree 删除成功但最近列表读取失败的回归，确认删除只执行一次、工作树列表刷新、成功反馈仍成立，最近项目单独提示且不清空旧值。

最终完整前端 **158文件/1579项通过**；类型检查与 Vite 生产构建通过，相关5个 TypeScript 文件 Oxlint 通过，`git diff --check` 通过。Vite 仍有既有的大于500kB分块提示，构建成功，不将其写成新增故障。

Windows 原生 `cargo build --offline -p gitx --features tauri/custom-protocol` 成功，退出码0；构建使用 `E:/IDEAproject/gitx/test-results/isolated-target`，没有替换安装版。未修改Rust逻辑，本轮没有额外重复整套Rust测试。

日志分别为 `E:/IDEAproject/gitx/test-results/qa069-recent-targeted.log`、`qa069-recent-full.log`、`qa069-recent-build.log`、`qa069-recent-native-build.log`。提交前再次 fetch 成功，master/交付分支均无新提交且已包含于 HEAD。

功能提交 `4b678040265a0ea4a853c06978e67a0598d31302` 首次推送成功，独立 `ls-remote` 核对 `codex/checkout-target-safety` 完整 SHA 一致，master仍为42df3f7。无凭据提示。交付记录提交前再次fetch成功，两条远端均已包含，无需额外合并。

## 验收边界

本轮没有在原生程序注入 IPC 故障，没有把组件/store回归描述为原生故障复现，也没有更改测试仓库、用户应用设置或安装版。慢响应和永久不返回不在此次修复范围；本项处理已经返回的失败，不声称缩短正常打开耗时或解决滚动性能。QA-036 原生交叉导航时序与总体七项目标仍继续验收。
