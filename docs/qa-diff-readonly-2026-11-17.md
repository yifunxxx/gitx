# QA-027 差异视图只读

## 需求和修改

用户要求显示差异只能阅读，“打开文件”和解决冲突结果可以编辑。基线先合并远程主分支 `0c28962`（0.1.37），同步提交 `74432e2`。已有 Diff 禁止 DOM 输入，但缺少编辑器状态的只读约束；没有观察到通过 Diff 写入磁盘。

统一 `CodeMirrorDiff` 加入状态只读、无障碍只读标记和内容事务过滤。左右/统一、折叠/展开和分支比较共用该组件；内容刷新通过新快照替换。选区和滚动事务保留。没有改动暂存/回退选中行，也没有改变文件编辑和冲突结果编辑权限。

## 验证

- 新增左右/统一三个回归，修改前均因状态不只读失败；修改后编辑命令、输入/粘贴/剪切/拖放来源事务、普通内容事务被拒绝，选择与刷新正常。事务测试不是原生剪贴板实测。
- 相关 8 文件 / 65 项通过，含阅读位置、展开、大比较、部分暂存、标签隔离、普通文件保存、冲突箭头/X 与手动结果。
- 完整前端 127 文件 / 1068 项通过；类型检查与生产构建、相关 Oxlint、diff 检查通过。构建首轮发现新测试 fixture 漏填 `index`，补齐后通过。
- Windows 原生构建成功。测试程序 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-readonly-0137-20261117.exe` 的 SHA256 为 `1B6D7E4D22932E04846EDE2D5843A23BC76CA7CA95AE437DB4A2AE8F1AB7A679`。
- 原生程序可启动，进入 Welcome / 文件夹选择器；电脑操作工具随后连续出现缓存窗口元素不可用及 `call get_window_state before using this window`，刷新重试后仍失败。未完成差异/文件/合并原生交互验收，不将自动测试写作 GUI 实测。已结束本轮专用测试进程。
- 用户设置备份 `test-results/readonly-settings-before-20261117.json`；界面测试前后设置哈希核对。测试仓库 `test-results/repos/readonly-edit-20261117`，仅测试数据；集成目录独立代码和 `D:/gitx/gitx.exe` 未替换。

日志均位于 `E:/IDEAproject/gitx/test-results/`：`diff-readonly-0137-vitest.log`、`diff-readonly-0137-build.log`、`diff-readonly-0137-native.log`。

## 交付与后续

源码和自动验证完成，本功能 `ad75066` 已独立提交推送并核对远端。原生交互复查列入 QA-009，用户安装版尚未更新。随后 QA-028 保存期间草稿/历史和 QA-029 剪贴板来源保护也已独立修复推送；最终构建和程序 SHA256 见统一台账。
