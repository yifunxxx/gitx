# Log 菜单与比较标签来源保护

日期：2026-11-10。QA-004 的 Log 部分；Changes 部分见前一份菜单报告。整体目标仍在进行。

## 发现与修复

- 菜单打开时保存被右键点击的提交、当时的多选集合、首父提交和文件路径。菜单关闭/替换、选择变化后，旧按钮不能执行；接受的命令保持原目标，等待确认或动态加载后不会改用新的选择。
- 仓库导航开始、A→B→A、同路径重开、仓库身份变化和组件卸载会使未完成的菜单后续操作失效。取消确认不执行；确认后重新检查 busy；错误只在来源仍有效时显示。
- 多选时禁用只支持一个提交的操作；比较版本要求恰好两项；撤销提交只对 HEAD 启用。复制等待剪贴板成功后再提示，失败有反馈。菜单按自己的会话编号渲染，替换后的旧按钮不能触发新目标。
- 变更文件右键显示 Diff、历史与提取菜单，打开菜单本身不立即跳转历史。文件路径、重命名前路径和所属提交一起固定。集成目录的部分提取/部分丢弃弹窗保留，并接入同样的来源校验。
- “显示全部更改”使用本次比较实际返回的标签，避免任意查找同提交的其他标签；首个提交使用 EMPTY。Enter/双击打开当前行的提交更改，异步完成后不抢回其他编辑器。
- 比较标签使用响应式对象，修复独立分支首次打开可能停在加载状态的问题。导航清理标签，关闭后重开/旧请求乱序/交换方向/重复请求后，旧结果不能覆盖当前标签。Combined 失败显示在标签内；与本地比较传递 WORKTREE 目标，避免误显示提交自身改动。
- 独立分支后端增加 EMPTY 双向比较与空内容读取。核对数据入口时发现旧 diff-tree 省略 root/merge 的变更文件列表；隔离命令和回归确认后提取集成目录已有的按首父提交/空树比较逻辑。
- 检查下游代码时登记 QA-018：历史和仓库快照浏览器缺少请求/标签身份保护的待核查路径。本轮没有宣称这两个浏览器内部已完成生命周期验收。
- 首轮原生复查发现文件树复制文件对象后，被新增的引用相等校验误拦截。改为绑定文件列表的提交/详情/数组会话，并按路径、原路径和状态解析文件副本；加入真实 PathTreeList 的右键/双击与过期回调测试，随后重新构建复查。

## 自动验证

- 初始菜单行为用例：12 项中 11 项失败；比较 store 初始 12 项全部失败。记录的是失败用例，不是独立缺陷数量。
- 最终前端完整回归：独立分支 83 文件 / 680 项；集成目录 101 文件 / 802 项，通过。两处包含重叠测试，不能相加。
- 两处生产构建（含 vue-tsc）、变更范围 Oxlint 和 diff 检查通过。保留既有 Vite 分块体积提示。
- 新菜单回归覆盖真实行事件、延迟确认/动态加载、菜单替换、选择变化、取消与 busy、错误范围、文件来源、首提交、重命名、Enter/双击和剪贴板结果；比较回归覆盖标签对象、仓库生命周期、请求顺序、关闭重开、Combined 错误和比较方向。
- 集成目录首次全量验证发现 Enter/双击旧调用参数和两项旧菜单测试缺少真实打开步骤，已修正后重新运行完整回归与构建。
- Rust 定向回归：独立分支 `empty_tree_compare` 2 项及 `m3_history_compare` 1 项通过；集成目录对应 1 项及 4 项通过（首提交/合并用例已在既有 m3 文件中，不重复添加）。独立分支修复前 root 文件列表用例失败，修复后通过。

主要日志均在 `E:/IDEAproject/gitx/test-results/`：`log-menu-baseline.log`、`log-compare-baseline.log`、`log-menu-root-baseline.log`、`log-menu-main-delivery-tests.log`、`log-menu-integration-delivery-tests.log`、`log-menu-main-delivery-build.log`、`log-menu-integration-delivery-build.log`、`log-menu-rust-final.log`、`log-menu-integration-rust.log`、`log-menu-native-delivery-build.log`。

## 原生与交付状态

最终原生构建来自独立分支本轮代码，路径 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-log-menu-delivery-20261110.exe`，SHA256 为 `5B3F20C3B85D6FDD6EF0A6D09704FA2D1A385BBD22BD6BB46E64DBD9D36AB5F2`。文件树事件修正后重新运行完整前端回归和构建，并重建此可执行文件。

- 文件右键显示“显示 Diff / 显示历史 / 提取所选更改…”菜单；Enter 打开对应 HEAD 文件比较，显示 Fixture version 2 → Fixture version 3。
- 双击首提交打开 `Compare EMPTY…4d55c63`，Combined 显示新增 Fixture version 1；双击其文件打开空左侧与首提交内容右侧。
- Shift+Down 选中两项后右键保留两项。单提交操作禁用，合并/丢弃/还原/版本比较启用；丢弃确认准确显示 2 个提交，取消后保留两项及原提交。
- 浅色主题下右键未选中的 HEAD，改为单选该提交；撤销提交启用，合并和版本比较禁用。首轮原生另检查了首提交撤销禁用、详情加载期间提取禁用及加载完成后启用。
- 与 HEAD 的本地比较显示 `06afc43… → WORKTREE`；Combined 显示 `+Uncommitted local line`，未误显示前一提交到 HEAD 的变化。
- 深色主题已恢复，测试应用已关闭。观察到 Combined Diff 和普通文件 Diff 的亮色行号栏，已登记 QA-009，未计为本轮修复。

隔离仓库 `E:/IDEAproject/gitx/test-results/repos/rewrite-dialog-gui-20261110` 的前后快照为 `log-menu-gui-before.json` / `log-menu-gui-after.json`（均在 test-results 下），脚本核对 `unchanged: true`。HEAD 保持 `06afc43ab9d3eda74fa4efb638296467ed139e16`，分支引用、脏文件/未跟踪状态、索引 SHA256 和两个文件哈希均未变。

本轮原生检查只执行读取、菜单和确认取消；异步竞态、后续调用参数及导航失效由自动化回归验证，不宣称执行了原生丢弃/重写操作。QA-018 历史/快照内部回填仍待独立核查。没有生成截图文件，原生观察记录在本轮工具会话。

QA-004 已完成代码、自动测试和原生验收，提交推送待记录。用户安装版 `D:/gitx/gitx.exe` 未替换；总体目标仍在进行，统一台账当前保留 9 项未关闭事项。
