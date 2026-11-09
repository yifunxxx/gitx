# 重命名状态与 Diff 原路径

日期：2026-11-09。

## 问题与修改

仅重命名、内容不变的暂存文件原先被显示为整文件新增。问题有两层：
porcelain v2 的 `-z` 输出将原路径放在下一段 NUL 字段中，状态解析器漏读；
Diff 入口又使用目的路径读取 HEAD，得到了不存在的文件。

状态解析现在消费完整的双路径记录，保留路径中的空格、制表符与换行，
不会将类似状态行的原文件名误解析为另一个文件。暂存的重命名/复制比较使用
原路径的 HEAD 与目的路径的 index；混合状态的未暂存比较仍使用目的路径。
比较标签保留原路径，展开全文、切换空白选项和后续刷新不会丢失。
标题显示原路径到新路径；不同源路径的本地比较使用不同缓存标识。

## 验证

- 前端新增/既有入口及 store 回归：独立工作区 42 项通过；集成工作区全量
  49 文件、301 项通过。两处类型检查/生产构建通过，针对本次文件的 oxlint 通过。
  主 JavaScript chunk 体积提示仍保留。
- 桌面复验揭示前端模拟数据测试未覆盖后端原路径丢失，随后补充两个 Rust 回归：
  修复前均失败，修复后均通过。覆盖真实 Git 的中文空格文件名重命名及 HEAD/index
  blob 一致性，也覆盖复制、含制表符/换行的路径及伪状态行原路径。
  两工作区加既有 status→stage→commit 流程，共 3 项均通过。
- 集成工作区本次 Rust lib/测试的严格 Clippy 通过。独立工作区普通 Clippy 通过，
  保留 gitx-testkit 的既有可派生 Default 建议；严格模式会被此既有告警阻止。
- 重新构建调试程序后，纯重命名实际显示 `rename-old.txt → renamed.txt` 和“无差异”。
  在专用 fixture 中新增并暂存一行后，两边保留 `rename me`，仅右侧 `ok` 高亮为新增；
  点击“展开未更改”后仍正确。
- 两个 GUI 场景分别按其测试前基线核对 HEAD、refs、index、status 和文件哈希，
  5 项均保持。新增一行是测试准备步骤，与只读 GUI 操作区分记录。
- 旧调试程序正常关闭后，按 PID 与创建时间记录的 8 个进程均已退出。

本机证据位于集成工作区 test-results：rename-status-before.log、
rename-status-after.log、rename-status-isolated.log、rename-diff-isolated.log、
frontend-rename-diff-all.log、build-debug-rename-diff.log、rename-diff-pure-after-ui.txt、
rename-diff-edited-after-ui.txt、rename-diff-expanded-after-ui.txt、
rename-diff-pure-gui-verified.json、rename-diff-edited-gui-verified.json、
rename-old-process-exit.json。
