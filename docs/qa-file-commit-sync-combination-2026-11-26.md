# File、部分提交、后台 Fetch 与更新项目组合验收

日期：2026-11-26。对应QA-010最终组合验收的一组场景，不关闭整体七项目标。开始前fetch及两分支检查成功，基线`ffa5872`已包含master`5241dd5`；全程主线程。

## 程序和隔离数据

沿用QA-099产品`c747b5e`，程序SHA256为`7BDFF147EFD2DD06A65C590F6414D15F07D50A4A39669CAA3AEFAB87CEB3A012`。使用独立`app.gitx.qa099`设置、独立WebView目录、本轮新建工作仓库/本地bare远端/producer；无调试端口。后台Fetch间隔1分钟，按块变更列表开启。

初始HEAD为`89b07df`。`src/blocks.txt`有相隔较远的FIRST和SECOND两个修改块，FIRST已暂存并归Changes，SECOND仅工作区并归Feature；`keep.txt`另有未选暂存。`src/whole.txt`初始无修改。精确初始内容、索引字节和metadata均保留。

## 原生操作及真实 Git 核对

1. 最近项目打开仓库，经Ctrl+P找到未展开的`whole.txt`，打开File编辑器，将内容改为`whole edited in GitX`（无末尾换行），Ctrl+S保存。Commit自动显示新增修改。
2. 勾选whole整文件及Feature目录下的SECOND块，FIRST与keep保持未选。在producer推送一个新增`remote-news.txt`的提交`68ab779`。
3. 未手动点击Fetch；定时Fetch更新origin/main，Log显示远端新提交、main落后1个，原勾选范围保持。首次检查时已更新，`auto-fetch-result.json`中的0.203秒是检查耗时，不能当作Fetch耗时。
4. 说明填写`QA combination selected Feature and saved file`并Commit。原生观察到Committing任务及禁用按钮，完成后Feature清空。一次提交`ee340ca`仅包含SECOND块和whole；FIRST及keep仍暂存，所有工作文件字节保持，metadata归属保持。Log显示本地/远端各领先一个的分叉。
5. Update Project选择Rebase，原生观察Updating project等待；自动保存并恢复本地修改成功，没有脏工作区拒绝。新HEAD`38eac14`的父提交为远端`68ab779`，ahead/behind为1/0；暂存patch逐字节保持、无额外未暂存差异、stash为空、blocks/keep/whole哈希及metadata保持。远端文件内容正确。
6. Log切换后按本地重放提交→远端提交→基线线性显示；blocks差异只剩FIRST，符合未选范围。

## 发现与边界

本场景发现QA-100：Update Info将重放后的本地提交也列入Incoming commits，实际1个远端提交却提示2 commits。文件内容/暂存核对通过，不是本次数据损坏。后续独立修复和重放见[传入提交统计报告](qa-update-incoming-2026-11-26.md)。普通Pull相邻逻辑另登记QA-101，尚待复现。

该链路补齐了File保存→按块/整文件混合提交→自动Fetch→Log分叉→保留本地修改的Rebase联动。复杂图线、连续快滚、精确交叉导航竞态、终端与原生拖放仍依各自台账边界处理。本次没有在此程序重跑所有历史功能，也没有修改用户安装版。

正常关闭测试程序后，7个观察进程身份均退出；测试settings归档并移除，用户settings SHA256仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。本轮新fixture保留结果和`refs/qa/combination-before-update`、`refs/qa/combination-after-update`作为重放依据，不将新测试仓库保存结果写成恢复用户仓库。

证据目录：`E:/IDEAproject/gitx/test-results/qa-combination-20261126`。包含Setup、初始文件/index/metadata、远端发布、自动Fetch检查、commit/update验证JSON、原生前后截图、程序身份及退出记录。
