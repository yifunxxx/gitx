# QA116 文件编辑正文读取

日期：2026-11-26；全程主线程。开始前 fetch 及 master/交付分支检查成功，干净基线 `dfb3be2ecb0c58d992322a60a5094bf0a729f91a` 包含 master `fdc51568d102e731aeaafb3fa62b9f7a28dff12c`。发现来源为 File 操作与编辑器生命周期续查。

## 已确认问题

Commit 的“打开文件”调用 `fileViewer.open(path)`，旧实现只有 File 树/搜索等带 source 的入口严格读取文件，Commit 入口从 `diffFile.rightText` 取正文。后端 Diff 对二进制或超过 5 MiB 的内容返回 null，其他内容允许有损 UTF-8 解码，前端却将 null 转为空字符串且允许编辑。已删除文件也可能被当成可编辑空文件。

这可能导致用户在空白或有损文本上编辑并保存，覆盖原内容；本轮未在用户文件上尝试覆盖。另确认可选 HEAD 差异读取失败会让已成功读取的普通文件正文也不可编辑。

## 修改

- 所有编辑入口统一通过 `fsReadFile` 严格读取完整磁盘正文；二进制、无效 UTF-8、缺失/不可读文件显示既有只读错误视图，并拒绝编辑与保存。
- 大文件仍可完整打开和保存，跳过额外 HEAD 行标记计算。有效空文件保持可编辑，不把“缺失正文”当成空文件。
- HEAD 差异仅提供可选行标记；请求失败、旧 HEAD 为二进制/超大内容或正文快照不匹配时省略标记，不用差异正文覆盖编辑内容。
- 保留路径映射、草稿复用、撤销和跨导航响应隔离；中英文 Pages 的文件指南补充一致读取规则。本项是既有入口修复，无新增快捷键。

## 自动验证

证据目录：`E:/IDEAproject/gitx/test-results/qa116-file-open-20261126`。

- `before.log`：真实 fileViewer store 新增首批 7 项全部失败、原 11 项通过，确认大文件变空、二进制/无效编码/缺失文件可编辑、差异正文替代磁盘正文、两入口可选 HEAD 失败阻断正文。
- 最终新增 13 项，含真实 CodeMirror 只读状态、完整大文本保存、BOM/CRLF/中文、HEAD 省略正文、匹配/失配行标记、切仓/重开时旧行标记失效。
- `targeted-final.log`：文件 store/组件、文件操作及 Commit 菜单相关 100 项通过，1 项既有性能 probe 默认跳过。
- `full-tests.log`：完整前端 201 文件、2085 项通过，4 项既有 probe 默认跳过，退出 0。
- `build.log`：类型检查与 Vite 生产构建通过；仅保留既有 chunk 与动态导入提示。三个变更源码文件 oxlint、`git diff --check`、中英文 Pages 检查通过。
- 既有编辑器测试改为从文件读取桩提供正文，保留异步加载、错误、关闭重开、保存中草稿、撤销/选择、剪贴板竞态的原断言。后端代码未改，不声称重跑了完整 Rust 套件。

## 原生验证与交付

`native-build.log`：Windows debug/no-bundle 构建通过，独立标识 `app.gitx.qa116`、独立 WebView profile，无调试端口。实际测试程序 SHA256 为 `2741fc0e43dcbad8b614539932d66dfdfab1b4a6b4e743c947fb4766c1dc0cd3`，见 `target.json`。用户安装版未更新。

原生 Commit 文件行右键“打开文件”验证：

1. `binary.dat` 显示“binary files cannot be edited as text”，没有替换按钮。聚焦正文、输入 x、Ctrl+S 后没有产生编辑；编辑器菜单的撤销/重做/粘贴/保存禁用。磁盘哈希保持。
2. `legacy.txt` 含无效 UTF-8 字节，显示只读“file is not valid UTF-8 text”，磁盘哈希保持。
3. `large.txt` 原 5,830,019 字节，打开后显示真实正文，Ctrl+End 到达第 530003 行。追加 `qa116 appended` 并 Ctrl+S，任务队列显示正在保存，随后恢复空闲且未保存标记消失。实际磁盘 5,830,033 字节，逐字节核对完整原前缀和新增尾部一致，见 `large-saved.json`。
4. 大文件 Ctrl+Z 并 Ctrl+S 后恢复原字节。`normal.txt` 普通正文及新增行标记正常。

程序正常关闭，7 个测试程序/WebView 进程身份全部退出。四个文件哈希、HEAD/status 与 `baseline.json` 完全一致；独立设置归档移除，个人 settings SHA256 保持 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，见 `verification.json`、`exit-verification.json`。截图和可访问性观察保存在聊天工具记录中。

提交前再次 fetch 及 master/交付分支检查成功、无新远端提交。新增并解决 QA116 一项；回到原 11 项已知未关闭，七项目标继续。读取/行标记的精确并发边界以受控测试为证，不冒充自然慢磁盘或持续快滚测量。提交/推送完整身份见统一台账。
