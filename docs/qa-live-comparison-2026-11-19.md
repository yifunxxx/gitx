# QA-039：动态修订比较的刷新与导航生命周期

2026-11-19，基于 0.1.40 与已独立交付的 metadata 刷新优化 `1d0a578`。本项修复历史版本与当前工作区的比较长期保留旧内容，并补齐同一比较路径上的请求归属与空修订处理。

## 复现与来源

历史菜单和历史仓库浏览器的 Compare with Local 使用 `openRevDiff(sha, "WORKTREE")`。该方法创建 `kind="compare"` 标签，但后台刷新器只刷新普通 `kind="file"` 标签，重开已有结果的比较又直接使用缓存。因此工作文件变化、窗口聚焦和再次执行相同比较均不读取最新文件；显式刷新才取得新内容。refs 比较同样可以携带 `main` 等可变修订名，不能用标签种类判断内容固定。

受控测量运行真实 diffStore 与 useRepositoryRefresh、Vue/Pinia，后端替身返回可切换版本的结果。先载入旧结果，再把工作区结果切为新版本：修改前 worktree 事件、focus、重开均为 0 请求、结果仍旧；显式 reload 取得新内容。脚本不包含原生 Git 进程或界面呈现，不能写成原生验收。前数据见 `diff-refresh-metadata-after-20261119.json`，后数据见 `live-comparison-probe-after-20261119.json`，可重复脚本 `diff-refresh-investigation-20261119.mjs` 均保存在 `E:/IDEAproject/gitx/test-results/`。

## 修改行为

共享端点判断直接读取 leftRev/rightRev，只有精确大写 `EMPTY` 或完整 40/64 位十六进制对象 ID 作为固定端点。WORKTREE、INDEX、HEAD、分支名、短对象 ID、修订表达式及未知字符串均保守视为动态。小写 `empty` 是普通修订名，不误当作后端的 EMPTY 哨兵。普通差异标签的 left/right 是真实 DiffSide，比较标签的 left/right 则是默认值，不用于判断比较是否固定。

后台非 metadata 事件现在也刷新至少含一个动态端点的比较，固定比较继续保持缓存；元数据优化保持有效。重新执行已缓存的动态比较会软刷新，期间保留已有画面，读取错误显示后可重试。沿用已有单调请求代次，关闭后同 ID 重开不会接收旧结果。重命名原路径仍包含在标签 ID 及 diffFileAt 请求中。

补查还确认了两个相邻边界：

- 后端支持空修订字符串表示工作区，但前端用字符串 truthy 判断是否调用 diffFileAt，导致空字符串落到默认 head→worktree 请求。现在只判断两侧修订是否已定义，保留空字符串及比较方向。
- 同路径导航代次改变或仓库 ID 改变时，原 diffStore 仅观察路径，缓存和旧请求没有失效。现在同步观察路径、仓库 ID、导航代次，清理缓存、视图状态及请求归属。刷新器也使用这三个身份，并重新串行注册原生监听，丢弃过期原生事件。

## 验证

先加真实 store/刷新器回归，动态比较重开及事件更新在修改前有 19 项失败、5 项通过，日志 `live-comparison-before-20261119.log`。随后独立加入空修订两种方向、同路径导航和同路径仓库 ID 变化，修改前再得到 4 项失败、17 项通过，日志 `live-comparison-lifetime-before-20261119.log`。

覆盖的行为包括：

- worktree/index/refs/opState/ignore 和窗口 focus 更新动态比较；纯 metadata 不更新。
- 完整 SHA-1/SHA-256 与精确 EMPTY 比较缓存保持；短 ID、小写 empty、HEAD~1、MERGE_HEAD、INDEX/:0/WORKTREE 重新读取。
- 重命名请求原路径、加载中保留画面、失败重试、关闭后同 ID 重开和导航后的旧响应保护。
- 同路径及异路径的连续导航触发多次配置时仍串行注册，旧 native generation 事件不触发刷新，当前 generation 正常工作。
- 普通差异、完整文本展开、选区和滚动快照的已有回归。

最终定向回归 9 文件 / 81 项全部通过，类型检查与修改文件 Oxlint 均通过。日志分别为 `live-comparison-after-20261119.log`、`live-comparison-typecheck-20261119.log` 和 `live-comparison-lint-20261119.log`，保存在上述 test-results 目录。

修复后同一受控脚本中，worktree、focus 和重开分别增加一次本地比较请求，三个阶段均持有新内容；仅 metadata 的差异请求仍为 0。包含 12 个普通差异和 3 个比较的场景中，非 metadata 请求从 12 次变成 14 次，新增两次分别是此前漏刷的 WORKTREE 比较和符号引用比较，固定对象比较保持不刷新；这部分增加是正确性修复，不宣称性能下降已消除。

## 边界与交付

本项没有引入隐藏标签 dirty/激活协议，没有进一步按事件种类细分普通文件差异，也没有修改 compareStore、Combined Diff 或后端读对象逻辑。动态比较采用保守刷新，后续减少隐藏标签计算仍应建立完整失效协议。

本项原生 GUI 和帧时间验证由主任务继续，尚未替换用户安装版。代码、自动回归与报告准备完成，提交和推送由主任务独立执行并补记。
