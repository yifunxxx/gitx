# 0.1.40 原生阶段验收：克隆、远程管理与动态比较

测试日期：2026-11-19；收尾核对与记录日期：2026-11-20（Asia/Shanghai）。对应 QA-036、038、039 及 QA-010。总体目标仍为部分完成，不以本报告代替七项目标的最终同版验收。

## 版本与交付

基于远端主分支 `ce630fd`（0.1.40），本轮独立功能提交均已推送至 `origin/codex/checkout-target-safety`：

| 提交 | 内容 | 详细报告 |
| --- | --- | --- |
| `11bc80f` | 克隆完成后共享打开状态与导航保护 | [QA-036](qa-clone-open-2026-11-19.md) |
| `1d0a578` | 纯 GitX metadata 事件跳过差异重读 | [QA-034](qa-diff-refresh-cost-2026-11-19.md) |
| `b854683` | 远程编辑草稿与异步操作归属 | [QA-038](qa-remotes-lifetime-2026-11-19.md) |
| `f36a25f` | 动态修订比较刷新及同路径导航失效 | [QA-039](qa-live-comparison-2026-11-19.md) |

本地及远端最终产品提交为 `f36a25f08a86c79009bbe5b0d0c42ef05d581a4f`。推送中曾出现 HTTPS 443 超时和 SSL reset，重试后成功；本轮没有认证拒绝或凭据提示，未另外调起登录。

同一最终测试程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-lifetime-live-0140-20261119.exe`，SHA256 `896FEF96DC1139A551B39336EE491742B06B96838C626DC34414E93EE1BE4CF7`。功能原生测试和后续负载测量均使用该程序。

完整前端 **139 文件 / 1231 项**通过；类型检查、Vite 生产构建、Windows 原生构建及相关 Oxlint 通过。Vite 构建仍有 chunk 体积和动态导入警告，构建成功不表示这些警告已消除。真实 Rust `clone_cancellation` **4 项**通过。本轮没有重跑整个 Rust 工作区，历史 QA-023/032 不因此关闭。日志保存在 `E:/IDEAproject/gitx/test-results/`：

- `lifetime-live-final-tests-20261119.log`
- `lifetime-live-final-web-20261119.log`
- `lifetime-live-final-native-20261119.log`
- `clone-real-regression-20261119.log`

## 原生操作结果

| 场景 | 实际操作与结果 | 未覆盖边界 |
| --- | --- | --- |
| Clone 完成后打开 | 从欢迎页克隆本地源仓库，显示 Cloning 等待/禁用态；完成后自动打开，Log 显示两个正确提交；克隆刚完成时目标干净，HEAD 与源一致。 | 没有远程鉴权；原生取消、交叉导航及初始化未完整执行。 |
| 远程管理 | Loading remotes、重命名草稿及 Saving 可见；`origin` 改为 `qa-upstream`，实际 Git 配置一致。删除预览显示 1 条 tracking branch，Escape 仅取消确认，父窗口与远程均保留。 | 没有执行真实删除或添加；竞态、失败重试仍为组件回归证据。 |
| 历史版本与本地比较 | 从 Changes 右键 Show History → Compare with Local，右侧先显示 `local first revision`；外部写成 `local refreshed automatically` 后，右侧自动更新。 | 不声称 INDEX、符号引用、同路径竞态都已原生验收。 |
| 大列表与后台刷新 | 2000 个修改文件、3 个差异标签、90 次外部写入；独立滚轮后拖至末尾，双击 file-1999 打开正确差异，成为第 4 个标签。 | 是有限负载抽样，不是持续快滚或长期资源测试；数据见 [负载报告](qa-scroll-load-2026-11-20.md)。 |

## 七项目标的本阶段映射

此前 [0.1.37 验收表](qa-acceptance-2026-11-17.md) 保留其历史版本证据。本表只列当前构建的新证据与剩余条件，不把历史测试混写成当前构建全部复跑。

| 目标 | 本阶段新增证据 | 仍需完成 |
| --- | --- | --- |
| 基本功能 | 本地真实 Clone、远程改名、历史与本地比较自动刷新；真实克隆取消回归。 | 原生初始化/克隆取消及更多 Git 工作流的同版整合；QA-023/032 根因。 |
| 流畅度 | metadata 重复工作受控对照；当前程序大列表并发刷新和三次可确认呈现的滚轮抽样。 | 持续快滚、终端、长期负载；QA-034/008。 |
| UI 规范 | 克隆和远程管理加载、禁用态、编辑草稿及取消流程。 | 其他主题/缩放、菜单和控件；QA-009。 |
| 菜单与鼠标操作 | Show History/Compare with Local、远程删除确认取消、末尾文件双击定位。 | 其他组合及原生终端 Ctrl+C/粘贴；QA-007/009。 |
| 逻辑与资源 | 导航/弹窗/请求身份保护自动回归；25 个资源点和退出进程核对。 | 本次不是静置恢复或长期泄漏测试，不能排除所有泄漏/忙循环。 |
| IDEA 风格 Log | 克隆后两个提交显示正确；历史比较可正常进入并更新。 | 本轮没有完成复杂拓扑、分页、选择的同版组合验收。 |
| 动效与等待反馈 | 克隆阶段与完成后共享等待；远程读取/保存等待和防重。 | 原生初始化、其他按钮/动效与失败路径；QA-036/010。 |

## 测试数据与恢复

专用源仓库 `E:/IDEAproject/gitx/test-results/repos/lifetime-source-20261119` 保持干净，HEAD 为 `d8435b1ba7ab64845fe19eb322af70b33d3b70da`。本轮新建的 `lifetime-clone-20261119` 保留远程名 `qa-upstream` 与本地比较文本修改作为证据；它不存在需恢复的测试前工作区状态。

大列表 fixture 的 HEAD、索引及修改数量与基线一致，2000 个文件逐个核对预期文本，0 个异常；详见负载报告。功能测试 PID 13020 与负载测试 PID 29040 及其进程树均已退出，使用 PID 与启动时间区分进程身份。

用户设置 `C:/Users/Yifun/AppData/Roaming/app.gitx.desktop/settings.json` 已按原备份字节恢复，SHA256 为 `F160603B7BCE0F5CF7D07D6D1EAA088B6B69B79BB2F1FF83B855FB00E4F245C7`。备份为 `lifetime-settings-before-20261119.json`，结束核对为 `lifetime-live-end-20261119.json`，均在 test-results。未修改集成开发目录的独立源码。

安装路径 `D:/gitx/gitx.exe` 仍为 **0.1.35**，未替换。源码已修复推送、测试已通过和上述原生路径已验证，不能写成用户安装版已更新。台账仍有 8 项未关闭事项，后续按 [统一台账](qa-progress.md) 继续。
