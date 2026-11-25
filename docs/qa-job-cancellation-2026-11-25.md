# QA-092：取消中的任务等待真实结束

日期：2026-11-25。开始前fetch成功，基线6c5b208包含master5241dd5及交付分支最新提交，工作区干净，全程主线程。承接QA-091后对共享任务队列继续审阅，不改变自动Fetch间隔逻辑。

## 问题与修复

`JobManager.cancel`只触发取消token，任务仍可进行收尾；`jobsStore.cancel`却在IPC返回true后直接`finished`，导致队列提前显示Idle，后续jobList还可能重新显示该任务。取消IPC等待期间按钮也没有共享防重。新增初始3项回归全部失败，分别覆盖提前清空、取消中反馈和无效入口保护；这不表示三个独立产品bug，也不是原生慢取消的自然复现。

现在发出取消请求时立即记录取消中状态，任务列表与状态栏显示“正在取消…”，取消按钮禁用。请求被接受后继续保留任务，直到完成事件或新的原生列表确认它消失。后台进度、重复started事件和弹层重开保留该状态。取消失败恢复可重试，保留原有错误提示。

每次取消有独立请求身份，完成、列表确认消失或store销毁后，旧成功/失败均不改变新状态或显示迟到错误。相同ID在真正结束后重新开始也不受旧请求影响；其他并行任务独立。取消状态转变使更早发出的列表读取失效，防止旧快照擦掉等待状态。取消记录随完成/列表同步/销毁释放，没有新增轮询或定时器。沿用既有原生完成事件和30秒漏事件校准；事件遗漏时仍需等待列表确认，不能用取消受理代替任务结束。

## 自动验证

- 初始正式旧实现3项失败；修后新增store12项，覆盖接受后保留、同步防重、缺失/不可取消目标、false/错误重试、迟到成功/失败、同ID新任务、重复事件、重开、列表交叉、并行隔离与销毁。
- JobsPopup新增2项真实组件回归，验证立即禁用、重开保持、错误重试、完成后空列表和迟到错误不提示；StatusBar新增1项验证取消中状态及结束后Idle。
- 定向6文件47项通过，含原useAppEvents和AutoFetch回归；完整187文件1872项通过。
- 类型检查、Vite生产构建和相关Oxlint通过。首轮小范围使用系统Node20给出engines警告；正式定向/完整/构建已加载仓库测试环境的Node运行时。
- Windows debug/no-bundle构建通过；中英文队列教程同步说明真实结束、取消中与失败重试，并纠正原有“展示已完成历史/Failed固定状态”的描述。双语文档44页检查和构建通过。
- 本项仅改前端，未改Rust或IPC绑定，不将上一轮Rust411项写作本项重新执行。

## 原生与交付

独立`app.gitx.qa092`、独立profile和本地测试仓库。原生程序SHA256为`F31450D1A85E01D0B55F649A038CA95F2D72CB8C86B41ADD7C9DC5613435C6F3`。深色主题下，既有任务浮层自动显示到期Auto Fetch的标题/仓库/Running及Cancel；点击取消后，后续截图与UIA均显示Idle/No running processes，无错误提示。

本次真实取消结束很快，截图未捕获中间“正在取消”阶段；不能将普通完成观察冒充慢取消/精确回执时序证据，后者由受控回归证明。未做原生逐帧测量或故障注入。正常关闭程序后，14个已记录原生/WebView/ConHost/Git/sh进程身份全部退出；不声称记录了所有瞬时子进程。fixture移除延迟配置，专用自动Fetch关闭；HEAD、refs、status、index tree及字节、readme和用户真实settings哈希保持。用户安装版未替换。

证据目录：`E:/IDEAproject/gitx/test-results/qa092-job-cancellation-20261125`，含`before.log`、`initial-fix.log`、`targeted.log`、`all-tests.log`、`typecheck.log`、`build.log`、`lint.log`、`native-build.log`、`docs-build.log`、`native-observations.md`、`running-job-identities.json`、`final-verification.json`和隔离fixture。

本项代码、自动验证及上述原生普通流程完成；提交前再次fetch成功，master5241dd5及交付6c5b208均已包含。单独提交推送结果随后补记。新增并解决QA-092，回到原12项已知未关闭，整体七项目标继续，不用测试数量换算完成率。
