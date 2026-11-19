# QA-044：Git Log 图线缓存的失效与追加复用

日期：2026-11-20。来源：Git Log 易用性及数据刷新代码审查。范围为 `graphLayout.ts` 与正式图线回归；树模式选择和定位另记 QA-045。

## 已复现问题

增量图线缓存原来只比较布局选项、首尾 SHA 和提交数量。合法拓扑排序切换可以保持首尾和数量，却改变中间提交顺序；复用旧行后会把图线连到错误的父提交。同一提交的 refs 改名也不会使缓存失效，节点与继承的 lane 标签可能继续显示旧名称。

临时回归用两个分支汇入 merge 的真实 DAG 语义验证：原顺序 `merge,a1,b1,a0,b0,root` 改为 `merge,b1,b0,a1,a0,root`，首尾和数量不变。修改前渲染出的 merge 父连接为 `b1,b0`，实际父为 `a1,b1`；b1 的线连到 a1，实际父为 b0。沿图线追踪至提交节点的断言失败，不仅比较了布局内部数组。refs 从 `refs/heads/old-name` 改为 `refs/heads/new-name` 后，旧节点标签仍是 `old-name`。正常追加对照通过。

另建立专用真实 Git 仓库 `E:/IDEAproject/gitx/test-results/repos/log-order-20261120`：root→A0→A1 和 root→B0→B1，merge 的父顺序为 A1、B1。固定提交时间后，实际 `git log --all --date-order` 输出 `merge,B1,A1,B0,A0,root`，`--topo-order` 输出 `merge,B1,B0,A1,A0,root`，证实同首尾的内部重排会在合法 Git 历史中出现。HEAD、索引、完整 status、refs 和文件哈希记录在 `log-order-fixture-before.json`。该 fixture 随后用于下文最终原生排序复查。

## 修复策略

cursor 保存当前图线所依赖的 SHA、shortSha、parents 和 refs 独立快照；复用前逐项核验完整既有前缀，不以相同数组或提交对象引用作为有效性证据。父数组与 refs 均复制，能识别调用方的原地修改；只保存图线输入，不保留完整业务提交对象或旧 cursor 链。

相同数据返回原 cursor 和 rows；未变化前缀后的追加仅布局新行，旧行对象保持复用，既有输入快照对象也复用。重排、标签/父关系变化、缩短、前插或选项改变时重新布局。过滤模式的追加可能把隐藏父提交带入可见集，因此仍完整重排；未变化的过滤窗口可以复用。

核验沿用 LogView 的提交/筛选变化触发路径，不在滚轮事件或每次行渲染中执行。完整前缀检查有线性成本，但避免错误缓存，也保留了追加时不重建既有图线的收益。

## 自动验证

正式新增回归在修改前 **8 项失败 / 16 项通过**；修复后图线共 **26 项通过**，连同图形视口和树行构建共 **3 文件 / 32 项通过**，原临时图线回归 **3 项通过**。覆盖：

- 同首尾合法重排及同一数组原地重排，沿线核对真实父连接。
- refs 改名、增删/顺序变化和跨行继承标签，父数组原地改变、shortSha 改变。
- 内部重排同时追加、正常追加、原地追加，断言旧图线行对象保持复用。
- 等价刷新、空窗口、选项变化、缩短/前插，过滤追加后隐藏父恢复连接。

类型检查、修改文件 Oxlint 与差异检查通过。QA-044/045 最终组合完整前端 **144 文件 / 1333 项**、类型检查和 Vite 生产构建通过；Windows 原生构建亦已通过（cargo build，2分55秒）。

证据目录 `E:/IDEAproject/gitx/test-results/qa-log-audit-20261120/`：`topology-before.log`、`graph-formal-before.log`、`graph-formal-after.log`、`graph-adjacent-after.log`、`graph-original-after.log`、`graph-typecheck.log`、`graph-lint.log`。组合日志在 test-results 根目录：`qa044-045-final-tests-20261120.log`、`qa044-045-final-web-20261120.log`、`qa044-045-final-native-20261120.log`。

## 20,000 条历史的函数计时

Windows x64、Node 24.22.1，合成线性历史加载 20,000 条，再追加 100 条；每项预热20次，取15个批次，每批20次，完整布局每批3次。数据在 `graph-cache-cost.json`，脚本与日志为 `graph-cache-cost.test.ts`、`graph-cache-cost.log`，均在上述证据目录。

| 场景 | 修改前中位（ms） | 修改后中位（ms） |
| --- | ---: | ---: |
| 相同图线输入刷新 | 0.000465 | 0.530955 |
| 追加100条 | 0.120275 | 1.144695 |
| 全量布局20100条 | — | 13.504633 |

修改后的输入核验比原先仅比较首尾更贵；正常追加仍明显少于重新布局全量历史。该数据是函数层计时，包含调度/GC波动，不包含 Git IPC、DOM 或原生输入到呈现；没有添加依赖机器速度的通过阈值，不把这些数值当作滚动延迟或全部性能问题已解决。

## 最终原生复查

程序为 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-log-navigation-0140-20261120.exe`，SHA256 `09A97D9BFB2B35F49A10C85ADB2DF4ADD30E5AE305C2B5588359F33104144900`。本次平面图线实例 PID29840，启动时间 `2026-11-20T03:12:50.025644+08:00`。

原生界面依次验证 Date → Topological → Date：可见顺序从 merge/B1/A1/B0/A0/root 变成 merge/B1/B0/A1/A0/root，再恢复原顺序。A1的蓝色节点随行移动，merge→A1→A0→root 与 merge→B1→B0→root 两条连接保持正确，merge详情中的两个父提交与真实Git一致。记录为 `native-flat-sort-actions.json`。本轮没有旧原生图线对照；修改前失败证据来自自动回归。refs改名仍为自动测试证据。

测试后 `log-order-fixture-after.json` 核对 HEAD、tree、index、status、refs和3个工作文件哈希全部一致。`native-flat-processes-before.json` / `native-flat-processes-after.json` 核对本实例采样到的8个进程身份均已退出，不声称覆盖所有短命进程。设置恢复只发现测试引入的recentWorkspaces差异，按备份原字节恢复后SHA256为 `F160603B7BCE0F5CF7D07D6D1EAA088B6B69B79BB2F1FF83B855FB00E4F245C7`，见 `settings-restoration.json`。

## 交付边界

代码、自动验证、原生构建和排序切换复查完成；引用改名原生路径未单独测试。功能独立提交推送，实际SHA和远端核对结果在统一台账随后补记。用户安装版未更新。总体流畅度、资源和最终同版验收继续按统一台账推进。
