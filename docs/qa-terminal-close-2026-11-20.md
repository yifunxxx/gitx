# QA-046：Windows 终端输入阻塞时的关闭清理

日期：2026-11-20。来源：终端生命周期静态审阅及隔离真实 ConPTY 复现。该问题独立于 QA-040 的静置 CPU 线索。

## 现象与复现

终端 `write` 持有 writer 锁执行同步 `write_all`；显式关闭和 shell 退出回收都先等待该锁，再关闭 ConPTY。大量输出使后端有界队列积满，且终端中的程序没有读取输入时，输入管道也可能填满。此时关闭已经从 registry 移除会话并终止 shell，但写线程无法返回，清理也到不了关闭 ConPTY 的步骤。

在专用后端 probe 中使用产品 `terminal.rs` 的副本，并添加仅用于诊断的状态观测；所有测试根进程加入独立的 KILL_ON_JOB_CLOSE Job，内置22秒 watchdog，外层28秒超时。fixture和日志位于 `E:/IDEAproject/gitx/test-results/qa046-terminal-20261120/`，没有通过 GUI 输入终端命令。

| 场景 | 修改前观察 |
| --- | --- |
| 高输出子进程，64KiB输入分片 | close等待3秒超时，shell已结束、session已移除，writer锁仍被占用且master仍存在；终止子进程后再次等待仍超时。 |
| 高输出子进程，前端实际8KiB分片，第1轮 | 已完成38片/311296字节，输出队列130864字节；close和write均不返回。 |
| 相同8KiB场景，第2轮 | 已完成5片/40960字节后阻塞，close在shell结束后仍超时。 |
| 不输出的idle后端对照 | close在3秒内返回，writer/master释放。该对照是后端压力控制，不等同于前端单次粘贴。 |

两轮8KiB失败时完成的输入量均低于前端1MiB待发送队列上限。它们使用实际 ConPTY 和同步写入，证明的是这个隔离背压场景；并未把固定复现所需字节数当成产品阈值。

## 修改

Windows 在等待 writer 锁前先取出并在锁外释放 master，让 ConPTY 关闭输入管道并解除在途写入。显式关闭和 shell 退出共用这个释放入口。输出队列停止后，Windows读取线程继续读并丢弃至EOF，避免关闭过程中的末尾屏幕输出再次堵住管道；关闭前已经入队的输出继续保留。

Unix reader/writer持有独立的master文件描述符，writer析构还有EOF写入行为；本次保持原先顺序及读取停止行为，没有宣称解决Unix的同类饱和输入问题。

本机为 Windows 11 Insider Preview，OS `10.0.26340.10013`，conhost `10.0.26100.10013`。旧Windows的同步关闭和排空路径不能由本机成功结果代替原生验收。

## 验证状态

隔离修复副本的两轮8KiB高输出场景均能完成close：包含后续救援检查的总计时为58ms、56ms，没有外部终止helper；write返回管道关闭错误，writer/master均释放。idle对照也通过。该计时不是用户点击到呈现的延迟，也不是单独close调用的精确耗时。

正式回归在原实现上为5项通过、2项失败：持writer锁时ConPTY没有先释放；关闭输出队列后仅读取8192字节即退出，未读完24577字节模拟PTY输出。反证日志为 `formal-before/test.log`。锁顺序测试在断言前释放其持有的writer锁，原实现失败也能退出；它验证master已取出，实际析构解除管道阻塞由真实ConPTY压力probe补充验证。

最终源码probe增加了读取线程引用释放检查，三条路径均在3秒限时内完成：

| 路径 | close调用加线程分派耗时 | 结果 |
| --- | ---: | --- |
| 高输出时主动close | 54ms | 在途write返回管道关闭错误，reader释放output引用，writer/master清空，无外部救援终止。 |
| shell已经退出后close | 40ms | close前已观测process_done，同样完成write/reader/PTY释放。 |
| 高输出会话与另一个会话一起shutdown | 55ms | 两会话的writer/master均清空，shutdown返回并移除登记。 |

这些计时来自后端测试线程，包含分派和同步，不是GUI响应时间。数据为 `flood-8192-final-1/result.json`、`flood-shell-exited-final-1/result.json`、`flood-shutdown-final-1/result.json`。

最终正式7项全部通过，包含新增锁顺序/排空回归以及正常shell退出的尾部输出标记和退出码7。尾标记由命令运行时拼接，输入本身不存在完整标记，避免命令回显单独满足断言。`formal-final.stdout.log` / `formal-final.stderr.log` 记录通过结果；格式检查与独立审阅通过。

后续带进程身份采样的四场重复验证为主动close、shell预先结束、双session shutdown和idle，对应close加线程分派49/42/41/139ms，均通过。各场在压力阶段采样的5个PID与创建时间，在probe退出后都不存在相同身份，证据位于对应 `*-final-identity/processes-before-exit.json` 和 `processes-after-exit.json`。shutdown的第二个session在采样后创建，由session释放字段及隔离Job兜底，不把5个采样身份描述为所有短命进程的完整枚举。

`readerWorkerReleasedOutput` 根据output的Arc计数恢复为仅session持有一份，证明输出worker已释放其引用；不单凭该字段证明waiter线程已经全部退出。shell预先结束场景由probe终止shell后等待其waiter进入，不是自然退出；自然退出由正式exit7用例覆盖。

`final-source-evidence.json`确认probe除诊断函数与测试外的生产控制流与最终源码一致。最终 `terminal.rs` SHA256为 `5B44D4BE9118972C58037D3DB4A29D25B75825312121ABF615B5FA89D3D1EEF1`。

完整Rust工作区回归通过：78个测试/文档目标汇总492项通过、0项失败、7项辅助子进程fixture按既有配置忽略，退出码0。日志 `E:/IDEAproject/gitx/test-results/qa046-final-rust-20261120.log`，汇总 `full-rust-summary.json`。相关终端7项在整套回归中也通过；本次产品未改前端，保留此前QA-044/045的144文件/1333项与类型/Vite证据，不称本次重新运行了前端。

Windows原生构建通过（2分27秒），日志 `qa046-final-native-20261120.log`。保存的程序为 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-terminal-close-0140-20261120.exe`，SHA256 `4B147C6E4523C68D99A01962E1E8452BFB03FD3392029009725DF2CD5DC3CA07`；本次最终程序未再执行GUI启动验收。本次没有终端GUI粘贴/Ctrl+C实测，QA-007保持独立验收边界。用户安装版未更新。

## 证据索引

- `flood-before-1/result.json`：64KiB原始失败。
- `flood-8192-before-1/result.json`、`flood-8192-before-2/result.json`：实际分片大小的两轮失败。
- `idle-8192-before-1/result.json`：无高输出的正常控制。
- `flood-8192-after-1/result.json`、`flood-8192-after-2/result.json`、`idle-8192-after-1/result.json`：隔离修复副本结果。
- `formal-before/test.log`：正式新增回归在原实现上的两个失败。
- `flood-8192-final-1/result.json`、`flood-shell-exited-final-1/result.json`、`flood-shutdown-final-1/result.json`：最终产品源码副本的关闭、shell已退出和多会话清理。
- `flood-8192-final-identity/`、`flood-shell-exited-final-identity/`、`flood-shutdown-final-identity/`、`idle-8192-final-identity/`：四场重复验证、PID与创建时间核对；`final-source-evidence.json`：最终源码一致性。

功能提交和推送状态待实际完成后写入统一台账。
