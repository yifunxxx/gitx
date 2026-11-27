# QA-023 Shelf 偶发未找到记录的续查

状态：待核查。日期：2026-11-17。没有确认根因，没有修改产品代码。

## 已知失败

原始日志 `E:/IDEAproject/gitx/test-results/shelf-retention-git-main.log` 第 540–550 行记录：`binary_unshelve_roundtrip_retains_unrelated_staged_changes` 在 unshelve 时收到 `NotFound: Shelf entry not found`，同组其他 5 项通过。原日志没有输出失败时 common-dir 和目录清单，不能从它确定记录在哪里丢失。

当前测试已经在错误分支输出 Shelf ID、cwd、common-dir 及 Shelf 目录清单；保留该诊断，不增加吞错或盲目重试。

## 本次检查

- 代码路径中，FixtureBuilder 为每个测试创建独立 TempDir；二进制测试本身不调用到期维护。shelve 成功返回后才调用 unshelve。
- Shelf 创建经暂存目录写入完整 metadata/patch 后 rename 发布；读取在同一 metadata 锁中执行。`Shelf entry not found` 对应条目目录检查为缺失；metadata/patch 缺失和解析错误有其他错误信息。
- `git_common_dir` 对当前仓库执行 Git 查询，未看到全局工作目录切换或共用查询结果缓存。现有信息不足以归因于保留清理、跨测试混用或 Windows 文件系统瞬时异常。
- 主分支 `92402cc` 修复的是另一条等待锁测试的时序，不是本问题的证据。

## 有界重复验证

在当前 0.1.37 分支运行 12 轮：

```text
cargo test -p gitx-git --locked --test unshelve_safety -- --test-threads=6
```

每轮均为 6 通过、0 失败，包含二进制恢复和无关暂存内容保护。共 72 次执行，单轮约 12–18 秒。日志：`E:/IDEAproject/gitx/test-results/shelf-023-repeat-20261117.log`。

本结果仅说明在此次并行复跑中未复现，不能证明偶发问题已修复。前一轮 `shelf_retention` 9 项及 `unshelve_safety` 6 项通过见 `shelf-0137-rust.log`。不因重复通过而删除历史异常或继续无界重跑。

## 下一步与交付

QA-023 保持待核查。若再次失败，先使用已有失败诊断确认 common-dir 与实际目录是否一致，再区分写入发布、外部删除或读取异常；在得到可重复证据前不加入可能掩盖数据丢失的重试。

本次仅提交核查证据与台账，安装版未替换。提交推送结果见后续台账及本任务 Git 输出。

2026-11-26后续证据：0.1.48基线e55508d的[完整工作区组合回归](qa-combined-validation-2026-11-26.md)中，unshelve_safety 6项全部通过，5.32秒；本次没有额外循环压力测试，没有新的根因线索，仍保留待核查状态。

## 2026-11-28：分阶段诊断与一次定向 Trace2

开始及恢复工作时均已 fetch 并检查 master/交付分支，基线 `fc25b1bd98f6b46742f6658cdb38172a6aa046cb` 包含 master `50a4802dd23f61055668e165f6fe7c0b93b17680`（0.1.56），无新提交。

此前的错误分支是在失败后重新执行 Git 查询并读取目录，不能说明 Shelf 成功返回时是否在同一路径。现仅改 `crates/gitx-git/tests/unshelve_safety.rs` 中的诊断：

- shelve 前保存 fixture 预期 `.git` 路径及实际 Git common-dir 查询结果；成功返回后、unshelve 前分别立即保存原路径的快照及相对时间。
- 失败时先检查原路径，再检查 fixture 预期路径，最后重新查询 common-dir 并检查新路径。捕获的早期字符串不会被失败后的目录状态覆盖。
- 快照包括 common-dir、gitx、shelf、条目、meta.json、changes.patch 的类型/长度或 IO 错误种类与系统错误码、规范化路径及最多 33 个 Shelf 根目录条目名。没有读取补丁或正文内容，没有增加重试或改变恢复断言。
- 这些检查是顺序采样，并非原子文件系统快照；提前增加了一次 Git 查询和少量目录读取，可能扰动时序。成功返回后的快照只说明此前解析路径上的观察结果，不冒充产品内部发布瞬间的路径记录。新的实际失败分支本轮没有触发。

本轮重新阅读发布代码与本机锁定依赖 tempfile 3.27.0：发布使用目录 rename，TempDir Drop 仍按保存的旧 staging 路径调用 remove_dir_all；没有看到它跟随已发布的新 UUID 路径清理的代码。不将此候选猜测当作历史缺失的根因。

证据目录：`E:/IDEAproject/gitx/test-results/qa-historical-failures-20261128`。

| 验证 | 结果 | 日志/产物 |
| --- | --- | --- |
| 修改前二进制 roundtrip，启用 Git Trace2 | 1 通过、5 过滤；执行 3.79 秒 | `shelf-before.log`、`shelf-trace.jsonl` |
| Trace2 只读分析 | 27 个顶层 Git 进程均有 exit，排除 2 个嵌套 session | `analyze_trace.py`、`shelf-trace.summary.json` |
| 修改后完整 unshelve_safety，6 并行 | 6 通过、0 失败；执行 5.42 秒 | `shelf-diagnostics.log` |

最初未载入工具链的 shell 没有找到 cargo，未启动测试，不算测试失败。Git 为本机 `2.34.1.windows.1`；Trace2 有观测开销，本轮耗时不与旧完整并行回归直接比较。Rust fmt/定向 Clippy 和文档检查结果见台账，本项不需要重跑未改动的前端或打包安装程序。

QA-023 继续待核查，没有新增已确认产品缺陷或产品修复。再次失败时，优先根据三阶段快照区分原路径从未出现、发布后消失、common-dir 改变或检查失败；不再以相同条件反复跑绿替代根因调查。安装版未更新，个人 settings SHA256 保持 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。交付状态见统一台账与 Git 提交。
