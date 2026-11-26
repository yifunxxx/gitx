# QA-010 当前版本组合自动验收

日期：2026-11-26。基线`e55508d6f4d15c098e9dc915d9b6b1d404801a0c`，版本0.1.48，已包含master`e2e33d96e3bc0aed8c206fe22562ab9432c8d27a`及交付分支最新提交。开始前读取台账、fetch并完成两分支快进检查；全程主线程。

## 为什么再次运行完整回归

QA098的完整Rust回归覆盖gitx-git/gitx-diff/gitx-meta三包，之后QA100–102修改了sync_ops的更新/Pull统计、FETCH_HEAD来源和空仓库首次Pull文件列表；这些修改已有定向与原生证据，但不能把之前完整回归算到之后的组合上。本轮执行当前基线的完整Rust工作区，并与同一基线的完整前端结果对应。

这是一次有界整体验收，未对QA023/032实施额外循环压力测试，也没有修改产品代码。最新构建/原生界面仍引用各功能报告，不用自动用例数量替代整体验收完成度。

## 执行及证据

- 完整前端：`pnpm test`，195个文件、2018项通过，4项既有性能probe按配置跳过，退出码0；耗时71.31秒。
- Rust：`cargo test --workspace --no-fail-fast`，使用隔离的CARGO_TARGET_DIR；91个顶层测试/文档目标均有最终summary，630项通过、0失败、9项ignored，退出码0。忽略项为7个由父测试显式启动的辅助子进程入口、1个需显式使用宿主回收站的测试及1个手动性能probe。
- 类型检查已在同一基线相关测试交付前通过；没有重复构建未变的产品程序。

Rust结果按每个顶层Running/Doc-tests段的最终summary统计。辅助子进程自己的测试摘要不重复相加；保留每个目标、失败/忽略数量、缺失summary和命令退出码，避免仅依据日志中的零散green行判断通过。

证据目录：`E:/IDEAproject/gitx/test-results/qa-combined-20261126`，包括基线及用户settings哈希、完整日志、退出码和统计脚本。QA023/032本轮通过只表示本次未复现，不据此宣布历史根因已解决。原生持续滚动、精确首读切根、终端输入、拖放及资源归因仍见[七项目标索引](qa-acceptance-2026-11-26.md)。用户安装版未更新。

## 重点结果及限制

| 本轮关注点 | 当前完整运行结果 |
| --- | --- |
| QA100更新项目传入统计 | update_incoming 7项通过，15.49秒。 |
| QA101普通Pull来源/数量 | pull_incoming 8项通过，8.03秒。 |
| QA102空仓库首次Pull | pull_unborn 3项通过，4.90秒。 |
| QA023历史Shelf异常 | unshelve_safety 6项通过，5.32秒；本次未复现Shelf entry not found。 |
| QA032历史Smart rebase异常 | smart_rewrite 11项通过，27.14秒；本次未复现等待hook超时。 |

QA023/032继续保留原始失败及诊断，不用本轮green推断旧根因。既有原生界面证据未全部重新执行，原生持续快滚或资源泄漏也不由这些自动测试证明。

`git diff f603ac2 HEAD -- apps/desktop/src src-tauri crates Cargo.toml Cargo.lock`仅包含本轮useWorkspaceInitialReads测试扩展，产品逻辑与QA108最终程序相同。此前QA098三包结果与本次完整工作区范围不同，不将通过数量差值当作新增修复数量。

结束后隔离target目录中没有残留测试进程；用户settings SHA256与基线一致，仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。本轮没有修改安装版、生产配置或用户仓库。新增产品缺陷0、产品修复0，补齐当前基线的完整自动验证；整体七项目标及11项已知未关闭事项继续。提交推送状态见统一台账及交付记录。
