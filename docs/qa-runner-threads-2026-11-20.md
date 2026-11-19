# QA-034：Windows Git 命令启动的固定开销

日期：2026-11-20。接续大列表并发刷新调查，单独修复执行器的线程查找成本，保留整体性能验收边界。

## 发现与方案

`GitRunner` 的每次 Windows 命令先挂起创建子进程，再加入带关闭清理标志的 Job，最后恢复子进程。原实现用 `CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0)` 获取全系统线程并逐项查找；本机约6000线程时，这个步骤为每次 Git 查询增加明显固定成本。真实 runner、直接 Tokio 和拆分 ProcessJob 阶段的只读对照定位了该成本，没有证明此前全部界面负载都来自这里。

改用 `PssCaptureSnapshot(PSS_CAPTURE_THREADS)` 查询目标子进程的线程。保留挂起创建、先入 Job 后恢复、取消/超时/放弃调用清理子孙的顺序。打开线程句柄后检查其所属进程，避免恢复被复用到其他进程的线程 ID；无法捕获、遍历或确认归属时返回错误。PSS 接口直接返回 Win32 错误码，不能误用 `GetLastError`。

Snapshot 与 walk marker 分别使用对应释放函数的 RAII 包装，析构不 panic；marker 先于 snapshot 释放。PSS 描述符归当前捕获进程所有，`PssFreeSnapshot` 使用当前进程。原 runner 的 `kill_on_drop` 和 Job 清理保持，错误路径不会把挂起子进程留给调用方。

没有改用直接 Tokio 运行，也没有采用未公开的进程恢复 API。当前项目 Rust 1.90，不为本项引入更新工具链或不稳定的进程创建接口。PSS 最低支持 Windows 8.1 / Server 2012 R2，当前项目运行文档面向 Windows 11。

官方依据：

- [PssCaptureSnapshot](https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/nf-processsnapshot-psscapturesnapshot)
- [PSS_CAPTURE_FLAGS](https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/ne-processsnapshot-pss_capture_flags)
- [PssFreeSnapshot](https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/nf-processsnapshot-pssfreesnapshot)
- [PssWalkSnapshot](https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/nf-processsnapshot-psswalksnapshot)
- [GetProcessIdOfThread](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocessidofthread)

## 前期对照

同一小 blob 的18次只读查询，三模式同轮运行，输出逐次相等：

| 模式 | 总墙钟 ms | 父进程 CPU ms | attach/resume ms |
| --- | ---: | ---: | ---: |
| 直接 Tokio 对照 | 1565.8 | 140.625 | 0 |
| 原 ProcessJob | 2867.2 | 1375 | 1308.9 |
| 外部 PSS 候选 | 1647.0 | 62.5 | 3.6 |

这是 debug、单机、小 blob 的执行器测量。CPU 仅记录探针父进程，不含 git 子进程，短区间存在计时颗粒度；不能视为原生滚轮延迟或全部操作加速比例。

外部安全探针确认原实现和候选在恢复前150ms均未执行子进程标记；cancel 和 Job drop 均清理 root/grandchild。31次成功读取中，每5次抽样的句柄数均为112，PSS和marker释放返回码成功。句柄不增长不能单独证明所有堆内存无泄漏。

## 最终实现同轮对照

将原实现固定为 `1f25a44` 源码，最终 ProcessJob 直接 import 当前工作区文件，另通过工作区依赖调用真实 GitRunner。3轮轮换顺序、每模式每轮6次，72次命令的stdout/stderr/退出状态全部一致。

| 模式 | 18次总墙钟 ms | 父进程 CPU ms | attach/resume ms |
| --- | ---: | ---: | ---: |
| 原 ProcessJob | 2557.83 | 1171.875 | 1066.54 |
| 最终产品 ProcessJob | 1449.16 | 140.625 | 3.11 |
| 实际产品 GitRunner | 1474.46 | 109.375 | 未单独计时 |
| 直接 Tokio 对照 | 1413.43 | 125 | 不适用 |

原始 `runner-cost-product-20261120.json` SHA256 为 `FFD89C1237E24A986644FD0A06206042A81537252C26B6783D9BAB9E69034691`；最终产品源码SHA256为 `037B65B67F03F40538D7B5DB6055C88422ED0C698D408510EE5955CF563DCC59`。详细方法、源码身份和限制见 `runner-product-summary-20261120.json`。这证明本次线程查找开销已降低，不证明全部原生卡顿已解决。

## 产品回归

新增并发12个命令，检查成功/失败结果、stdout、stderr和退出码各自对应；另在独立子进程中执行24次成功/失败命令及3次spawn失败，抽样句柄回收，避免其他并行测试污染计数。复用已有取消前不启动、2MiB双向管道、阻塞stdin超时，以及取消/超时/放弃调用后的子孙清理回归。

`runner_lifecycle` 7项通过，5个ignored为被父测试调用的子进程fixture，非遗漏的产品用例。两份Rust文件rustfmt与diff-check通过，独立审阅未发现阻塞问题。

最终 `cargo test --offline --workspace` 退出码0：78个Cargo顶层目标（68个Running、10个Doc-tests）全部完成，490通过、0失败、7个辅助subprocess fixture忽略。每个目标仅有一个结果结尾，无重复计数；忽略项的父测试全部通过。重点真实回归 `clone_cancellation` 4项、`smart_rewrite` 11项、`unshelve_safety` 6项通过。QA-023/032这次未复现，仍未找到历史首次异常的根因，不因此关闭。

`cargo build --offline -p gitx --features tauri/custom-protocol` 退出码0。新程序 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-runner-pss-0140-20261120.exe` SHA256为 `6A0100C88CC57CD888DEA78EB99DADB884FF8F9E3CFFBCE7DC9B7ACEAB1504E3`。本次只修改Rust执行器及回归，前端仍为 `1f25a44` 已通过完整1239项的源码，没有把旧前端结果写成本次重跑。

证据在 `E:/IDEAproject/gitx/test-results/`：`runner-cost-summary-20261120.json`、`runner-cost-20261120.json`、`runner-cost-attribution-20261120.json`、`runner-cost-pss-20261120.json`、`runner-job-safety-20261120.json`、`thread-snapshot-cost-20261120.json`、`runner-pss-lifecycle-20261120.log`。外部候选源码仅在 `runner-cost-20261120/src/process_win_pss.rs`；产品修复为 `crates/gitx-git/src/process_win.rs`。

完整回归日志 `runner-pss-workspace-20261120.log` SHA256为 `863797A55E5C5199D21706CBD2CF457BB5ACAB96B93A200AEF21C39C27AED7A7`，统计见 `runner-pss-workspace-summary-20261120.json`；构建日志 `runner-pss-native-20261120.log`。

## 原生同场景对照

基线程序为 `gitx-commit-enable-0140-20261120.exe`（`1f25a44`，SHA256 `E18693E2ABB4A1FE583DE474FDED1AE5FD7E8CB2C7B1B3EA3BC6738376A6F2DD`），新程序身份见上文。基线PID29264，新版PID29928，均通过computer-use启动，子进程命令行没有trace-startup参数，沿用相同默认WebView profile和设置。最初脚本启动被自动审批拒绝，后改用技能支持的 `sky.launch_app` 正常启动。

同一仓库 `E:/IDEAproject/gitx/test-results/repos/changes-load-20261119`，2000个修改文件、3个普通差异标签，活动为file-0002。每版外部写入40次，每次相隔约1秒，然后按原字节恢复文件；每5秒左右采样进程树，共25点。测试开始前完整Rust与原生构建已结束，两个程序顺序运行。两版均看到活动差异自动更新、列表下滚和回到原位置；新版回滚操作发生于写入刚结束，未把两次稀疏滚轮操作当作严格一致的输入负载或延迟测量。

CPU单位为核（累计CPU秒数/墙钟秒数，1代表持续占用一个核）。写入期仅取完全位于首次/末次写入之间的完整采样区间；静置期从文件恢复15秒后开始。

| 阶段与指标 | 原程序 | PSS程序 |
| --- | ---: | ---: |
| 写入期完整区间 | 6段 / 32.235秒 | 6段 / 32.198秒 |
| 写入期主进程平均CPU（核） | 1.533 | 0.607 |
| 写入期常驻进程树平均CPU（核） | 1.951 | 0.994 |
| 静置期完整区间 | 9段 / 48.125秒 | 8段 / 42.612秒 |
| 静置期主进程平均CPU（核） | 0.380 | 0.377 |
| 静置期常驻进程树平均CPU（核） | 0.635 | 0.652 |
| PrivateBytes求和峰值→末值（MiB） | 278.133→250.098 | 261.723→236.445 |
| 句柄总数峰值→末值 | 3969→3930 | 3796→3699 |

常驻进程树CPU只包含相邻两次采样中PID及StartTime均相同的进程，短命Git子进程可能漏记；主进程单独报告不受这一漏记影响。WorkingSet求和可能重复计算共享页。两版静置时均有8个进程，内存/句柄有回落，但这是一组顺序运行的debug样本，默认profile缓存和宿主机其他活动未控制，不能用它证明长期无泄漏、稳定加速比例或全部滚动流畅。

写入时原生CPU改善与低层对照方向一致，PSS收益已经进入实际应用。另发现静置主进程仍约0.38核，写入前基线也接近此值，新增 **QA-040（资源线索/待核查）**，下一步按线程归因并排除UIA/工具和窗口事件；不能把“较负载期下降”写成空闲CPU正常。

原始证据目录 `E:/IDEAproject/gitx/test-results/runner-native-20261120/`：`statistics.json`、`summarize.cjs`、`before/`与`after/`下的 `program.json`、`resources.json`、`writes.json`、`children-startup.json`。写入脚本 `runner-native-workload-20261120.ps1`，负载停止后原字节SHA256为 `90696BFDDD90BBF15FC21049A2182401B28B9CFEB3EDE692AB3C1D955D09E318`。

## QA-040 线程归因与恢复

停止交互后的额外40.056秒只读采样中，主进程平均0.3924核，主线程22808消耗8.891 CPU秒，线程30460消耗6.844秒；后者线程起始地址位于UIAutomationCore.DLL +0xecf10。其余持续线程（包括Tokio、Git watcher、notify）CPU增量均为0。指令采样集中在窗口消息/查询/Hook接口，主线程一次指令地址也映射UIAutomationCore。支持UIA/窗口消息路径活动，不足以认定具体外部客户端、完全归因工具或排除产品参与。未修改产品以掩盖该现象。

只读汇总 `idle-thread-summary-20261120.json` SHA256为 `E1399CA010B39C51582E508C689A35EF55FC0E7CC8F3C1349197DC3A6CDAC59E`，其中引用同目录CPU、线程名称、指令和起始模块原始证据。下一步分别测量干净启动、仅截图、启用UIA观察后的静置状态。

两版测试程序已正常关闭。`before/exit.json` 与 `after/exit.json` 按采样中PID+StartTime核对进程树，无存活成员；新版核对8个进程身份。`fixture-before.json` / `fixture-after.json` 的2000文件逐个SHA256相同，HEAD仍为 `20e7b3b7963d129818958ae9ae9f9abb2a461926`，索引SHA256仍为 `12C63B63A83D53250D3C6B79117CABB9BE5CBAD9450B30BB9276D55E33C50A67`，状态仍2000项。

退出后设置仅有本轮加入测试仓库造成的recentWorkspaces变化，确认没有其他字段改变后恢复原文件；`settings-restored.json`记录前后SHA256均为 `F160603B7BCE0F5CF7D07D6D1EAA088B6B69B79BB2F1FF83B855FB00E4F245C7`。

## 交付与边界

本功能随本次独立提交交付，提交哈希和推送核对结果在后续台账补记。QA-034/008继续保留持续快滚、终端与长期负载验收；QA-040新静置线索继续排查，不会仅据低层优化关闭整体流畅度目标。本轮新增QA-040，解决QA-034中的执行器固定开销，已知未关闭事项仍为9项。用户安装版 `D:/gitx/gitx.exe` 未替换。
