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
