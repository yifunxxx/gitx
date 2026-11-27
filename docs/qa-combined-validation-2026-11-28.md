# QA010：0.1.56 组合自动验收

日期：2026-11-28。开始前读取台账、fetch及master/交付分支检查成功，干净基线`717b6317d6a838d54e8fd31e8a716e6ffe60bd6f`已包含master`50a4802dd23f61055668e165f6fe7c0b93b17680`。全程主线程，用户安装版未更新。

## 验证范围

自[11月26日完整工作区回归](qa-combined-validation-2026-11-26.md)以来，后端新增全局搜索与替换、停止保留和分页、混合换行支持，以及部分提交保护。此前各功能有定向证据，本轮在当前组合上重新执行`cargo test --workspace --no-fail-fast`，使用隔离target目录。不对Shelf和Smart rebase历史偶发异常实施额外循环压力测试。

当前产品与QA138最终实现相同：`git diff d428cb7..717b631 -- apps/desktop/src crates src-tauri Cargo.toml Cargo.lock`为空。因此复用刚完成的207文件2244项前端回归（4项既有probe跳过）、类型/Vite及Windows构建，不将复用写成本轮再次执行。原生物理输入、持续滚轮和资源边界仍按各报告的实际执行版本保留。

## 接口与构建

现有`bindings:check`仅检查文件存在，本轮额外通过QA138的0.1.56归档debug程序显式导出当前Rust接口到证据目录，格式化后按统一换行与`apps/desktop/src/lib/backend/bindings.ts`全文比较，完全一致。导出模式在创建应用窗口前返回，退出码0，没有启动原生界面。程序SHA256为`531A93F50A854EC8FBADE3A5374CE2292DE4430987CB1A2E5ACF8872EEF43FAF`。

## 完整Rust结果

完整命令退出码0，耗时955.83秒，其中测试程序编译5分09秒。92个顶层测试/文档目标全部有最终summary，666项通过、0失败、9项ignored，没有遗漏结束结果或失败目标。统计按每个顶层Running/Doc-tests段的最终summary计算，辅助子进程摘要不重复相加。

9个ignored与此前范围相同：7个由父测试启动的辅助子进程入口、1个需要显式操作宿主回收站的用例、1个人工性能probe；没有为了本轮通过而修改或跳过测试。`cargo fmt --check`及Pages检查通过，后者覆盖22中文/22英文页、79命令、33设置、318本地链接和18图片引用。

| 本轮关注点 | 当前完整运行结果 |
| --- | --- |
| Tauri命令、搜索/替换、文件及终端 | lib共63项通过、1项回收站用例ignored，8.50秒。包含大文件/超长行、UTF-16定位、混合换行、停止/分页回收及ConPTY关闭保护。 |
| 部分提交内容和事务保护 | path_commit_entries 11项通过，7.80秒；path_commit_safety 12项通过，4.73秒。 |
| Git进程生命周期 | runner_lifecycle 7项通过、5个辅助入口ignored，6.16秒。 |
| 更新项目与本地修改恢复 | update_local_changes 8项通过，22.93秒；update_incoming 7项通过，15.21秒。 |
| Pull来源与首次Pull | pull_incoming 8项通过，8.09秒；pull_unborn 3项通过，5.15秒。 |
| QA023历史Shelf异常 | unshelve_safety 6项通过，5.31秒；本次未复现Shelf entry not found。 |
| QA032历史Smart取消异常 | smart_rewrite 11项通过，26.37秒；本次未复现hook等待超时。 |

QA023/032继续保留原始失败和诊断，未出现新根因线索，不能由本次通过推断历史问题已修复。以上自动执行不代替原生GUI端到端交互、其他操作系统/旧Windows和长期资源测量。

## 边界与证据

当前Windows工具要求每次输入后刷新并检查，文档没有单次持续滚轮或物理输入注入时刻回执接口；不照搬旧批量调用，不以大delta或逐步截图冒充连续快滚。本轮没有新增原生输入证据，QA008/034的输入断档继续保留。

证据目录`E:/IDEAproject/gitx/test-results/qa-combined-20261128`保存基线、完整日志、退出码、逐目标统计、导出绑定对照，以及复用前端日志/程序/锁文件的SHA256。完成后隔离target目录下没有残留测试可执行进程，个人settings SHA256仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，与开始前相同；产品源码无修改。

提交前再次fetch并检查两分支，无远端新提交遗漏。本轮新增确认缺陷0、产品修复0，补齐当前0.1.56的组合自动回归及实际接口一致性证据，原9项与整体七项目标继续。用户安装版未更新，交付状态见统一台账。
