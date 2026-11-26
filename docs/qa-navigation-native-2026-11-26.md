# QA-036/010 原生跨项目晚到响应验收

日期：2026-11-26。开始前读取统一台账并fetch、检查主分支及交付分支；基线`992d5a2d0f0c047b1ea29d0c380c3b64dcc5dce2`已包含master`5241dd5d64683d03c6e3f5e901ea7293d2c199b3`。全程主线程，本轮没有修改产品代码，也没有新增确认缺陷。

## 版本及方法

沿用QA102产品`aa319059c4667affb906aa678eb6ecdedc269b88`的独立测试程序，SHA256为`D50CC27455E865C95D422C041E6CCE67348B54F412A0C700EB21AAF3087867AD`。前端仍为QA100同一dist，未声称重跑未变产品的完整前端、Rust或构建。

新建父仓库parent和嵌套独立仓库nested，分别只有PARENT/CHILD提交及parent-only.txt/child-only.txt未暂存修改；父仓库忽略nested目录。使用独立WebView目录和`app.gitx.qa102`设置，关闭自动Fetch和日志索引。

测试专用Git代理转发`D:/Git/bin/git.exe`，仅拦截指定仓库的一次status。真实Git先完成读取，代理保存输出后等待显式release；不通过产品内部API切换仓库。原生标题栏最近项目入口和“当前窗口”按钮完成导航，再检查等待代理进程仍存活后释放响应。

成功/失败两组分别保存代理源码、exe、等待参数、原始输出、释放前PID及创建时间、释放时间、截图和可访问文本。失败组在释放时返回受控错误`QA_CONTROLLED_OLD_STATUS_FAILURE`。这是受控时序证据，不能解释为真实磁盘恰好慢了同样时长。

## 有效原生结果

| 场景 | 旧响应和切换顺序 | 释放后的结果 |
| --- | --- | --- |
| 旧成功晚到 | nested后台status等待，原生打开parent；释放前父仓库已展示，代理PID19620仍活着，显式释放总等待4459ms。 | Commit只有parent-only.txt；分支qa-parent、Log的PARENT提交及父路径正确；回到Idle。旧子仓库成功结果未覆盖当前状态。 |
| 旧失败晚到 | parent后台status等待，原生打开nested；释放前子仓库已展示，代理PID11048仍活着，显式释放总等待4131ms。 | Commit只有child-only.txt；分支qa-child、Log的CHILD提交及子路径正确；回到Idle。没有旧失败的toast或面板错误。 |

截图中的文件、分支、Log和路径为判断依据；部分可访问文本仅返回占位字符或为空，不能单凭这些文本断言界面内容。释放记录均为`explicit=true`，与仍存活进程核对共同排除了“先超时、后空放行”的假阳性。

## 未通过的方法尝试与边界

最初计划延迟父仓库首次status，并在File中切换活动根。实际观察到Opening project及Commit骨架，但活动根下拉未完成可靠选择。原生select弹层由msedgewebview2的Chrome Legacy Window承载，坐标输入被工具的窗口归属检查拒绝；激活/重新观察、键盘和set_value均未取得成功切换证据。最后再次打开弹层并list_windows，仍未返回可单独选择的弹层窗口。因此该精确路径保留为未验收，不认定产品下拉失效。

`trial-initial-timeout`及`trial-background-timeout`两次早期试验因工具调用间隔，代理先被GitRunner约30秒超时终止，没有有效released记录。它们保留为方法失败/超时证据，不计入上表通过项。调整为同一次编排内完成准备、一次原生动作和抓图、代理存活检查及释放后，才取得上表两次有效结果。

本轮证明跨项目后台status的旧成功/旧失败隔离；没有完成首次主读取期间活动根切换、自然慢IPC、持续滚轮帧时间、长期资源保留或所有导航入口组合。后续[活动根续验](qa-initial-root-navigation-2026-11-26.md)已通过键盘普通切根，但精确首读竞态仍缺有效时序证据。QA036保持部分完成，QA010整体目标继续。

## 恢复与交付

正常关闭测试窗口后，最终记录的7个进程身份（PID与创建时间）全部退出，测试Git代理进程也为0。把两个工作文件恢复到试验前备份，未丢弃原有未暂存修改；HEAD、索引树、status及3个文件SHA256全部与baseline一致：

- parent HEAD：`bf06d7b95f023dc4be2e8875b639dc138c38230a`；index树：`355bedcb41e6d8e462de5156825957aa79dd1870`。
- nested HEAD：`09d03fb300ffe0c058374a7dbcfa64bec170b854`；index树：`36d8c29560b153d55b09541966c4d741b5f03d65`。
- 测试settings归档后移除；用户settings SHA256仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。用户安装版未替换。

证据目录：`E:/IDEAproject/gitx/test-results/qa-navigation-20261126`。有效场景以`late-success/`与`late-failure/`为准；其余包括baseline、target、活动根弹层截图、两个超时目录和`cleanup-verification.json`。顶层target的代理哈希仅对应初始代理，后续成功/失败场景各自保存实际版本。

提交前再次fetch和两分支快进检查成功，仍包含master5241dd5及交付992d5a2。当前11项已知未关闭保持；本轮新增缺陷0、产品修复0，新增两组原生竞态验证证据。提交推送结果见统一台账。
