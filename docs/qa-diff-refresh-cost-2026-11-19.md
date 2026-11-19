# QA-034：Gitx 元数据事件的差异刷新开销

2026-11-19，调查基线为 `3d5641f`（0.1.40）。本项继续核查后台刷新产生的重复工作，仅优化 Gitx 元数据事件的差异请求。未恢复此前丢弃的 watcher 实验。

## 现象与修改范围

`useRepositoryRefresh` 原来收到任何非空事件集合，都会对所有 `kind="file"` 的差异标签调用 `reloadTab`，包含隐藏标签。原生 watcher 把 `.git/gitx` 下的应用元数据（排除日志数据库）单独分类为 `metadata`；这些记录变化仍需要刷新 Changes 和 Shelf，但不改变差异请求读取的 HEAD、索引或工作文件内容。

本次仅让纯 `metadata` 事件跳过差异标签刷新。Changes、Shelf、事件合并、失败兜底、初始化及窗口聚焦逻辑不变；同轮若还收到 worktree/index/refs/opState/ignore 中任意一种事件，仍保留原差异刷新行为。`ignore` 同时包含工作树中的 `.gitignore` 内容变化，因此没有将它排除。

## 受控对照

Node 24.22.1 加载实际 `useRepositoryRefresh`、`diffStore`、`sameDiffResult` 源码，运行真实 Vue/Pinia 响应式与可控事件调度；后端替身返回全新但相同的 DiffFileResult。共打开 12 个普通差异标签（HEAD→INDEX、INDEX→WORKTREE、HEAD→WORKTREE 各 4 个，其中一个重命名调用 diffFileAt）及 3 个 compare 标签。只有 1 个普通差异标签处于活动状态。每份结果有 60 个 hunk，每个 hunk 100 行。

| 单次纯 metadata 事件产生的工作 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 差异后端接口请求 | 12 | 0 |
| 其中隐藏标签请求 | 11 | 0 |
| sameDiffResult 调用 | 12 | 0 |
| 逐行相等比较 | 72,000 | 0 |
| tabs 数组替换 | 36 | 0 |

修改前隐藏标签贡献 66,000 行相等比较。36 次数组替换来自每个标签的开始加载、相同结果的 textsLoaded 回填及结束加载；不等同于 36 次 DOM 渲染。EditorTabs 只挂载当前 DiffViewer，因此此处没有把隐藏标签的数据工作写成隐藏编辑器重排或重绘。

同一脚本对 worktree/index/refs/opState/ignore 和 focus 的结果维持原样：各 12 次请求、72,000 行相等比较及 36 次数组替换。这是限定场景的工作量对照，不是原生帧时间测量。Rust 的差异接口每次请求仍读取两侧并计算 hunks；此次使用后端替身计数，没有测量实际 Git 进程或原生后端耗时。

脚本与原始数据保存在 `E:/IDEAproject/gitx/test-results/`：

- `diff-refresh-investigation-20261119.mjs`
- `diff-refresh-metadata-before-20261119.json`
- `diff-refresh-metadata-after-20261119.json`

## 自动验证

新增回归先验证纯 metadata 不调用差异刷新，同时仍调用 Changes 和 Shelf；修改前出现预期的 1 项失败，另外 17 项通过，日志 `diff-metadata-before-20261119.log`。另覆盖 metadata 与每一种其他事件分批到达后合并，以及 metadata 之后的窗口聚焦刷新。首轮失败暴露测试清理顺序问题，已让新增用例在断言前卸载宿主，获得独立可重复的产品失败日志；初始清理失败另存 `diff-metadata-initial-cleanup-failure-20261119.log`，不作为产品缺陷。

修复后刷新器、diffStore 响应式和 Diff 标签隔离定向 3 文件 / 27 项通过，日志 `diff-metadata-after-20261119.log`。前端类型检查和修改文件 Oxlint 通过，日志 `diff-metadata-typecheck-20261119.log`、`diff-metadata-lint-20261119.log`。

## 限制与交付

本项不改变其他事件的差异刷新范围，不引入隐藏标签 dirty/激活补刷协议。调查中另复现历史 SHA→WORKTREE 比较未随本地变化、聚焦或重开更新的问题，按 QA-039 独立修复，不能把该问题列为本次已解决。

本项尚未进行原生界面或帧时间验收，未替换用户安装版。整体滚动性能 QA-034/008 继续保留。功能、定向验证和报告准备完成，由主任务独立提交和推送，交付结果另行记录。
