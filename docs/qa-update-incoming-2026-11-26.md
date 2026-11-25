# QA-100 更新项目传入提交统计

日期：2026-11-26。来源为[File/部分提交/后台Fetch组合验收](qa-file-commit-sync-combination-2026-11-26.md)。开始及续办前成功fetch并检查主分支、交付分支；基线`ffa5872`包含master`5241dd5`。续办首次SSL连接失败，单次HTTP/1.1重试成功后继续，全程主线程。

## 问题与修正

本地1个提交与远端1个提交分叉后，Update Project执行Rebase成功，文件和暂存保持，但Incoming commits列出远端提交和重放后的本地提交，显示2 commits。真实Git测试也确认Merge把本次新生成的本地合并提交算入。

原因是后台用`old_head..new_head`统计传入提交，混入更新操作在本地生成的提交。现在Fetch成功后、改写HEAD之前读取上游SHA，以`old_head..fetched_upstream`获取传入列表。读取失败会在保存/更新工作文件前返回错误，不静默提供空的成功统计。

更新命令仍使用上游ref，保留Git分支语义和原有Merge/Rebase/Reset操作；不更换为裸SHA。应用内Fetch和更新已由同仓库写锁串行，外部Git进程同时改写同一仓库不属于本轮新增保证。更新文件仍比较实际前后HEAD，安全备份、暂存/工作区保存恢复、冲突恢复和子模块策略未改动。远端原本存在的合并提交仍计入Incoming，不能简单过滤所有merge提交。

## 自动验证

- 新增初始6项：旧实现2失败（Rebase与Merge误计）、4正常对照；修后全部通过。再补远端已有merge的对照，最终7项通过。覆盖分叉、快进时本次Fetch的新提交、原地无更新、仅本地领先及Reset；分叉场景逐项核对暂存/未暂存patch和Stash清理。
- 同步相关5个真实Git测试目标共44项通过：`update_incoming`7、`update_local_changes`8、`sync_safety`10、`m2_branches_sync`7、`submodule_safety`12。包含失败/取消、冲突、备份及子模块边界。本轮未重跑无关Rust模块的完整历史套件。
- 更新结果视图、更新弹窗和恢复store共3文件8项前端回归通过；类型检查及Vite构建通过，仍有既有大chunk提示。本轮没有修改前端源码。
- gitx-git测试目标与应用Clippy及fmt通过；Windows debug独立profile构建通过。

## 原生复查

使用独立`app.gitx.qa100`profile和新克隆的同一场景，从原更新前提交`ee340ca`重放。原分叉1/1、未选暂存patch、blocks/keep/whole和metadata哈希已核对一致。fixture首次准备受全局autocrlf影响，在修改本地配置后触发checkout保护；保留该准备目录，改为先no-checkout克隆、配置LF再checkout，重新逐项核对成功。这是测试准备问题，没有放宽产品断言。

最终程序SHA256为`91790CD213E30E350F358A6275DFF8BDC7F2D1E2A9E7046CB84B4F17A5574075`，未启用调试端口。最近项目打开后观察分叉1/1与Changes的未选暂存，Update Project选Rebase；等待阶段显示Updating project，完成回到Idle。结果显示`1 files updated in 1 commits`，Incoming仅`68ab779 QA incoming during selected partial changes`，没有重放本地提交。切回Log呈线性3提交，仍本地领先1个。

真实Git核对新HEAD`366f106`父提交为`68ab779`；暂存patch保持、无未暂存差异、Stash为空，blocks/keep/whole及metadata哈希全部保持，远端新增文件内容正确。界面截图及可访问文本分别归档。原生仅重放Rebase，Merge/Reset/远端merge等为真实Git自动证据，不写成全部GUI验收。

正常关闭后7个观察身份均退出，测试settings归档移除；用户settings SHA256保持`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。新建测试fixture保留供证据追溯。

证据目录：`E:/IDEAproject/gitx/test-results/qa-combination-20261126`（旧版原生/失败回归/同步回归）和`E:/IDEAproject/gitx/test-results/qa100-update-incoming-20261126`（修后构建及原生重放）。用户安装版未替换。

## 后续与交付

普通Pull也将`old..new`结果传给相同Incoming视图，已另登记QA-101代码候选，待独立复现并核查FETCH_HEAD及squash/no-commit语义。其他原11项已知事项继续，含QA101共12项。

提交前及补记前fetch/两分支检查成功，已包含master`5241dd5`。功能提交`a801ce9201a887ef94a06364624d826791b9acb2`首次推送成功，ls-remote完整SHA一致，无凭据提示；QA100关闭。文档站点校验、267个QA本地链接及差异检查通过。
