# QA-079 分支比较方向与请求归属

日期：2026-11-23。开始前fetch成功，HEAD/交付`83bd1ebe3f9f1e923b3962584069a49e58bdb1e1`一致，包含master`42df3f730be8ddd157a6aaca8d9a2b908638c950`，工作区干净。主线程独立完成。

## 复现

真实DialogHost、比较组件、弹窗栈及任务队列，控制backend Promise返回顺序。旧实现13项中12失败、1正常对照通过，日志`E:/IDEAproject/gitx/test-results/qa079-before-20261123.log`。

- Swap发出新请求后，较早请求的成功/错误可覆盖新结果。原错误也不会在新读取开始或成功后清除。
- 方向标题已交换时仍显示上一方向的提交；初次读取和交换方向没有等待状态，失败没有同方向重试入口，也没有任务队列条目。
- 导航或仓库身份改变后窗口仍在，Swap直接读取新仓库；旧请求返回没有生命周期保护。

检查后端`compare_range`确认leftOnly表示`left..right`，即right独有提交；rightOnly表示`right..left`。现有两栏语义与此契约一致，本次没有改变范围方向或误修字段命名。

## 修改与验证

弹窗绑定打开时的仓库、导航及ID；导航改变时只关闭自己的弹窗，关闭或卸载后旧结果失效。每次读取推进序号，只接受当前请求的成功/错误及loading结束。交换方向立即清除旧列表与错误，显示明确等待状态；失败提供同方向Retry，Swap仍可响应新方向。可在读取期间Escape关闭，已发出的IPC完成后只释放任务，不触碰后来打开的窗口。

compareBranches是此弹窗的显式用户读取，接入现有backend活动包装器，每个实际请求在任务队列中保留至IPC结束。未把普通后台读取加入队列，未添加取消能力或吞掉异常。增加中英文等待/重试/范围说明及弹窗可访问标识。

- 新增13项全部通过，含成功/错误乱序、旧请求不能解除新loading、交换中清空旧结果、失败后Swap/Retry、四种导航失效、Escape和替换弹窗、队列释放及正常范围展示。
- 与标签创建、分支操作归属、活动队列及词条一致性合计5文件81项通过，日志`qa079-focused-20261123.log`。
- 完整前端169文件/1714项通过，类型检查和Vite生产构建通过，变更文件Oxlint及diff-check通过；日志`qa079-all-20261123.log`、`qa079-build-20261123.log`。保留既有大分块提示。
- Windows构建通过（56.16秒），日志`qa079-native-build-20261123.log`。原生复查后修复下面的布局问题，又通过完整169文件/1714项、类型/Vite、Windows构建（1分12秒）及相关Oxlint/diff-check；日志`qa079-layout-tests-20261123.log`、`qa079-layout-build-20261123.log`、`qa079-layout-native-build-20261123.log`。后一次测试命令带`--`实际仍运行完整套件，按日志记录，不称作定向29项。

## 原生复查及布局修正

首轮组合程序`gitx-branch-dialog-0144-20261123.exe`（SHA256 `BE5D809FCB2A864B82269F2C6EF9A8F27AE8AB04F61EB744192AEF92BC874BB8`，PID28596，启动UTC`14:07:59.7138507Z`）完成本地fixture的main/topic比较。初次打开及Swap显示Comparing branches和底部任务队列；两方向的独有提交分别与Git的`d363a2b QA main only`、`d3ebd9e QA topic only`一致。Escape关闭并返回原分支入口，结束任务详情为No running processes。同期标签真实推送拒绝/重试见[QA078](qa-tag-create-lifetime-2026-11-23.md)。

本次观察另发现同功能交互缺陷：加载时对话框由约390px缩到82px，成功后撑回，Swap/Close纵向跳动约154px。登记QA079补充证据后重新fetch确认master42df3f7/交付83bd1eb无新提交。修正外框固定390px且最大80vh、结果区弹性填充；标题保留完整悬浮文字并允许截断，错误区可滚动、重试按钮不压缩。没有新写只断言CSS类的单测。

最终布局程序`gitx-branch-dialog-layout-0144-20261123.exe`，SHA256 `B0B0DE8198FC35A365580B5C31DD195CB52860D20CD7782419998CB13E197730`，PID9392，启动UTC`14:23:32.3610239Z`。在同一fixture完成初次比较、Swap加载/完成和Close。四个实际截图中窗口均约390px，Swap/Close保持同一纵向位置，两方向内容正确；不是输入延迟测量。原生错误布局/极窄窗口未另实测，读取错误及Retry逻辑由上述自动回归覆盖。

证据目录分别为`E:/IDEAproject/gitx/test-results/qa-branch-dialog-native-20261123`和`qa-branch-dialog-layout-native-20261123`，保留程序身份、UIA记录和现场恢复结果。两次各7个观察进程身份正常退出；5秒采样只用于收集退出核查身份，不作为性能实验。fixture文件/status/HEAD及原有分支保持，唯一期望新引用为QA078的测试标签。两次设置仅预期最近项目插入，独占比较后恢复原字节，SHA256 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。

工具对元素索引/文件选择框的一次读取不一致，通过重新截图及坐标输入恢复；UIA与截图有采样时差，不据此推断产品卡顿。受控乱序/导航用例不写成原生自然慢请求实测；没有修改Rust实现或用户安装版。

功能已独立提交`7e2ae76635d4f14ca67b851c1bb63db2af22dda0`并首次推送成功；ls-remote核对交付分支完整SHA一致，无凭据提示。提交前及补记前fetch成功，master仍`42df3f730be8ddd157a6aaca8d9a2b908638c950`且是HEAD祖先，没有待整合提交。QA079关闭本项修复，整体七项目标及11项已知未关闭事项继续。
