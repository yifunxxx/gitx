# QA-091：接通自动 Fetch 与后台写入优先级

日期：2026-11-25。承接QA-089的定时Fetch子项；QA-089其余逐块交互和Shelf文件选择粒度保持开放。本轮开始前成功fetch，基线2937ca3包含master5241dd5（0.1.47）及交付分支最新提交，全程主线程。

## 问题与实现

设置页允许保存`git.autoFetchMinutes`，但原代码没有定时Fetch调用链。真实App根组件加store的初始3项回归中，开启后的2项因调用次数为0失败，关闭对照通过；认证用例也在首次请求断言失败，不能据此称旧版会弹窗。

现在保存1–1440分钟后，对当前活动仓库的所有远端定时Fetch。0关闭；默认仍为0。单次定时器在完成后等待一个完整间隔，不重叠、不补跑遗漏次数；设置、导航、卸载使旧结果失效，手动成功Fetch重新计时。隐藏窗口、离线、无remote及已有任务时延后。后台不会自动调用凭据弹窗；认证错误给出手动Fetch入口，其他失败连续三次后提示一次，错误记录Console，之后按间隔继续尝试。

原手动Fetch在后端持有仓库写锁；自动任务若直接复用，慢网络会阻塞用户写入。新增后台模式使用相同的canonical/common-dir锁，已有前台写入时放弃本次后台执行；后续同仓库写入取消后台请求，再等待其返回并释放许可。跨worktree、submodule与路径别名沿用已有锁范围；不相关仓库不取消彼此任务。后台任务在原生JobManager注册、可从队列取消；Fetch完成或失败均收尾。GitRunner已有非交互askpass/GCM策略保持。

已发出的后台Fetch在关闭设置、导航或前端卸载后可能仍完成，其网络工作有既有600秒上限；本轮保证取消后续定时与过期界面回填，不声称跨IPC即时撤回。调度由当前应用窗口拥有，关闭程序后不继续运行。它只更新远程引用，不合并分支或编辑工作区；用户安装版不因本轮测试更新。

## 验证记录

- 初始旧实现3项：2失败/1通过，失败位置均为未发起Fetch。
- 修后应用级18项：间隔、暂停/恢复、无remote/非仓库、慢请求、防重、手动重置计时、设置变化、切仓/同路径重开、卸载、凭据/网络失败/取消及旧通知归属。
- 定向6文件90项、完整186文件1857项、类型检查、Vite构建与相关lint通过。
- Rust新增4项通过：已有写入时不排队、前台抢占并等待后台返回、不相关仓库隔离，以及真实Git向loopback慢HTTP服务Fetch时，被linked worktree写入取消。后者确认原HEAD和工作区状态保持，写入成功。
- 双语文档检查及构建通过。首次检查发现功能索引由脚本生成，已同步修改生成器与产物后复验。
- `cargo test -p gitx-git --lib --tests`完整范围51组、411通过、0失败、7项辅助用例保持ignored；这不是整个workspace所有包的全量回归。
- `cargo clippy -p gitx-git -p gitx -- -D warnings`、`cargo fmt --check`、Windows debug/no-bundle构建通过。绑定从本轮程序真实导出，差异限于FetchRunReq字段/注释，导出后再次类型检查通过。
- 主线程复核timer/watch/事件清理、同路径重开、共享common-dir优先级与过期回填。新增refresh回调参数的所有调用点均为显式函数调用，未找到将MouseEvent直接传入的模板事件绑定，不将候选记为已复现缺陷。

证据目录：`E:/IDEAproject/gitx/test-results/qa091-auto-fetch-20261125`，含`before.log`、`targeted.log`、`all-tests.log`、`build.log`、`lint.log`、`rust-background.log`、`rust-all.log`、`rust-summary.json`、`clippy.log`、`fmt.log`、`native-build.log`、`generated-typecheck.log`、`docs-build.log`与隔离fixture。文档检查覆盖44页、72命令、33设置。

## 原生验证与收尾

独立标识`app.gitx.qa091`、独立profile、本地bare仓库及loopback 401服务，不使用用户仓库。专用程序SHA256为`E138A15EF632E11F9635FE7019D70DB2FA37182E0C37D883540D9935725DFB8C`；构建后的产品逻辑未再改变，仅scheduler注释调整。

- 保存1分钟自动Fetch后，未手动点击Fetch，Log出现远程新增提交、main显示↓1，磁盘origin/main由`17349f2`更新为预期`ae933e9`，本地HEAD与readme修改保持。
- 隔离upload-pack延迟下观察到左下角Auto Fetch、Running与Cancel；点击Cancel后队列回Idle，无取消错误提示。它是交互观察，不是滚动/输入延迟测量。
- 将测试origin临时指向本机401服务后，出现“Auto Fetch needs credentials — fetch manually to sign in”及Fetch now/Dismiss，没有凭据对话框；未自动化认证或点击Fetch now。服务器仅记录计数/时间，不保存headers或凭据。
- Settings > Git将间隔改为0并保存，磁盘设置确认为0，随后75.093秒内HTTP请求计数保持6，超过原定1分钟间隔；队列Idle。设置弹窗正常打开，没有确认新的按钮缺陷。
- 正常关闭专用程序后，7个已记录原生进程身份均退出；按PID/启动时间/路径核对并停止测试Node服务，55506端口无监听。不声称记录了每个瞬时Git子进程身份。
- fixture远端恢复本地remote.git，移除本轮延迟及credential.helper/http.proxy局部测试配置，专用自动Fetch保持关闭。HEAD、index tree、index字节、readme哈希、status及用户真实settings哈希保持；远程引用保留预期Fetch更新。保留fixture/证据，用户安装版未替换。

详细现场为证据目录内`native-observations.md`、`native-fetch-success.json`、`native-disabled-before.json`、`native-disabled-after.json`及`final-verification.json`。离线/隐藏恢复、切仓/卸载精确竞态及前台写入抢占保留自动回归边界，不宣称全部已原生逐项测量。

## 交付

本项代码、自动测试及上述原生路径已完成。续办时首次fetch遭SSL连接失败，单次HTTP/1.1重试成功；提交前再次fetch成功，master仍为5241dd5、交付仍为2937ca3且已包含。未在同步失败期间开始其他优化。独立提交推送结果随后补记；QA-089中的自动Fetch子项由本报告覆盖，其余逐块交互与Shelf粒度继续，整体七项目标未关闭。已知12项列表不因拆出QA-091重复计数。
