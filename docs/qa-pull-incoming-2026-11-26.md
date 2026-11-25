# QA-101 普通 Pull 的传入提交列表

日期：2026-11-26。接续[QA100更新项目统计](qa-update-incoming-2026-11-26.md)发现的相邻候选。开始前已读取台账并fetch、检查主分支和交付分支；基线`a85f7be`包含master`5241dd5`，工作区干净。全程主线程。

## 问题和范围

普通Pull返回的commits由syncStore传入Update Info的Incoming commits区域。旧实现按`old_head..new_head`且仅在HEAD变化时查询，导致分叉Rebase混入本地重放提交、Merge混入新建本地merge提交；Squash和`--no-commit`虽已应用远端内容却返回空列表。

真实Git首批7项中5失败、2对照通过，失败分别覆盖Rebase、Merge、不立即提交、Squash及选择非跟踪分支。无跟踪ref场景实际从alternate/review/incoming拉取，当前分支的上游仍origin/main，证明不能简单使用`@{u}`替代统计来源。

## 修改

保留原单次`git pull`及全部选项；成功后立即读取本次FETCH_HEAD的SHA，按更新前HEAD到该SHA统计。这样来源跟随用户选择的remote/branch，不要求远端跟踪ref存在；HEAD保持但确有索引变更或待完成merge时仍显示来源提交，继续提示需要提交。无实际更新返回空列表。

原有安全和结果语义不变：文件范围仍比较实际HEAD/索引变化，不混入已有未暂存内容；已完成Git操作后的附加统计沿用尽力读取，不将附加log失败伪装成拉取动作未完成。应用内操作沿用同仓库写锁；本轮不增加外部Git进程或用户hook同时覆盖FETCH_HEAD时的快照保证。

旧m2测试将“未创建本地提交”等同于Incoming为空，现改为断言传入远端提交；原HEAD保持、文件列表、待提交提示、本地未完成内容的断言全部保留。

## 验证

新增7项真实Git回归全部通过。覆盖分叉两策略、Squash/不立即提交、普通和no-commit快进、无更新/仅本地领先，以及没有跟踪ref的其他远端分支。6个同步相关Rust目标共51项通过，0失败：pull_incoming7、m2_branches_sync7、update_incoming7、update_local_changes8、sync_safety10、submodule_safety12。后补第8项真实Git回归通过：远端只有空提交、no-commit后HEAD/索引均无变化但有MERGE_HEAD时，仍正确提示待提交并列出来源。最终应用和gitx-git测试目标Clippy及fmt通过；新增用例首次fmt检查提示换行，格式化后检查通过。

前端更新/Pull相关4文件12项、仓库生命周期/store结果透传34项通过，共46项。前端源码未改，沿用QA100已通过类型/Vite构建的dist，入口SHA256仍`47BE0949AFD3BEF309BCFECD93B134AC27E687F501A42E4F7AE035B3ABE56F60`；本轮不宣称重跑全部前端或无关Rust套件。

Windows独立profile构建通过，程序SHA256为`49452C4614220EACE3770485D473C76CC1511EC2A42D1B8603CC5D076B601652`。两个新建fixture均本地/远端各领先1个，独立`app.gitx.qa101`设置和WebView目录，无调试参数。使用原生主菜单打开Pull，观察首读Loading、拉取期间Pull按钮禁用和左下Pulling任务、成功回到Idle。

- Rebase：结果仅列`68ab779`远端提交，排除本地重放；真实Git核对新HEAD`b29a6cb`父提交为`68ab779`、ahead/behind=1/0、工作区干净且原文件hash保持。
- Squash：保持HEAD`ee340ca`、提示`Changes applied; commit required`，Incoming同样仅列远端`68ab779`。只有remote-news.txt进入暂存；原keep.txt未暂存patch和所有原文件hash保持，ahead/behind仍1/1、未创建本地提交。

截图和可访问文本均归档；两仓库Stash为空，新增文件内容正确。原生未逐一执行Merge/no-commit/非跟踪分支等自动场景，不写成全部GUI已验。

正常关闭后第一次立即检查仍有进程，随后按相同PID和创建时间复查，7个观察身份全部退出。测试settings归档移除，用户settings SHA256保持`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。新fixture结果保留作证据，未改写用户工作仓库。

证据目录：`E:/IDEAproject/gitx/test-results/qa101-pull-incoming-20261126`，包含失败/通过日志、Prepare脚本、原始HEAD/index/文件hash和构建记录。用户安装版未更新。

## 后续与交付

初始空仓库Pull的updated_files仍可能因旧HEAD为空而遗漏，已登记QA102代码候选；待重新同步后独立复现，不据此声称数据损坏。本项提交推送与收尾状态随后补记。
