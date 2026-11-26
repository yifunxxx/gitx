# QA-103 Worktree 打开流程的等待与导航保护

日期：2026-11-26。开始前读取台账并fetch/合并检查，基线`504af31d9744ccb01e3144a8112203de047ebef3`包含master`5241dd5d64683d03c6e3f5e901ea7293d2c199b3`和最新交付。全程主线程。

提交前远端已合入504af31并删除交付分支，主分支升至`e2e33d96e3bc0aed8c206fe22562ab9432c8d27a`（0.1.48）。本地正常快进整合，原交付祖先关系检查通过；后续针对已删除交付ref的merge命令报ref不存在，不代表主分支同步失败。5文件差异均为版本号，最终类型/Vite及原生构建按0.1.48重做，前端产物文件名保持。原完整逻辑回归在0.1.47完成，未冒充0.1.48整套重跑。

## 问题与修改

Worktrees的“在当前窗口打开”、双击新窗口、创建/打开引用后的自动打开均进入`worktreesStore.openWorktree`，旧实现独立等待窗口选择、直接打开仓库或新进程，遗漏共享打开控制器。因此选择未结束时可重复请求，其他导航完成后旧选择仍可能替换当前项目，旧窗口失败也可能在新项目中提示；首次文件/Log/分支读取没有共享任务范围。

新增12项受控回归，旧实现11失败、1个取消/失败重试对照通过，确认上述调用链缺陷。它们使用真实Pinia、workspace/worktrees/job store、共享控制器和Worktrees组件，后端/选择及独立首读为受控Promise；不冒充原生用户已遇到全部竞态。

修复将worktree入口接入`createWorkspaceOpen`，保留双击优先新窗口、当前窗口询问和创建后打开的原行为。共享operation从选择阶段开始防重，导航变化使旧选择/错误失效，主窗口首读共用任务和面板读取；新窗口启动也加入任务队列，结束或失败时只清理自己的任务。

Worktrees行和打开/创建入口响应共享等待；打开按钮增加旋转图标、禁用与可访问busy/status。共享状态在store创建时建立可观察引用，避免首轮渲染先看到空WeakMap后computed永久缓存false。没有重写Git工作树创建、删除、锁定或prune语义。

## 自动验证

- 新增12项：双向跨入口防重，旧here/new选择失效，新窗口重复/失败归属，初读成功/失败任务，create/openRef自动打开，取消和失败重试，以及实际Worktrees组件的禁用/恢复。
- 首轮定向修后94/95通过，发现新computed对尚未创建共享状态的响应遗漏；修正为引用共享operation后7文件95项通过。随后扩展实际Changes/Log/Branches面板的首读共享测试，加入Worktrees入口。
- 最终完整前端193文件1976项通过、1项既有性能probe跳过。类型检查、Vite生产构建及修改文件Oxlint通过。构建保留既有chunk大小及混合动态导入提示。
- 首次旧失败及首次定向执行使用默认Node20并提示engine不满足；最终定向、完整回归和生产构建均加载项目测试环境的Node24.22.1。日志分开保存，不能把不同阶段写成同一次运行。
- 本次未修改Rust/绑定/依赖，未重复无关Rust套件。

## 原生复查与恢复

最终0.1.48独立`app.gitx.qa103`程序构建通过，SHA256为`9CF5E5FFEA9C58F629374997558AF9D301DE8A1FEB5FFF2B24438853B41E1576`；前端入口SHA256为`1AF083FFBE28B29C4D0AEB6558FE2FF666DD13556E8184B3DAE3333792F82C9E`，主JS为`560DF8D5576A412668D3CEDCABA62485148BFCBE06B04A50EF35125E0B78B327`。前一份0.1.47构建仅归档，没有拿来做本轮原生验收。

使用新建main/feature两个工作树、独立settings/WebView目录；fixture原本各有一项未暂存修改。原生实测范围：

1. 主工作树中选择feature并点击Open Here，窗口选择框出现；标题栏最近项目、工作树行、新建/打开引用及打开按钮均禁用，打开按钮显示等待图标。取消后留在main，入口恢复、Idle可见，再次打开成功。
2. 当前窗口打开feature时，以测试Git代理仅挂起feature的一次真实status输出；Commit显示骨架，Log/分支读取先完成，左下持续显示Opening project及目标路径。释放前代理PID31684仍存活，显式等待4240ms后释放；随后Changes仅feature-only.txt，分支qa-feature、目标路径及Log正确，回到Idle。
3. 在feature的Worktrees面板双击main行，独立main窗口出现并展示README.md修改、main分支和正确路径。关闭新窗口后，原窗口仍为feature/qa-feature及feature-only.txt，任务为Idle。

原生使用受控延迟验证首读等待；旧选择/错误晚到、重复请求并发和create/openRef自动打开由自动回归验证，未把这些全部宣称为原生实测。持续滚轮、跨根初读竞态及长期资源验证仍属于原目标剩余项。

两个窗口正常关闭后，9个观察进程身份（PID与创建时间）全部退出。main/feature的HEAD、refs、index树、status及4个文件（包括工作树.git链接文件）SHA256全部与baseline一致，原有两项未暂存修改保持。测试settings归档移除，用户settings SHA256仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`；用户安装版未替换。

证据目录：`E:/IDEAproject/gitx/test-results/qa103-worktree-open-20261126`，含旧失败、最终定向/全量、类型/Vite/原生构建、源码补丁/哈希、截图与UIA、门控记录、准备及核对脚本和仓库基线。提交前再次fetch成功，master仍e2e33d9；旧交付504af31已在主分支内，推送时重建同名交付分支。QA103实现及上述验收完成，原11项已知未关闭继续；提交推送结果见统一台账。
