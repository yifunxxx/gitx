# QA-048：Log 宽图只渲染可见普通路径

日期：2026-11-20。来源：QA-047 后续检查真实 VirtualList 可见行及 CommitGraphCell 的横向裁切。类别为性能改进；本项减少屏幕外 SVG 路径，不将 DOM 数量或 happy-dom 执行时间写成原生滚轮延迟。

## 问题与范围

原 CommitGraphCell 为每个可见提交生成整行全部 lane 的 path，外层图形列通过 `overflow-hidden` 和 `translateX(-graphOffset)` 隐藏屏幕外部分。横向裁切没有减少实际 VNode/DOM 数量。

修改前的真实 VirtualList + CommitGraphCell 探针使用 20000 条记录、默认 400px 视口及 22px 行高：挂载 39 个图形单元，1/40/128 条 lane 分别生成 39/1560/4992 条普通路径。连续 12 次每次一行的滚动共读取 468 次数组项，说明列表已按可见窗口取行；本项针对可见行内部的宽图路径，未修改共享列表窗口。

开始本项前已同步 origin/master 的 `15413310ea91c5e20ef8d436ef72785f901e1a9c`（0.1.41 版本更新，无产品逻辑变化），本项修改前 HEAD 为 `5f114225a21997bbfb45d01d72f7dea8d9440099`。

## 修改

`LogView.vue` 将已有的 `graphOffset`、`graphColumnWidth` 传给 CommitGraphCell。完整 SVG 的尺寸、viewBox 和外层平移保持原坐标系；整个列表的 `scrollLeft` 不再次参与图内偏移。

CommitGraphCell 在原有颜色映射、贯穿线去重之后按可见横向区间过滤普通路径。缺省或不可用的视口参数继续渲染完整图形。有效区间左右各留 2px，覆盖 2px 描边、圆形端点及保守的抗锯齿边界。

直线以 lane 的 x 坐标判定；曲线以两端 x 的最小/最大值判定。当前曲线的 x 控制点仅为 `[x1, x1, x2, x2]`，其 x 范围始终位于两端之间，因此两端分处视口左右的跨界曲线会保留，正向和反向均如此。若以后修改曲线控制点使其超出端点范围，需要同步更新包围区间判定。

过滤后的每条路径继续使用原始 edge 索引作 key，使横向平移时仍可见的路径保持 DOM 身份。原始分段 computed 与视口筛选分开，单纯横移不重复执行去重或颜色映射。节点圆、每行最多两条 incoming/hidden-parent 辅助线、title 与 ARIA 标签完整保留，仍由原外层裁切约束显示。

## 正式回归

新增 `CommitGraphCell.test.ts` 20 项，并在 `LogGraphViewport.test.ts` 新增 1 项集成回归；该文件原有 4 项继续保留。

- 缺省视口与缺失、NaN、Infinity、零或负宽参数兼容。
- 左、中、右横移、2px 两侧边界、自定义行高和 lane 宽度。
- 两端均在屏幕外的正反向跨界曲线，贯穿线去重及原始颜色索引。
- 横移和扩宽后重叠路径保留同一 DOM 元素。
- 固定视口下替换 graph/edgeColors，模拟虚拟列表复用行，路径几何、颜色、节点同步更新，无旧路径残留。
- 屏幕外节点、incoming 线、hidden-parent 提示和无障碍标签保留。
- Log 的 slider 平移、ResizeObserver 尺寸变化和选中节点自动 reveal 将相同视口传给每个单元；整个列表横向滚动不重复计算偏移。

将两个修改前组件的源码从 HEAD 保存到仓库外，用测试专用 Vite pre-transform 加载，未临时替换活动源码。最终同一组 25 项在旧实现上 **10 失败 / 15 通过**；失败均指向未裁剪路径或未传视口。修复后连同图线布局、树导航、图线调度、LogView 和共享 VirtualList 回归，**8 文件 / 97 项通过**。相关 Oxlint 退出码 0，`git diff --check` 通过。

最初测试曾直接读取 VueWrapper 的根属性，未取得实际 SVG 属性；现已改为 `find("svg")`。最终修改前反证以 `formal-before-corrected.log` 为准，早期 `formal-before.log` 和第一次修后日志不作为最终结果。首次类型检查也指出集成测试中可选 props 的 TypeScript 断言缺失，已补非空类型断言；最终类型及完整构建由交付阶段补记。

## DOM 数量对照

修后外部探针仍挂载真实 VirtualList 和 CommitGraphCell，使用相同 20000 条记录、22px 行高和 39 个图形单元，传入 210px 图形视口。每种宽度滚动 12 次仍只读取 468 次数组项。

| Lane 数 / 图内偏移 | 修改前普通路径 | 修改后普通路径 | 挂载 SVG |
| --- | ---: | ---: | ---: |
| 1 / 0px | 39 | 39 | 39 |
| 40 / 0px | 1560 | 585 | 39 |
| 128 / 0px | 4992 | 585 | 39 |
| 128 / 700px | 4992 | 624 | 39 |
| 128 / 1594px | 4992 | 585 | 39 |

此探针验证实际组件挂载数量，不含浏览器布局、栅格绘制或原生输入计时。首次运行在全量验证并行期间超过测试默认 5 秒时限；保留原日志后为该仓库外探针设置 30 秒预算，重跑 1 项通过，实际测试用时 2.977 秒。没有通过放宽断言隐藏数量差异。

本次过滤仍遍历当前行的已生成 segments，复杂度随该行边数增长；没有减少全历史图线布局、边对象数量，也没有证明所有滚动卡顿已解决。普通窄图也沿用此路径，需要最终程序验收共同确认显示行为。

## 证据和交付状态

当前证据目录为 `E:/IDEAproject/gitx/test-results/qa-log-visible-edges-20261120/`。

- `CommitGraphCell.before.vue`、`LogView.before.vue`、`baseline.config.mjs`、`formal-before-corrected.log`：隔离加载旧实现，最终 10 失败 / 15 通过。
- `formal-after.log`：正式定向 8 文件 / 97 项通过。
- `oxlint-status.json`：修改文件 Oxlint 退出码 0。
- `visible-window-after.test.ts`、`visible-window-after.json`、`visible-window-after.log`：真实组件 DOM 数量及有界数组读取，1 项通过。
- `visible-window-after-initial-timeout.log`：首次外部探针的默认时限失败记录。

修改前数量来源保存在 `E:/IDEAproject/gitx/test-results/qa-log-scroll-audit-20261120/visible-window.{test.ts,json,log}`。该目录还保留实施前候选的几何探针；最终实现与断言以本项正式文件和上述修后探针为准。

独立审阅未发现产品阻塞项，并据审阅建议补充了复用行测试。最终完整前端 **146 文件 / 1360 项通过**；类型检查及 Vite 生产构建通过，仅保留既有大 chunk 提示。日志为 `E:/IDEAproject/gitx/test-results/qa048-final-tests-20261120.log` 和 `qa048-final-web-20261120.log`。本项不改变 Rust 逻辑，没有重复此前 492 项 Rust 回归；0.1.41 Windows 构建及原生界面验收继续补记。

## 最终原生复查与恢复

Windows `cargo build --offline -p gitx --features tauri/custom-protocol` 通过，耗时 2m54s，日志 `E:/IDEAproject/gitx/test-results/qa048-final-native-20261120.log`。最终专用程序为 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-visible-edges-0141-20261120.exe`，版本 0.1.41，SHA256 为 `9851C84A96B2AEDD10AA52113E75F0C922E56F64521A3402D6F9E271CA94A793`。PID 25308，创建于 2026-11-20 12:04:36.937895 +08:00；未替换用户安装程序。

通过正常 Welcome 最近项目入口打开 `E:/IDEAproject/gitx/test-results/repos/large-log-qa`，观察加载反馈并展开 Git 面板。最初较窄的 octopus 合并图节点及曲线正常；随后通过 Go to 输入 `qa/side-01`，定位到 40 个侧分支的历史窗口，选中节点自动显示在右侧图形边界内。滑块分别置左端、160px 中段和点击右端，直线与节点正常补绘，行与详情保持不变。窗口从约 1282×802 放大到 1920×1032，再还原时图形列及选中节点可见范围随之调整。选中 side-03 后又以截图坐标选中 side-02，选中行、节点、提交 SHA 和详情一致；一次 +480px 纵向滚轮后贯穿图线继续显示。

本次部分 UIA 文本沿用了旧 slider 值，且一次 UIA 行点击实际落在 side-03；随后以最新截图坐标复核 side-02。报告以实际截图、行高亮和详情为准，不把这些工具读取差异认定为产品缺陷。上述只证明显示和交互行为；未测量此次原生 DOM 数量、持续快滚或输入呈现延迟。两端同时在视口外的正反向跨界曲线保留由正式组件回归证明，没有将窄图原生显示扩大成该边界的原生实测。

正常标题栏关闭后，12:11:15 +08:00 核对测试主进程已退出；本轮没有连续记录子进程身份，不宣称完整后代回收。测试仓库 HEAD、refs、index tree、status 和唯一工作文件 `history.txt` 的 SHA256 均与开始前一致。设置只有 `recentWorkspaces` 改动；比较当前文件与结束快照一致后恢复开始前的精确字节，SHA256 与备份同为 `6DD5D73EAD1F19D1860AE9B143659A0753756E82DFF7B5F5FCCB588693F05335`。

程序身份、前后仓库快照、原生可读文本和设置恢复证据在 `E:/IDEAproject/gitx/test-results/qa048-native-20261120/`。同日只读确认用户 `D:/gitx/gitx.exe` 是外部更新的 0.1.41；没有证据证明它包含本分支 QA-047/048，不能将本次原生测试版等同用户安装版。

本功能代码、完整自动验证和上述原生复查已完成，已独立提交 `00fc31bca9bb8b27855c4a4f94cdb13253204271`。前四次推送分别遇到 SSL 连接重置、SSL 重置、GitHub 443 超时、SSL 重置；没有认证请求，继续重试。2026-11-20 12:20 +08:00 再次成功 fetch，origin/master 仍为 `15413310ea91c5e20ef8d436ef72785f901e1a9c` 且已包含在本分支，远端交付分支最后核对仍为 `0d42d39b7fefdaa0835d0c7768aeb57eb9c30201`。持续滚动性能和整体验收继续保留在 QA-008/034/010，不随本项关闭。

后续第五次推送成功，功能提交与规则记录已随 `9010be968f742f3eb7b8899e8dd7cec116596c6d` 上传；独立 `ls-remote` 返回同一完整 SHA。远端 master 仍为 `15413310ea91c5e20ef8d436ef72785f901e1a9c`。本记录提交前再次 fetch 成功，没有新远端提交。
