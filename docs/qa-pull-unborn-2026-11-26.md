# QA-102 空仓库首次 Pull 的文件列表

日期：2026-11-26。开始前读取统一台账并fetch、检查主分支及交付分支；基线`1ca621b`包含master`5241dd5`。本轮全程主线程，用户安装版未替换。

## 复现和修改

无HEAD仓库首次Pull成功后，旧实现将空字符串作为旧revision传给文件比较，错误被转为空列表。实际文件已落盘、HEAD正确、Incoming也正确，但Update Info无法说明新增了哪些文件。

新增三个真实Git测试分别覆盖普通Merge、Rebase和no-commit首次Pull，旧实现全部在文件列表断言失败。修复在首次Pull前通过现有Git空树接口取得比较基线，成功后比较空树与新HEAD，返回的old_head仍保留为空。没有硬编码对象SHA，已有HEAD的比较及Squash/no-commit索引比较不变。

## 自动验证

相关7个Rust测试目标共55项通过，0失败：m2_branches_sync7、pull_incoming8、pull_unborn3、submodule_safety12、sync_safety10、update_incoming7、update_local_changes8。新增测试精确核对3个新增文件及A状态、二进制字节、中文空格路径、全部传入提交、本地未跟踪内容，以及第二次Pull无更新/无文件/无提交的对照。

fmt和应用/gitx-git所有测试目标Clippy通过。前端源码未修改，复用QA100已验证的dist，入口SHA256为`47BE0949AFD3BEF309BCFECD93B134AC27E687F501A42E4F7AE035B3ABE56F60`；本轮不声称重跑全部前端或无关Rust套件。

## 原生验收与交付

Windows独立`app.gitx.qa102`构建成功，程序SHA256为`D50CC27455E865C95D422C041E6CCE67348B54F412A0C700EB21AAF3087867AD`。使用新建无HEAD工作仓库、本地bare远端和独立设置/WebView目录；启动前确认HEAD不存在，只有keep-untracked.txt，没有预先checkout或fetch。

从原生主菜单进入Pull，默认origin/main及普通Merge；首读Loading、执行时按钮禁用和左下Pulling任务均可见，完成回到Idle。Update Info完整显示README.md、binary.bin、目录/new file.txt三个绿色新增文件，Incoming为远端两个提交。界面和可访问文本已归档。

真实Git核对新HEAD为`c6c17762abfd264681ec1f8608fb04ad4c493715`，索引树为`9856448c3fcb8b406a50dd8089a392d2fcca6704`，均与源仓库一致。三个文件SHA256全部与源一致；keep-untracked.txt内容哈希保持，status仍仅为该未跟踪文件，Stash为空。

第二次原生Pull完成后回到Idle，HEAD/index/文件/status仍保持。Update Info按既有syncStore逻辑保留最近一次实际更新，未切换为空列表；不能把这张截图写成原生空列表证据。重复Pull的updated=false及空文件/提交返回契约由三个真实Git回归断言验证。首次Rebase/no-commit属于自动回归范围，未声称三种策略全部GUI实测。

正常关闭后8个观察进程身份（PID与创建时间）全部退出，测试settings归档后移除。用户settings SHA256保持`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。新建fixture结果保留作证据，用户工作仓库和安装版未更新。

证据目录：`E:/IDEAproject/gitx/test-results/qa102-pull-unborn-20261126`，包含旧失败/修后通过日志、构建及Clippy日志、准备/核对脚本、初始与最终状态、截图、原生文本和退出记录。QA102验收完成，提交前远端复核及推送状态随后补记。
