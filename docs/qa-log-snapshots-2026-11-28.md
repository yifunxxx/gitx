# QA161：Log 刷新遗漏提交元数据

日期：2026-11-28。读取台账并 fetch、整合 master 与交付分支成功，基线 `fa1784b77715376e0ef142af8fb2dd96f77267aa` 包含 master `50a4802dd23f61055668e165f6fe7c0b93b17680`；续轮同步无新提交。全程主线程。

## 发现与修复

原 `sameCommitWindow` 仅比较 SHA、标题、作者时间与引用。相同显示 SHA 的提交经 Git replacement 更新后，父提交或作者仍可能不同；旧判等丢弃新载荷，让列表、提交图线和第一父提交导航继续使用旧值。即使发布新行，背景刷新原来也不会重新读取已选提交的详情。

独立仓库实际创建了四条历史及两个 replacement 对象，再用 `git replace -f` 切换。读取格式、排序、装饰排除与 `GitRunner::log_page` 一致，并显式筛选 `main`，避免默认 `--all` 把替换引用自身也列入结果。两份四行快照的 SHA、标题、时间、refs 与行序一致，而顶部作者由 Before 变为 After、邮箱更新、两个父提交顺序反转。没有把浅克隆推测当作已复现缺陷。

修复逐项比较 `LogCommit` 的 SHA、shortSha、subject、author、authorEmail、authorTime、parents 与 refs，数组顺序也参与比较。后端 graph 是固定占位，前端根据提交关系生成图线，不参与判等。相同数据保留原数组；仅可观察元数据有变化的当前选中行重新读取详情及变更文件，保持多选范围和锚点，并使旧详情请求失效。refs 或其他行变化不触发该详情重读。详情异步等待与失败重试沿用已有任务和错误状态，不阻塞列表。

比较为线性遍历，不新增缓存或序列化整个页面。这是刷新正确性修复，不解释 QA008/034 的历史秒级输入断档；也不声称 LogPage 能检测其契约未携带的正文、tree 等字段单独变化。

## 验证

- 新增 store 回归 22 项：旧实现 20 失败、2 对照通过；修后全部通过。覆盖父顺序/增删、作者/邮箱/短 SHA、前台/后台刷新、相同快照保持、其他行/refs 变化、范围锚点、慢详情、旧请求覆盖、换选择/仓库/销毁和失败重试。初始测试详情 fixture 的 `commitTime` 经类型检查前审阅改为契约的 `committerTime`，短 SHA 仅按列表字段断言；不计为产品缺陷。
- 真实 LogView 新增图线/树形两项，验证作者更新、图线变化、左键方向导航至新第一父，以及随后相同刷新不重复构图。相关首次 90 项、扩展后最终 92 项通过。
- 完整前端 218 文件、2569 项通过、4 项既有 probe 跳过。末轮仅缩减相同刷新查找旧选中行的次数，重新运行相关 92 项及类型/Vite 构建通过；完整回归保留该阶段边界。相关 lint、新测试格式、diff 空白和双语 Pages 检查通过，Vite 仍有既有大 chunk 提示。本项没有后端源码变化，未重复完整 Rust 回归。
- Chrome 158.0.8127.37，真实 store、LogView、VirtualList、graphLayout、CSS 与翻译，其他 store/后端受控；载荷来自上述真实 Git 输出。旧/新 × 图线/树形 × 英文浅色/中文深色，共 8 场。旧版均保留 Before 与旧第一父，修复版均更新 After、详情邮箱/父序及导航，图线模式实际 SVG 更新；相同数据前后保留快照，没有额外详情读取或图线调用，无 pageerror。最终缩减查找后完整重跑 8 场。
- 浏览器 harness 首次缺少 TooltipProvider 导致挂载失败，补上与产品相同的 provider 后重跑；一次 Python stdin 中文编码失败未写入文件，改用补丁更新台账。这些是验证工具问题，不计产品缺陷。

## 原生与交付

最终 Windows 程序 SHA256 `fa31427a50442dc2fd9f8b359689f87accb01c6893de68fe82bb13d3a4540edd`，identifier `app.gitx.qa161logsnapshots20261128`，使用独立 settings/profile 和上述四提交仓库。

CUA 逐动作展开 Log、输入并应用 `main` 筛选，确认 Before、邮箱及父序 `69433b6, b213ed8`。保持顶部提交选中，外部实际切换 replacement 引用后，未点击刷新或重新选择，后台自动更新为 After、邮箱和父序 `b213ed8, 69433b6`，图线同步改变。随后点击该行并按左方向键，选择正确的 `right / b213ed8`，显示详情读取任务后回 Idle。

从 right 按 Shift+Up 选择顶部与 right 两行，外部恢复原 replacement 后，Before、邮箱、父序和图线恢复，两行选中范围保留；再按 Shift+End 只选 right/left/base 三行，确认锚点仍是 right。真实精确失败/迟到竞态保留自动回归边界；原生仅验证图线模式，树形已由真实组件和浏览器验证。

8 个记录创建时间及路径的测试进程自然退出，首次立即检查仍在收尾，稍后全部退出，无强杀。HEAD、分支、引用、index、status、文件和个人 settings 核对一致，专用 settings 归档移除；旧 QA007 窗口未操作。用户安装版未更新。

本轮新增并解决 QA161，回到原 9 项及整体七项目标继续。提交前再次 fetch 并整合 master/交付分支成功，无新提交；提交和推送结果见统一台账。

证据根：`E:/IDEAproject/gitx/test-results/qa161-log-snapshots-20261128`。包含真实 Git fixture/两份快照、旧 store、回归与构建日志、浏览器脚本/结果及 8 张截图。原生逐动作截图保留在聊天工具记录中。

功能提交 `6f11702e7608cf96a8d2bdb537ecf4c67b52f7e3` 已首次推送至 `codex/checkout-target-safety`，ls-remote 完整 SHA 一致，无凭据提示。补记前再次 fetch 并整合两分支无新提交；430 处报告链接与双语 Pages 检查通过。
