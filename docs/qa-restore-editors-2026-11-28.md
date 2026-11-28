# QA152 恢复/回退的编辑器写入保护

日期：2026-11-28。基线516ad6d，包含master50a4802；开始前及接续验证前fetch、整合master/交付分支成功，无新提交。全程主线程。

## 问题与修改

修订浏览器Restore和Commit回退直接调用checkoutPathFromRev，未检查普通编辑器的未保存草稿、读取或保存状态，也未参与文件操作及批量替换的共享写锁。旧实现还在成功写盘后保留旧编辑器正文，可能随后再次保存覆盖恢复结果。

- 两入口统一在确认后、任何unstage/checkout前检查相关草稿、加载、保存、合并编辑和共享写入。草稿需先保存或关闭；合并编辑需先完成或关闭。确认期间新产生的工作也会被检查。
- 写入期间持有共享锁，相关普通编辑器临时只读并显示恢复中状态；新文件读取、保存、移动/批量替换及冲突写入不会与之同时进行。已开始但未完成的合并读取失效，避免迟到内容重新出现。
- 每个成功恢复的文件只关闭其原有旧正文标签，重新打开读取磁盘新内容。失败文件保持标签和正文；仍挂载的编辑器保留光标和撤销历史，临时只读通过CodeMirror compartment切换，不重建编辑器。跨标签切换状态另记QA153候选，不能将本项表述为解决了该问题。
- 部分成功、失败、导航均释放锁，旧操作不会关闭新项目标签；关闭最后一个普通文件标签时保留当前历史浏览等其他页面。

Restore使用现有Git checkout语义，同时更新工作树与index。双语History/Commit教程已补保护行为，并更正旧History教程“仅修改工作树、还需暂存”的描述。没有新增快捷键和命令。

## 自动验证

证据目录：`E:/IDEAproject/gitx/test-results/qa152-restore-editors-20261128`。

- 首9项真实repoAtRev/fileViewer store测试在旧实现全部失败，见`before.log`。最终新增22项：恢复13、回退6、冲突2、真实CodeMirror只读与撤销历史1。
- 相关6文件141项通过，见`related-passed.log`。覆盖确认期间草稿/锁变化、正常/失败恢复、导航替代标签、目录路径、回退前保护及部分成功后失败、合并读取失效、同一编辑器实例和撤销历史保持。
- 完整前端214文件2438项通过、4既有probe跳过，89.41秒、退出0，见`frontend.log`。
- 类型/Vite构建通过，既有大chunk提示保留，见`build.log`。相关oxfmt及Pages检查通过；oxlint只有conflictsStore两处既有no-useless-spread警告，未新增警告。本轮无Rust产品修改，不重复完整Rust工作区。
- 过程中的测试mock缺少viewer/conflicts字段、deferred缺少reject及toast断言误用description均已修正，属于测试准备问题，不计产品缺陷。一次格式命令的PowerShell数组传参未命中目标，随后用显式12文件命令通过。

## 原生验证与交付

Windows debug构建通过，耗时2分41秒，见`native-build.log`。最终`gitx-qa152.exe` SHA256 `07753D524D59C760B9C95F7E2FD60445F3439B8FE993A9CF78B42C3667ACC944`，identifier `app.gitx.qa152restoreeditors20261128`，独立profile/settings，无调试端口。根PID29712，创建于2026-11-28 12:42:40.6725310+08:00。双语Pages完整构建通过，15.62秒，见`docs-build.log`。

最终英文浅色原生程序通过以下操作：

1. File树双击notes.txt，写入未保存草稿；从Log原始提交打开Repository at Revision并恢复该文件，显示先保存或关闭草稿的提示。草稿标签保留，HEAD/index/status/文件字节均与基线一致，见`native-draft-blocked.json`。
2. 保存草稿后，在fixture建立专用index.lock。再次恢复显示真实Git锁错误，原标签保留，磁盘草稿和index保持，见`native-failure.json`。移除自己创建的锁后重试成功，旧普通文件标签关闭且历史页面保持；重开读取`original revision`。
3. 在恢复后的文件写入新草稿，从Commit文件右键Rollback确认，显示草稿保护。磁盘和index仍为`original revision`，见`native-restored-blocked.json`。
4. 保存后以独立index.lock使Rollback失败，当前普通编辑器保持可编辑。Ctrl+Z移除本次追加的草稿、Ctrl+Shift+Z恢复，标签重回干净，证明此入口失败没有丢失撤销历史。磁盘及index保持，见`native-rollback-failure.json`。
5. 移除自己创建的锁后再次Rollback成功，旧文件标签关闭，Commit显示No local changes。File树重开读取`current revision`，工作树和index均回到HEAD。

初次点击报coordinate geometry unavailable，重新绑定窗口并截图后恢复；AX部分动作后内容滞后，使用截图核对。一次fixture脚本误按LF断言Windows写出的CRLF文本，在建锁前停止；检查字节后按文本比较重试，未修改产品或原始文件。精确并发时序、临时只读等待状态、合并读取交错与多文件部分失败为受控自动证据，未冒充原生验收。

关闭窗口后8个已记录进程身份全部自然退出，见`native-identities.json`/`native-exit.json`。fixture HEAD `aad48ff0332eaae8937cc2b3e5f1f629e65e0937`、index `f72522b4586508fe1c421208b4e0537957c8a099`、空status及文件SHA256 `7A4E5BC3C8A4B291D2A2F62EFC128099E13256DE65068CFAFCD555AE9252A894`恢复基线；个人settings SHA256仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，见`native-verified.json`。专用settings归档移除，旧QA007现场及fixture保持；用户安装版未更新。

另登记QA153候选：原生切换历史页面后再回到文件时AX编辑节点重新创建，EditorTabs的v-else-if及FileViewer释放逻辑可能丢失跨标签的光标、滚动和撤销状态。正文保留，尚未用真实宿主做受控确认；下一轮先同步远端再核查。

本轮新增QA152缺陷并解决，另新增QA153候选；原9项加QA153共10项继续，整体七项目标未完成。提交前fetch、整合master/交付分支成功，无新提交。功能`e8deb450fa01b68ebd767d942232aec2837b8acc`首次推送成功，ls-remote完整SHA与本地一致，无凭据提示；交付补记前再次同步无新提交。
