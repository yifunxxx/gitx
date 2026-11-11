# 文件历史特殊路径解析（QA-022）

日期：2026-11-11。独立分支 `codex/checkout-target-safety`；相关改动同步至 `E:/IDEAproject/gitx`，保留其独立修改。

## 复现

原 `file_history` 以换行/制表符拆分非 NUL 的 `--name-status`，直接把 Git 的路径引号/八进制转义交给比较器，又用记录分隔符切分提交信息。路径查询也使用通配符匹配。

两处初始真实 Git 回归均为 6 项中 5 失败、1 通过：中文路径变为带引号的转义文本；带制表符的路径被转义；`[ab].txt` 历史混入 a.txt/b.txt 的提交；中文重命名分页返回错误路径；提交说明内的记录分隔符将说明截断。日志为 `E:/IDEAproject/gitx/test-results/history-paths-baseline-{main,integration}.log`。

## 修改

- 历史查询使用 literal pathspec，准确限定用户选择的单个文件，保留 Git 的重命名跟踪和分页。
- 元数据和 name-status 均以 NUL 分隔；解析时先读取固定的六个头字段，再按状态读取一个路径或重命名的两个路径。路径中的换行、制表符、引号、空格和记录分隔符不再参与结构切分。
- 只去掉 Git 加在状态字段前的换行，不裁剪路径和元数据。空父提交、空说明、重命名原路径均保持完整。
- 固定 UTF-8 元数据编码，禁用颜色、装饰、Notes 和签名输出，显式保留根提交状态，避免本地展示配置干扰机器解析。
- 不完整或异常的输出返回明确错误，沿用 QA-021 的后端错误传播与前端重试入口。

## 自动验证

9 个真实 Git 用例覆盖中文/空格、quotePath 开关、方括号与通配符/路径魔法字面匹配、重命名/分页/删除、空说明、特殊分隔符说明、特殊字符重命名、展示与输出编码配置，以及双分支合并后的历史完整性。通过 Git tree plumbing 构造合法 Git 名称，在 Windows 上也验证了不适合直接检出的控制字符路径；这不代表 Windows 文件系统能创建这些名字。

独立分支最终相关 Rust 29 项通过；集成目录相关 Rust 30 项与末轮扩展 9 项通过，唯一用例合计 31 项。两处均包括上一轮 QA-021 的 17 项读取错误保护。前端历史/比较定向独立分支 48 项、集成目录 57 项通过，两处覆盖有重叠，不相加。

相关 Rust 文件格式检查、`git diff --check` 及独立分支原生构建通过。前端源码和接口未改变，使用 QA-018 已完成类型/生产构建的前端产物。

## 原生验证

程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-history-paths-20261111.exe`；SHA256 `C67E465E61E056739D31C93DD51DA1303E9138E0C882B74B98911B3D5157BFC1`。Git `2.34.1.windows.1`。

新建隔离仓库：`E:/IDEAproject/gitx/test-results/repos/history-paths-gui-20261111`，HEAD `e05882724bdc6e6b97ca71bef1cd3288c5fcff9b`，开启 `core.quotePath=true`。旧[名].txt 在根提交创建后改名为新 文件.txt，后续还有内容修改、本地修改，以及单独的 `[ab].txt` 与无关 a.txt 提交。

实际观察：

- 从 Changes 菜单打开新 文件.txt 历史，准确列出修改、重命名和根提交三项，没有混入 a.txt 的提交。
- 修改提交显示 `Original Chinese path` → `Committed Chinese path`；纯重命名显示“无差异”；根提交显示旧[名].txt 的新增内容。
- 根提交“与本地比较”正确标记旧[名].txt → 新 文件.txt，并显示原始文本与 `Local Chinese path`。
- 从 Log 根提交的文件菜单打开 `[ab].txt` 历史，只出现根提交及 `Literal brackets content` 新增 Diff；切到“所有分支”后结果仍正确，没有无关 a.txt 提交。
- 测试后 HEAD、引用、状态、索引原始哈希及三个工作区文件哈希与开始时一致；程序已关闭，进程和窗口列表确认退出。

证据：`E:/IDEAproject/gitx/test-results/history-paths-gui-{before,after}.json`，其余日志使用 `history-paths-*` 前缀。特殊控制字符、分页、删除、合并和编码配置以真实 Git 自动回归为证据，不声称已全部原生操作。WSL 未覆盖；深色 Diff 亮色行号栏仍由 QA-009 跟踪。

## 交付

QA-022 代码、自动回归、原生构建和界面复查完成，功能提交 `097e8b6` 已推送并经 ls-remote 核对远端一致。安装版 `D:/gitx/gitx.exe` 未替换，总体目标继续。
