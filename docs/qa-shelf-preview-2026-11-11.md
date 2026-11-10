# Shelf 补丁预览（QA-005）

日期：2026-11-11。独立分支 `codex/checkout-target-safety`；相关改动同步至 `E:/IDEAproject/gitx`，保留集成目录独立修改。

## 修改

- Shelf 增加“预览差异”：工具栏、右键菜单、双击和普通 F4 均可打开；最近删除条目同样支持预览，不需要先恢复。
- 读取保存的补丁快照，不重新计算当前工作区 Diff。元数据与补丁在同一锁下读取，支持部分应用后的 `patchFile` 当前代次；已删除条目只读，不触发恢复。
- 预览为只读统一补丁窗口，保留路径/重命名/模式信息、上下文和二进制补丁记录。按 hunk 行数区分增删内容与 `---` / `+++` 文件头，避免把二进制数据或邮件尾部当作删除行。
- CodeMirror 限制实际渲染行数；高亮只在文档装载时计算，选择和滚动沿用既有结果；卸载回收编辑器及 ResizeObserver。背景、行号栏与高亮使用主题颜色。
- 后端最多读取 2 MiB + 1 字节，超过限制明确显示截断提示，优先保留完整行/UTF-8 字符；非 UTF-8 原文以替代字符显示并说明，保存的原始字节不变。
- 弹窗固定原仓库、导航会话和 Shelf ID；异步挂载前导航不再发请求，关闭/卸载/仓库切换后的响应被丢弃。读取失败可重试，加载中不重复请求，重复打开不会叠加窗口。

## 自动验证

- 两处前端定向分别 **108 / 109 项通过**，覆盖 Shelf 现有操作、入口、目标稳定性、重复打开、删除状态、加载/失败/重试、导航与关闭保护、空补丁、截断/编码提示及 50,000 行文档的有界渲染。
- 两处相关真实 Git 回归均 **24 项通过**：新增 preview 4 项、export 9 项、partial unshelve 11 项。新增用例覆盖保存内容与后续本地内容隔离、中文重命名和二进制补丁、当前代次、已删除读取、无副作用、大补丁上限/完整行/UTF-8 边界、非 UTF-8、空补丁、非法/缺失/损坏条目和取消。
- 集成目录另跑 Shelf storage/consumption **14 项通过**，`cargo check -p gitx --locked` 通过；两处测试有重叠，不相加。
- 两处前端生产构建（含类型检查）、独立分支最终原生构建通过。显式导出 Rust bindings 至忽略的测试文件，核对新增请求/返回字段与调用名；保留两个目录原有绑定封装，不整份替换。
- 改动文件 Oxlint 无错误，保留 `mock.ts:893` 既有 `no-useless-spread` 警告；生产构建既有分包大小/混合导入警告未改变。相关 Rust 文件格式及 `git diff --check` 通过。

日志位于 `E:/IDEAproject/gitx/test-results/shelf-preview-*`。首轮前端有两处测试在 mounted 后尚未等待 Vue 更新便断言 loading；补足等待后通过，无产品逻辑修正。系统默认 Node 20 不满足项目工具要求，后续使用既有 `env.ps1` 的项目运行时。

## 原生验证

程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-shelf-preview-20261111.exe`。

SHA256：`FB13170F51BBCED881869D74D0DCA0992DC1EB4F1B90AF2CBBC45F1F83EED8C1`。

隔离仓库：`E:/IDEAproject/gitx/test-results/repos/shelf-preview-gui-20261111`。

- 双击 `QA saved diff` 打开预览，显示 `Original shelf text` → `Saved shelf text`，未显示后来写入的 `Later local text`；中文重命名旧[名].txt → 新 文件.txt 和二进制记录完整可见。深色行号栏与阅读区一致，新增/删除着色正确。
- Escape 关闭后直接按 F4 再次打开同一 Shelf；关闭按钮也正常。
- 展开“最近删除”，从 `QA deleted remaining diff` 右键菜单进入预览，显示 `Deleted remaining text` 当前代次，未误读旧的原始备份；没有恢复或应用条目。
- 浅色主题通过工具栏打开 `QA large diff`，阅读区有新增着色；Ctrl+End 到 `Saved line 50000`，Ctrl+Home 回到补丁头，滚轮正常移动内容。
- 测试后恢复原深色主题和面板布局、关闭测试程序。HEAD、引用、状态、索引原始哈希、工作区文件和全部 Shelf 元数据/补丁哈希与开始时一致。

证据：`shelf-preview-gui-{before,after,ids}.json`。辅助脚本位于独立分支忽略的 `test-results/shelf-preview-gui.mjs`；`create` 不覆盖既有目录，`verify` 校验快照。

## 边界与交付

本次提供整份已保存补丁的只读统一视图；不进行三方重建或逐文件筛选，二进制显示补丁记录而非图像/十六进制解码。完整原字节仍使用已有导出功能；超限预览明确截断。代码页、损坏/取消/过期响应等边界由自动测试覆盖，不声称全部做过原生操作。原生滚轮检查不等于 QA-008 的帧时间测量。

QA-005 代码、自动回归、构建和原生复查完成，待本次提交推送后补记交付哈希。安装版 `D:/gitx/gitx.exe` 未替换，剩余 5 项，整体目标继续。
