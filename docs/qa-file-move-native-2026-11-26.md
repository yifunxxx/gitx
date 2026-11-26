# File 移动、草稿与原生拖放补验

日期：2026-11-26；全程主线程。开始及提交准备前均 fetch 成功并检查 master/交付分支，基线 `80b0de04797c5cf64224c389e2e9481dfe73aa85` 已包含 master `fdc51568d102e731aeaafb3fa62b9f7a28dff12c`，没有新的远端代码。本轮没有产品修改或新增缺陷编号。

## 实际程序及隔离现场

复用 [QA114](qa-log-tree-navigation-2026-11-26.md) 已构建的 0.1.49 程序，未重新构建，也未重跑无相关改动的完整套件。程序 SHA256 为 `ee663d8f81655dbef7886502073e265db24cd7391f2d2021500c39f040727f38`。

证据目录：`E:/IDEAproject/gitx/test-results/qa-native-file-drag-20261126`。专用仓库包含 `source/one.txt`、`source/two.txt`、`target/keep.txt`，其中 one.txt 已跟踪且有磁盘修改；仅一条基线提交。使用独立 WebView profile 和 `app.gitx.qa114` 设置，未开启调试端口或注入拖放事件。

## 原生结果

1. 第一方原生窗口控制可以切换 File、展开 source，并读取文件树。一次元素点击报告坐标几何不可用，获取截图后坐标点击成功；没有将工具错误登记为产品缺陷。
2. 从 `source/one.txt` 行拖到 `target` 行后，没有出现移动确认框，文件树仍显示原路径。当前工具只提供起止点拖动，没有分段路径接口。本轮没有采集 DOM 事件，因此不声称已确认它缺少某个事件，也不把现象归因为产品或工具的确定根因。
3. 随后通过文件右键菜单打开 one.txt，在编辑器加入未保存的 `draft after move`，再通过右键“移动到…”输入 `target/one.txt` 并确定。源树中 one.txt 消失，标签仍为同一文件，编辑器路径更新为 target/one.txt，未保存文本保留。
4. 保存前磁盘目标只含原有 `modified one`，草稿没有被移动操作意外落盘。原生 Ctrl+Z 撤销草稿、Ctrl+Shift+Z 恢复，证明此次移动保留编辑撤销记录。
5. Ctrl+S 后未保存标记消失，磁盘目标内容为 `modified one\ndraft after move`；源路径不存在。Commit 面板显示旧路径删除、新路径未版本控制，与真实 `git status --porcelain` 一致。最终后台队列为空闲。

磁盘结果见 `after-move-save.json`、`moved-saved-one.txt`；原生界面观察保留在本聊天工具记录中。其他两个文件的字节哈希与 HEAD 均未变化。

## 结束与验证边界

- 正常关闭测试程序，7 个观察到的程序/WebView 进程身份均退出，见 `processes-before-exit.json`、`exit-verification.json`。
- 保存移动结果证据后，仅恢复专用 fixture 的文件路径及内容；最终 HEAD、status、三个文件哈希与 `baseline.json` 完全一致，见 `verification.json`、`verify_restore.py`。
- 独立设置归档为 `settings-final.json` 并移除。个人 settings SHA256 仍为 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`；用户安装版未更新。
- 已补齐本组右键移动、未保存草稿、撤销/重做、保存目标和 Commit 刷新原生证据。原生拖放端到端依然未验收；[此前浏览器多步拖放](qa-file-enhancements-2026-11-25.md)证据不替代本项。后续需要能够产生完整拖放输入的工具或人工复现，不重复同一无效果输入。

本轮新增缺陷 0、修复代码 0；补齐一组实际功能组合证据。原 11 项已知未关闭事项和整体七项目标继续，记录提交/推送状态见统一台账。
