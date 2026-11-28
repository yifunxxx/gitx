# QA-125：文件撤销恢复后的换行与草稿标记

日期：2026-11-27。来源为 QA-122 原生验收：带 BOM 的混合换行文件（6个 LF、1个 CRLF）执行替换后撤销，文字恢复，但标题仍提示未保存。受控回归另覆盖全 CRLF 文件。

后续状态：[QA128普通文件换行保留](qa-file-line-endings-2026-11-27.md)已替代本项的基线回填特例，补齐下文当时保留的正常编辑保存边界；原始分隔符随编辑及撤销保留，混合换行和53万行CRLF文件已有原生保存后磁盘字节证据。本报告保留QA125当时的实现及验证范围。

## 复现与修改

CodeMirror 将 CRLF、LF 和单独 CR 换行表示为同一种文档分隔符；`doc.toString()` 输出 LF。原实现直接把该输出交给文件 store，与磁盘原始 `baseline` 比较，因此撤销后的内容仍与 CRLF 或混合换行基线不同。

修改仅限 `FileViewer.vue`：缓存当前保存基线及其 CodeMirror 等价正文，每次文档变化时，若正文已完全恢复到当前保存基线，则把原始基线交回 store。这样同时恢复原始 BOM 和各处换行，准确清除未保存标记；成功保存改变基线后，比较缓存也随之更新。store 的原始文本与保存规则保持不变。

这不是任意编辑的换行保留框架。本次只修复恢复到保存正文时的误脏状态；正文仍有修改时，既有 `doc.toString()` 序列化仍可能将 CRLF/混合换行写成 LF，该限制未在本项关闭。没有对整份文件统一替换换行，也没有引入新的撤销历史模型。

## 验证

- 真实 `FileViewer`、CodeMirror 和 fileViewer store 下新增三项：BOM + CRLF 撤销/重做、混合 CRLF/LF/CR 撤销/重做、保存后针对最新基线撤销。
- 修复前 24 项中 2 项失败、22 项通过，两个失败精确显示恢复正文被转换为 LF；日志：`test-results/qa125-before.log`。
- 修复后 24 项全部通过；断言撤销后的文本严格等于原始基线、dirty 清除、保存无需调用后端、重做仍为修改状态；日志：`test-results/qa125-after.log`。
- 修改文件的 Oxfmt 与 Oxlint 通过。
- 首次完整前端回归出现 4 项失败和 1 个未处理异常，均源于 `editorStyles.test.ts` 模拟 tab 缺少真实 store 必填的 `baseline`，首项挂载失败后引发后续卸载连锁。真实 store 在创建、读取成功/失败及保存路径均设置该字段；只补齐测试 fixture 和模拟重载基线，未让产品兼容不完整 mock。相关 FileViewer + editorStyles 33/33 通过，日志：`test-results/qa125-editor-final.log`。
- 最终完整前端复跑 201 个文件全部通过，2101 项通过、4 项既有 probe 跳过，退出码 0；日志：`test-results/qa125-frontend-rerun.log`。

本报告记录受控组件及完整前端验证；最终构建、原生复查和提交推送状态由统一台账记录。此项未更新用户安装版。

## 最终构建和原生复查

类型检查、Vite 和 Windows debug 构建通过。独立 `app.gitx.qa125` 程序加载与 QA122 相同的 BOM/混合换行 fixture，Ctrl+H 后将两处 gitx 全部替换为 demo，标题正确显示未保存；Escape 归焦、Ctrl+Z 后文字恢复，未保存文字与标签圆点均清除。截图 `test-results/qa125-native/undo-clean.png`。退出测试进程后磁盘哈希、fixture HEAD/status 和个人 settings 均保持，证据为同目录 `binary.json`、`after-hashes.json`。本次原生仅覆盖上述恢复流程，其他换行组合由组件回归覆盖；用户安装版未更新。
