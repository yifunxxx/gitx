# QA-032 Smart rebase 取消回归的等待超时

日期：2026-11-17。状态：原始异常待核查；本轮只改善测试清理和诊断，没有修改产品代码。

## 原始失败

完整 `cargo test --workspace --locked --no-fail-fast` 中，`smart_rewrite` 的 `cancelling_a_running_smart_rebase_restores_changes_if_no_sequence_started` 等待 `.git/smart-hook-started` 超过 15 秒；同组其他 10 项通过。报错来自测试第 470 行的等待断言，尚未验证操作取消后文件、索引和 Stash 恢复结果。

原始日志：`E:/IDEAproject/gitx/test-results/workspace-0137-20261117.log`。日志没有记录普通/交互式分支、hook 到达耗时和操作提前返回结果，无法仅凭它确定是调度/进程负载还是产品错误。

完整运行已结束，退出码 101。按顶层 Running / Doc-tests 段核对 77 个目标，每段均有一个最终结果：486 项通过、1 项失败、5 项忽略；唯一失败目标是 `-p gitx-git --test smart_rewrite`。5 个忽略项是父测试显式启动的子进程装置，不作为未运行的产品用例。QA-023 对应的 `unshelve_safety` 本轮 6 项通过，没有复现原 Shelf 异常。

## 定向核查与测试修改

- 不修改测试前先单独执行原测试，通过；执行时间 29.81 秒，包含普通和交互式两种场景。日志 `smart-cancel-isolated-20261117.log`。
- 旧测试在超时后先 cancel，再立即 expect/panic，使 `join!` 中操作未来被丢弃，没有给取消后的恢复流程执行完毕的机会。该行为属于测试装置问题，不是产品取消恢复的失败证据。
- 改为在 hook 事件和操作完成之间选择；操作提前结束时直接报告实际结果。到达 hook 或等待截止后取消，并 await 操作恢复完成，再做断言。
- 准备阶段需要串行执行状态检查、安全备份和 Smart Stash 等多个 Git 进程，单独保留 60 秒硬截止；这不是对产品命令增加重试或延长命令超时。原有 Cancelled、HEAD、工作区/暂存内容、Stash 和恢复标记清理断言全部保留。
- 每种模式输出 hook 到达时间、总耗时和返回结果，便于下次失败判断是否达到取消测试的前置条件。

## 复查证据与限制

以 11 个测试并行运行整个 `smart_rewrite` 组，11 项全部通过，总耗时 93.21 秒，日志 `E:/IDEAproject/gitx/test-results/smart-cancel-diagnostic-20261117.log`。普通模式 hook 在 11.237 秒到达、总计 24.632 秒；交互模式 11.587 秒到达、总计 19.925 秒。两种结果均为 `Cancelled`，后续 HEAD、文件、索引语义、Stash 和恢复记录清理断言通过。修改文件的 rustfmt/diff 检查通过。

这些测量没有再次超过原 15 秒截止，不能据此确认首次超时根因。QA-032 保持待核查，不把这次测试装置改善写成已修复产品缺陷。用户安装版未更新，也没有原生 GUI 取消测试的新证据。

本次测试改进、完整回归结果及阶段验收记录已独立提交 `798e6502893e7159238bc1cca17ee09b72f1e47d` 并推送，经 `ls-remote` 核对远端一致。

2026-11-26后续证据：0.1.48基线e55508d的[完整工作区组合回归](qa-combined-validation-2026-11-26.md)中，smart_rewrite 11项全部通过，27.14秒；本次未复现原超时，不据此认定首次根因已修复，也没有额外无界重跑。

## 2026-11-28：Git 准备阶段时序

已同步基线 `fc25b1bd98f6b46742f6658cdb38172a6aa046cb`（0.1.56，含 master `50a4802dd23f61055668e165f6fe7c0b93b17680`）。本轮不修改 Smart 产品或测试逻辑，只在独立测试 shell 中设置 `GIT_TRACE2_EVENT`，执行一次原取消测试：1 通过、10 过滤，18.24 秒，普通与交互式均返回 Cancelled；HEAD、status、暂存/未暂存/未跟踪内容、空 Stash 及恢复 marker 清理断言全部通过。

证据目录：`E:/IDEAproject/gitx/test-results/qa-historical-failures-20261128`。原始 `smart-trace.log`、`smart-trace.jsonl`，可重算脚本 `analyze_trace.py`、`summarize_smart_phases.py`，结构化结果 `smart-trace.summary.json`、`smart-phases.json` 均保留。分析器严格读取 JSONL，按完整 session ID 分组，顶层进程 112 个、嵌套 session 42 个；嵌套耗时不再计入父进程。两次被取消的 rebase 没有 exit 事件，作为不完整区间保留，不能直接据此判定进程残留。

| 模式 | 测试计时的 hook 到达 / 操作总耗时 | rebase 前顶层 Git 调用 | 首个准备 start 至 rebase start | 其中已记录 start–exit 区间总和 | 区间外时间 |
| --- | --- | --- | --- | --- | --- |
| 普通 | 2.5657582 / 5.5580536 秒 | 13 | 2278.418 ms | 1012.571 ms | 1265.847 ms |
| 交互式 | 3.0023726 / 5.9213893 秒 | 17 | 2797.554 ms | 1136.958 ms | 1660.596 ms |

边界根据测试/产品调用顺序与命令参数匹配：普通为摘要第 21–33 号进程、交互式为第 75–91 号进程（均从零开始），随后第 34/92 号启动主 rebase。脚本验证准备区间完整、顺序且互不重叠；不把 fixture 创建、计划生成及取消后的恢复调用放入该准备区间。

北京时间 2026-11-28，普通首个准备 start 为 07:42:04.593433，rebase start 为 07:42:06.871851；交互式为 07:42:13.504312 至 07:42:16.301866。原始 Trace2 时间是 UTC，以上已换算 Asia/Shanghai。

准备调用包括序列状态检查、安全备份引用、stash create、Smart stash push/list 等。区间外时间同时可能包含 Git 首条 trace 之前的进程启动、父进程处理、IO 和调度；它不是 Rust CPU 时间，也不是已确认的空等。测试 hook 计时起点早于第一条 Git start，两者不能直接相减解释为单一阶段。Git 版本为本机 `2.34.1.windows.1`，Trace2 还有额外写盘开销。

本次没有复现原 15 秒超时，也没有取得原失败时的阶段数据。QA-032 保持待核查；没有删减安全备份/检查、延长现有截止或加入重试。下一次异常需要保留同类 trace、模式及 hook 到达信息，再定位超时停在哪一段；本轮的正常结果不足以关闭历史异常。定向测试进程已退出，没有新增原生 GUI 验收，安装版未更新。
