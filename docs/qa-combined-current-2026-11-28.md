# QA010：搜索优化后的完整回归与文件替换组合

日期：2026-11-28。基线 `7fa946072679ebde1bfb3950f62e4d630c3a78fd`，已包含远端 master `50a4802dd23f61055668e165f6fe7c0b93b17680`。开始前读取统一台账并完成 fetch、两分支整合；提交前再次同步，无新提交。全程主线程，用户安装版未更新。

## 范围与证据版本

本轮补验 QA155/156/157 的目录排除、取消和替换预览变更与其他功能的组合。此前 [717b631 的完整回归](qa-combined-validation-2026-11-28.md)仍保留为历史证据，本报告是后续产品基线的实际运行结果。

`git diff 3ae153b4a09bb4782ab9e3e094ec300d8c3e1d1f HEAD -- apps/desktop/src crates src-tauri Cargo.toml Cargo.lock` 为空。复用 [QA157](qa-replacement-preview-2026-11-28.md) 的完整前端 2484 项通过/4 项既有跳过、类型检查、Clippy、双语 Pages 及最终 Windows 构建；对应日志与程序 SHA256 已核对并归档。没有将复用写成本轮再次执行。

## 完整 Rust 工作区

实际执行 `cargo test --workspace --no-fail-fast`，使用独立 target。退出码 0，耗时 1033.80 秒，其中编译 4 分 22 秒。92 个顶层测试/文档目标均有最终结果：678 项通过、0 失败、9 项既有 ignored。统计采用每个 Running/Doc-tests 段的最终摘要，不重复计算其辅助子进程结果。

9 个 ignored 为 7 个由父测试启动的辅助进程入口、1 个需要显式使用宿主回收站的测试、1 个人工性能 probe；本轮没有改动测试或新增跳过。

| 关注范围 | 本轮完整运行结果 |
| --- | --- |
| 应用命令、搜索/替换、文件与终端 | lib 75 项通过、1 项既有 ignored，8.88 秒；含新增目录排除、取消和替换预览契约。 |
| 部分提交内容/事务保护 | path_commit_entries 11 项/8.06 秒；path_commit_safety 12 项/5.05 秒。 |
| Git 进程生命周期 | runner_lifecycle 7 项通过、5 个辅助入口 ignored，5.96 秒。 |
| 更新项目与本地修改恢复 | update_local_changes 8 项通过，26.17 秒。 |
| Pull 来源及 Incoming | pull_incoming 8 项通过，8.31 秒。 |
| QA023 Shelf 历史异常 | unshelve_safety 6 项通过，6.25 秒；本次未复现原缺失错误。 |
| QA032 Smart 历史异常 | smart_rewrite 11 项通过，32.06 秒；本次未复现原 hook 等待超时。 |

`cargo fmt --check` 和 Pages 检查通过。Shelf/Smart 随正常完整回归运行，没有额外循环压力测试；一次通过不能解释历史失败原因，两项仍待核查。

## 原生文件编辑与批量替换

使用 QA157 最终程序的副本、独立 profile/settings 和新建的三文件仓库。程序 SHA256：`66F23C4AFD2003E3077605CC955915B0DC285E0D9FDCF925282E0F7B85524E36`。通过第一方 Windows UI 工具执行真实文件树双击、正文输入、快捷键、搜索、替换确认和退出。

1. 打开 `draft.txt`，在末尾输入 `unsaved`，不保存。标签出现未保存标记。
2. `Ctrl+Shift+H` 打开全局替换，查找 `hit`、替换为 `new`。扫描完成，显示 2 个匹配/2 个文件/扫描 3 文件；替换按钮保持禁用，并提示先保存或关闭未保存文件。三文件字节、HEAD、索引与个人 settings 均未变化。
3. 取消对话框，草稿仍在；`Ctrl+S` 保存。任务队列出现 Saving file 后回到 Idle，文件精确为 `b"hit draft\r\nunsaved"`，未保存标记清除。
4. 再次打开全局替换并输入同样条件，按钮可用。预览确认两个文件后执行，界面报告 Replaced 2 files；原有干净文件标签自动关闭，避免继续保存旧正文。
5. 重新打开 `draft.txt`，显示 `new draft` 和保留的 `unsaved`。磁盘核对如下，HEAD/索引保持原值，Git 状态仅为两文件修改。

| 文件 | 替换后的精确字节 |
| --- | --- |
| draft.txt | `b"new draft\r\nunsaved"` |
| clean.txt | `b"new clean\r\n"` |
| unrelated.txt | `b"untouched\r\n"`，保持原值 |

这验证了正常顺序的草稿保护、保存、替换、标签失效及重开读取；没有注入精确并发、跨项目写入取消或所有文件操作组合。扫描和写入的瞬时状态不作为持续性能测量。

## 回收、证据与剩余工作

正常关闭专用程序后，按路径和创建时间核对全部 8 个观察进程身份已退出；完整 Rust target 下也没有残留测试可执行进程。保存实际替换结果后，按已核对哈希的 HEAD 原文恢复两个 fixture 文件，三文件哈希、HEAD、索引、干净状态全部回到基线。专用 settings 已归档后移除，个人 settings SHA256 保持 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。旧 QA007 原生终端现场保持，没有操作其窗口。

- 自动回归证据：`E:/IDEAproject/gitx/test-results/qa-combined-current-20261128`，包含完整日志、退出码、逐目标统计、基线及复用证据哈希、进程/设置清理结果。
- 原生组合证据：`E:/IDEAproject/gitx/test-results/qa-replace-combined-20261128`，包含独立仓库、各阶段 AX、逐字节核对脚本/结果、进程身份及退出记录。

当前分支没有本轮提交的远端 CI 运行，旧提交的成功 CI 不计入本报告。本机没有找到可用 WSL 发行版，本轮未执行 Unix 测试；现有 Linux CI 排除应用测试，不能替代 Unix 终端 lib 验证。

本轮新增确认缺陷 0、产品修复 0，完成一组当前产品完整自动回归与原生替换组合证据。QA010 保持部分完成；QA008/034 持续输入断档、QA007/046 原生与平台边界、QA009 剩余界面组合、QA064 用户复看及 QA023/032 历史异常继续，共 9 项已知未关闭事项。这不是全部潜在问题的总数，也不代表七项目标完成。交付状态见统一台账。
