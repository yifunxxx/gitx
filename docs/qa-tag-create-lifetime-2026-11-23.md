# QA-078 标签创建与推送的生命周期

日期：2026-11-23。开始前fetch成功，HEAD/交付为`99bbcd3f93ce3c1351a80c0871902d31458406e2`，包含master`42df3f730be8ddd157a6aaca8d9a2b908638c950`，工作区干净。主线程独立完成。

## 已复现问题

真实DialogHost、弹窗栈、CreateTagDialog、任务队列和backend活动包装器联合回归，backend写入由Promise控制。旧实现12项中11失败、1正常对照通过，见`E:/IDEAproject/gitx/test-results/qa078-before-20261123.log`。

- 在A仓库打开后切到B，Create向backend传入B路径；同路径新导航、仓库身份变化、非仓库状态也没有失效。
- 重复点击可以发送两次创建，输入和取消/Escape未锁定；请求期间更改名称还能使成功提示显示错误名称。
- 旧弹窗关闭后新弹窗打开，旧完成回调默认关闭当前弹窗并显示过期提示。
- 旧界面把创建及推送交给一个IPC。后端先创建本地标签再推送，推送失败无法在界面区分，重试会再次创建。源码路径为`src-tauri/src/commands/refs.rs::tag_create`；本次用明确的两阶段frontend回归验证新的恢复方式，不声称旧组合IPC已做原生失败实验。

## 修改

打开时捕获源仓库、导航和弹窗ID，身份改变时只关闭自己的弹窗。提交前与每段返回后检查归属；已关闭/卸载/过期请求不能提示、关闭别的弹窗或继续派生推送。已经发出的IPC可能完成，本次不宣称取消或回滚。

创建期间锁定输入、Create和Cancel，并阻止Escape关闭。状态分别显示创建/推送；现有backend活动包装器分别把阶段放入任务队列，完成或失败后回收，无重复UI任务。增加中英文文案和可访问名称。

前端先调用tagCreate且pushRemote为null，成功后记录不可变的标签名及远程，再调用tagPush。推送失败明确说明本地标签已存在，输入保持锁定，按钮变为“重试推送”；重试保留原名称/远程，不重复创建。关闭部分成功窗口向调用者返回成功以刷新本地引用。未配置远程时禁止误称创建并推送成功。两次IPC各自遵守既有仓库写锁，不声称跨两个调用的事务原子性。

## 验证

- 最终新增16项全部通过，包含正常/失败重试、四种导航失效、重复提交及Escape保护、任务队列、替换弹窗、迟到完成、阶段分离、只重试推送、原远程/名称保持及部分成功关闭。
- 完整前端168文件/1701项通过，日志`qa078-all-20261123.log`。初始定向5文件44项在追加4个边界用例前通过，最终16项包含在全量中。
- 首次类型检查发现新测试辅助函数类型不匹配，修正其参数类型后，类型检查及Vite构建通过；保留`qa078-build-20261123.log`失败记录和`qa078-build-final-20261123.log`成功记录。变更源文件Oxlint和diff-check通过。
- 既有真实Git测试`remote_fetch_push_update_roundtrip`通过，含本地附注标签创建及refs列出，日志`qa078-tag-git-20261123.log`。不把它写成新弹窗推送失败重试的原生证据。
- Windows custom-protocol构建通过（54.18秒），日志`qa078-native-build-20261123.log`。无Rust实现修改，未重复完整Rust回归。

## 交付与原生复查

功能提交`83bd1ebe3f9f1e923b3962584069a49e58bdb1e1`已独立推送，ls-remote完整SHA一致，无凭据提示。提交前及开始QA079前fetch成功，包含master`42df3f730be8ddd157a6aaca8d9a2b908638c950`及最新交付分支。

2026-11-23与QA079组合原生复查使用独立程序`gitx-branch-dialog-0144-20261123.exe`，SHA256 `BE5D809FCB2A864B82269F2C6EF9A8F27AE8AB04F61EB744192AEF92BC874BB8`，PID28596，启动UTC`14:07:59.7138507Z`。独立WebView profile；证据目录`E:/IDEAproject/gitx/test-results/qa-branch-dialog-native-20261123`。

- 新建隔离repo/main、topic和本地bare remote。专用pre-receive钩子拒绝推送。GUI输入qa-native-tag并勾选推送，实际观察Creating tag及任务队列；失败后明确提示本地已创建、名称/选项锁定、Close和Retry push可用。
- Git核对本地标签为`d363a2b5ac14d47d338cf7a0ce916b4142ec1f1a`，远程没有此标签。移走本轮创建的拒绝钩子，GUI重试显示Pushing tag和队列，完成后窗口关闭。local/remote标签均为同一SHA，本地标签没有重新创建报错；结束队列为No running processes。重试只调用tagPush的次数断言仍以组件回归为证据。
- `tag-before-retry.json`、`tag-after-retry.json`和两阶段UIA记录保留；截图实际观察正常，但工具UIA与截图偶有采样时差，不用其测量延迟。
- 正常退出后7个已观察进程身份均退出。fixture文件/status/HEAD保持，refs仅增加预期标签；设置在独占核对仅预期最近项目插入后恢复原字节，SHA256 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。首次退出检查脚本字符串比较不适合PowerShell自动DateTime反序列化，最终重查按时间ticks并记录PID不存在，使用`observed-identities-after-exit-final.json`及`restoration.json`为证。

原生验证补齐真实Git失败/重试普通路径；跨仓库、迟到完成和精确防重时序仍为受控回归。没有向用户仓库或线上仓库创建标签，未更新用户安装版。
