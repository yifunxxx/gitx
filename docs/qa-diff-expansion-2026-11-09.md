# 无差异全文展开与统一视图（2026-11-09）

修复纯重命名或空白过滤后无 hunk 时无法展开全文的问题；并排视图保留两侧原文，统一视图补齐修改块之前、之间和之后的上下文。开头为 + / - 的普通文本仍作为未修改内容显示。

明确区分尚未加载全文与文件一侧不存在，避免新增/删除文件重复请求。展开加载中显示进度，失败持续显示具体原因并可重试。加载失败不再留下未处理 Promise 错误。

验证：

- 组件回归修复前 7 项全部失败并有 1 个未处理错误，修复后全部通过；另有 5 项统一全文构造回归覆盖跨块重建、整文件新增/删除、空文件、空行和 15 万行输入。
- 最终独立前端全量 20 文件 / 133 项通过，集成前端 52 文件 / 337 项通过。两处生产构建（含类型检查）通过；仍有主 chunk 体积提示。日志：`frontend-diff-expansion-*.log`、`build-diff-expansion-*.log`。
- GUI 在专用 `diff-interactions-qa` 仓库实测：纯 rename 折叠显示无差异，展开并排和统一均显示 +literal / -tail 且不着色；context.txt 统一展开出现第 1–30 行，只标色第 15 行替换；spaces.txt 忽略空白后展开保留左侧 a b、右侧 ab。
- GUI 文本证据：`diff-expand-rename-collapsed-gui.txt`、`diff-expand-rename-side-gui.txt`、`diff-expand-rename-unified-gui.txt`、`diff-expand-context-unified-gui.txt`、`diff-expand-whitespace-gui.txt`。`diff-expansion-gui-verified.json` 核对 HEAD、refs、index、status、文件哈希 5 项均保持。

GUI 使用现有调试后端与 Vite 中的最新前端，未替换安装版本。慢响应与失败重试由组件异步回归覆盖，未注入桌面后端错误。
