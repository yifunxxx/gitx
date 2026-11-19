# QA-045：Log 树形模式导航、范围选择与定位（2026-11-20）

状态：代码已修复，定向与组合完整前端验证、类型检查、Vite 与原生构建通过。旧程序已原生复现，新程序的连续导航、Shift 范围、Home/End 及 goto 界面复查通过，具体边界见下文。最终测试仓库及用户设置已核对恢复，提交和推送尚待主任务完成。

## 问题与来源

Log 树模式按引用及第一父链展示提交，顺序可能与后端返回的平面历史不同，分组标题还会占用虚拟列表行。原实现仍使用 `log.commits` 的平面顺序处理方向键、Home/End、Shift 范围及 `scrollToIndex`，因此会选错相邻提交、包含不在屏幕范围内的提交，或将正确目标滚动到错误位置。

正式组件回归使用真实 `LogView` 和 Pinia `logStore`。最小历史为平面顺序 `[a, c, b, root]`，父关系为 `a→b→root`、`c→root`，其中 a 带 main 引用、c 带 feature 引用。树行依次为 `main 标题、a、b、root、feature 标题、c`。

- 从 a 按 Down，原程序选择 c，预期为显示中的下一项 b。
- 从 a Shift 点击 b，原程序选择 `[a, c, b]`，预期为 `[a, b]`。
- 跳转到 c，原程序居中平面索引 1，实际应使用树行索引 5。
- 跳到未加载的历史窗口时，提交数据先更新、树行下一动画帧才重建；原程序会在旧树仍显示时按平面索引滚动。

正式修改前 16 项用例中 13 项失败、3 项通过，见 `E:/IDEAproject/gitx/test-results/qa045-tree-navigation-before-20261120.log`。失败数量是断言场景数量，不代表发现 13 个独立缺陷。更早的临时审计证据保存在 `E:/IDEAproject/gitx/test-results/qa-log-audit-20261120/`，正式回归取代临时测试作为本项主要自动验证依据。

## 修改

- `LogView.vue` 缓存当前显示的提交 SHA 顺序与实际虚拟行索引。上下键、Home/End 使用提交顺序并跳过分组标题；父子导航保留既有目标选择方式，最终统一按 SHA 找到树行。
- `logStore.select` 增加可选的范围顺序参数，树模式 Shift 选择传入显示顺序，其余调用继续使用平面顺序。Ctrl/Cmd 切换与范围锚点语义保留。
- 键盘和 goto 共用定位逻辑。定位等待现有树布局 rAF 完成，再读取当前模式的行索引；树布局被新数据替换时继续等待最新任务，切到 flat 或卸载时释放等待者。
- 仓库或导航身份过期、组件卸载、用户已改选其他 SHA 时不执行旧定位；异步错误反馈也检查原操作是否仍有效。
- 树构建仍位于原有 rAF 中。显示索引使用 computed 缓存，没有在每次按键或滚动时重新调用 `buildLogTreeRows`，没有新增轮询计时器。

## 自动验证

新增 `LogTreeNavigation.test.ts` 共 19 项，覆盖上下/Home/End、跨分组、父子目标、Shift 点击/键盘范围、Ctrl 后范围锚点、已加载及远处 goto、未加载父提交、连续替换树布局、卸载、切 flat、改选、切仓库，以及 flat 模式原行为。

- 最终定向 8 文件、103 项全部通过：`qa045-tree-navigation-final-20261120.log`。
- `vue-tsc --noEmit` 通过：`qa045-typecheck-20261120.log`；修改文件的 Oxlint 和 `git diff --check` 通过。
- 与 QA-044 图缓存修复组合后，完整前端 144 文件、1333 项全部通过：`qa044-045-final-tests-20261120.log`。
- 同一组合的类型检查和 Vite 生产构建通过：`qa044-045-final-web-20261120.log`。保留既有动态/静态导入及大 chunk 提示。
- 同一组合的 Windows 原生 `cargo build` 通过：`qa044-045-final-native-20261120.log`。
- 独立只读审阅未发现提交阻塞问题。

上述日志均位于 `E:/IDEAproject/gitx/test-results/`。组件测试中的 VirtualList stub 验证了选择结果与滚动参数，但未暴露真实 `el`，因此没有实际执行行元素 `focus()`；不能以这些用例证明原生虚拟列表焦点行为或持续滚动性能。

## 旧程序原生复现

测试仓库为 `E:/IDEAproject/gitx/test-results/repos/log-order-20261120`，含 root、A0、A1、B0、B1、merge 六个提交。树中显示的提交顺序为 `merge、A1、A0、root、B1、B0`，B1 前有 branch-b 分组标题。

复现程序：

- 文件：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-dialog-input-0140-20261120.exe`。
- SHA-256：`59EA2034659900D84FDB2DBB411D3C830C1F30EAC1B0F9A7A90590B1BFC8FEDB`。
- PID：28144；启动时间：`2026-11-20T03:00:42.2319232+08:00`。

点击 merge 后按 Down，旧程序直接选中列表底部且部分不可见的 B1，详情内容也变为 B1；屏幕中的下一条提交实际为 A1。该行为复现了平面顺序与树顺序不一致造成的错误。UIA 快照的 focused_element 仍为 RootWebArea，因此本次判断依据是操作时的截图观察和详情变化，不将 UIA 焦点字段解释成已确认的提交行 DOM 焦点。

程序身份及操作记录：`qa-log-audit-20261120/native-before-program.json`、`qa-log-audit-20261120/native-before-down.json`。旧测试根进程已退出。

## 修复后原生复查

最终程序在同一六提交仓库完成复查：

- 文件：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-log-navigation-0140-20261120.exe`。
- SHA-256：`09A97D9BFB2B35F49A10C85ADB2DF4ADD30E5AE305C2B5588359F33104144900`。
- PID：24376；启动时间：`2026-11-20T03:04:23.2589436+08:00`。

| 操作 | 新程序观察结果 |
| --- | --- |
| 点击 merge 后按 Down | 选中显示中的下一项 A1，可见焦点环；不再跳到 B1。 |
| 不再次点击，继续按 Down | 选中 A0，详情也显示 A0。 |
| 接着按 Shift+Down | 仅 A0 和 root 高亮，root 可见焦点环。 |
| 按 End | 选中最后一条提交 B0，并将其完整滚入可见区域。 |
| 按 Home | 选中首条提交 merge。 |
| 在 goto 输入 branch-b 后按 Enter | 先显示 Locating 反馈，随后 B1 完整可见并选中，详情显示 B1。 |

程序身份及操作记录：`qa-log-audit-20261120/native-final-program.json`、`qa-log-audit-20261120/native-final-tree-actions.json`。测试根进程 PID 24376 已关闭。

上述连续按键没有依靠每一步重新点击来恢复导航，证明本次普通键序列持续有效。UIA 的 focused_element 仍显示 RootWebArea，结论依据是连续截图、行高亮、焦点环、详情及后续按键行为；未据此声称精确的 DOM 焦点已独立验证。跨组范围、左右父子导航、异步窗口和切换竞态由自动回归覆盖，本轮未将这些全部写成原生复查结论。

## 当前边界与交付状态

测试仓库恢复核对已完成：`log-order-fixture-after.json` 与测试前记录的 HEAD、tree、index、status、refs 及三个文件的哈希全部一致，差异列表为空。证据位于 `E:/IDEAproject/gitx/test-results/qa-log-audit-20261120/`。

树模式测试实例仅确认根进程 PID 24376 已退出，未据此扩大为该实例的全部子进程均已核对。后续 flat 界面复查实例 PID 29840，连同其余已采样进程共 8 个身份，按 PID 与创建时间逐一确认均已退出；证据为同目录的 `native-flat-processes-before.json`、`native-flat-processes-after.json`。

北京时间 `2026-11-20 07:33:09.313` 核对用户设置时，与原备份不同的字段仅有 `recentWorkspaces`。已恢复完整备份字节并确认 SHA-256 与原件一致：`F160603B7BCE0F5CF7D07D6D1EAA088B6B69B79BB2F1FF83B855FB00E4F245C7`，见同目录 `settings-restoration.json`。

提交和推送待主任务完成。尚未将安装路径 `D:/gitx/gitx.exe` 更新为本次构建。

PageUp/PageDown 原先没有对应导航实现，树分组原先没有折叠状态或按钮，本次未新增这两类功能；不能把它们写成本次已修复或已验证。此项修复也不替代 QA-034 持续快滚/长期负载验收、QA-040 资源归因和整体测试优化目标。
