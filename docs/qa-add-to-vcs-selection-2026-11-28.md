# QA162：Add to VCS 批量选择

日期：2026-11-28。来源：用户反馈未跟踪文件多选后右键 Add to VCS 只添加聚焦文件。

## 复现与修改

真实 CommitToolWindow、ChangesTree 和 changesStore 的集成回归确认：复选框勾选 `a.txt`、`b.txt` 后右键 `b.txt`，旧实现传给后端的路径只有 `b.txt`。Ctrl/Shift 行多选原本已有完整保留逻辑，问题来自提交勾选与行选区独立，Add 只读取后者。后端原有批量路径接口无需修改。

- 为 Add 单独解析目标，过滤为当前仍在未跟踪分组中的路径并去重；明确的行多选优先。
- 右键单个已勾选未跟踪文件时使用本组全部有效勾选；右键未勾选文件时只添加点击项。Staging 模式忽略隐藏的提交勾选。
- `Git.Add` 快捷键复用相同规则；无未跟踪行选区时可使用未跟踪勾选项。
- 打开菜单时复制 Add 路径，显示批量数量；成功反馈数量。保留其他菜单动作的行选区，不改变提交勾选模型。
- 勾选、选区、仓库导航或状态中目标消失时旧菜单失效；执行前再次核对冻结路径全部仍属于未跟踪分组，覆盖仅 Changelist 元数据变化而 status 未变的情况。异步结果不会向新仓库显示旧成功提示。
- 中英文提交教程补充行多选、勾选批量和快捷键范围规则。

## 验证

新增34项回归：17项真实组件/store集成、17项动作入口。首个勾选集成在旧实现失败；动作旧实现11失败/6对照；仅分组元数据变化的补充回归也在修前失败。覆盖tree/flat、Ctrl/Shift、staging/changelist、目录勾选、Shift+F10、无高亮快捷键、跨组/过期过滤、选区优先、冻结范围、失败、旧按钮及仓库导航。

使用 Node 24.22.3 最终完整前端219文件2579项通过、4项既有probe跳过。第一轮完整回归因三个旧测试mock缺少checkedPaths字段而失败，补齐fixture后通过；未向产品增加mock兼容逻辑。类型/Vite构建、相关lint及双语Pages检查通过。

提交前fetch发现远端新交付 `c159bd9`（Log快照修复）及QA161编号占用。命名stash后快进整合，保留台账两侧记录，本项正式改为QA162；旧证据目录/程序identifier仍用qa161。整合后13文件251项（包含新Log快照和既有调用链）通过；最终类型/Vite/独立Windows构建通过。随后再次同步CI/文档提交 `01a5df2`，无产品源码变化，文档检查通过。保留Vite既有大chunk提示。

## 原生界面与恢复

最终0.1.56独立程序SHA256 `35bff6c6d280c0baff5141dc7f1d1fedbad871a54fb29e14bf60f8a2f609b928`，identifier `app.gitx.qa161add20261128`，专用settings与WebView profile，独立Git仓库。CUA实际点击验证英文浅色平铺列表：勾选alpha/beta，右键beta，菜单显示Add to VCS (2)，执行后两文件同时移到Changes。真实Git索引仅出现alpha/beta，delta/gamma仍未跟踪，tracked.txt仍仅工作区修改；HEAD和全部文件字节保持。

随后单击delta、Shift+Down连选gamma，Shift+F10菜单同样显示(2)；执行后另两项进入Changes，索引精确新增delta/gamma，tracked.txt未暂存。第一次点击后立即读取仍是操作开始状态，等待完成后才核对最终索引。Ctrl多选、树形、Staging、快捷键和精确竞态范围由自动回归覆盖，未逐个作为原生验收；中文未另做原生切换。

初次窗口激活超时，重新选窗后恢复；键盘续验遇helper已有活动请求及要求重新观察，刷新状态后坐标点击恢复。没有用失败动作推断结果。正常关闭后7个记录身份的测试进程全部退出（首次即时检查3个仍在退出，随后核实全部结束）；采集脚本自身进程已从计数排除。只撤回本轮fixture添加，HEAD/index/status/5个文件及个人settings均恢复/保持基线，专用settings归档后移除。用户安装版未修改。

## 基线与交付

初次fetch遇SSL 10054，使用现有系统代理的单次Git参数重试成功；开始基线包含master `50a4802` 和交付 `fa1784b`。分支 `codex/add-to-vcs-multiselect`。测试证据位于 `test-results/qa161-add-to-vcs-20261128`。

本轮新增并解决本项批量选择问题，原9项持续QA保持其原状态。个人安装版未更新；本报告不代表历史持续QA整体完成。功能提交与推送结果见统一台账。

功能提交 `321a6a3634423420d0f742422ac86e119ae5c611` 已首次推送到 `codex/add-to-vcs-multiselect`，远端完整SHA核对一致。补记前再次fetch成功，master与两条交付分支均无遗漏提交。
