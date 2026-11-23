# QA-075 打开项目首读归属

## 基线与复现

2026-11-23开始前成功fetch，HEAD/交付分支 `2064da6e5fb0fbff57c358e22e6cc4565530f5da`，包含master `42df3f730be8ddd157a6aaca8d9a2b908638c950`，工作区干净；主线程独立完成。

QA-034/036续查发现共享打开控制器和Commit/Log/Branches面板生命周期均有读取入口。新增联合回归使用真实workspace、Changes、Log、Branches、jobs Pinia store和实际面板生命周期，只替换IPC与无关外围功能。正式旧实现3项失败、普通独立挂载1项通过，证据 `E:/IDEAproject/gitx/test-results/qa075-initial-reads-before-final.log`；最初2项失败日志也保留。

已有面板在仓库变化时，以及主读取等待期间才挂载面板时，statusGet/logQuery/refsList/remoteList均调用2次。后者第二次调用推进各store代次，导致控制器等待的第一批结果被丢弃；第一批返回后，任务数已经0，但Changes/Log/Branches三个loading仍为true且status尚为空。QA-074只覆盖控制器与模拟首读，缺少这个真实组件组合，不能以其通过结果证明该入口没有遗漏。

## 修改与边界

workspace记录最后实际应用的打开结果所属导航。共享状态仅在打开操作仍属当前导航、路径已选择且结果已应用时表示首读已由控制器负责；Commit和Log的挂载/目录监听、Branches子面板的挂载据此跳过重复读。Commit原有操作状态读取保持。

选择目录和后端尚未返回时，当前显示仓库的正常挂载仍读取；取消/失败不会留下空面板。切换活动子仓库使旧所有权立即失效。状态存放在按workspace区分的WeakMap，谓词不初始化控制器或其他store；面板只依赖轻量状态模块，不引入整个打开控制器的依赖图。未修改刷新按钮、过滤/分页和仓库监听的读取策略，没有人为等待或轮询。

初次11项联合回归通过，覆盖已有/较晚挂载、五种打开入口、单独挂载、晚挂载结果不被替代、取消目录/后端失败时当前仓库读取，以及多根仓库切换。QA-074九项任务回归同时通过。首次相邻定向34项通过、BranchesPane测试装配失败：该测试完全模拟vue-i18n，而把打开控制器整体引入面板会额外加载真实i18n。通过抽出仅含Vue状态和类型引用的共享状态模块消除不必要依赖，未修改该测试断言；保留 `qa075-initial-reads-targeted.log`。

最终完整前端 **165文件/1625项通过**，类型检查与Vite构建通过，7个变更源文件相关Oxlint及diff-check通过。日志为 `qa075-initial-reads-full.log` 和 `qa075-initial-reads-build.log`；构建保留既有大分块/混合导入提示，部分既有组件测试仍有Pinia注入警告但断言通过。Rust逻辑未改，本轮不重复声称完整Rust测试。

Windows custom-protocol构建通过，日志 `qa075-initial-reads-native-build.log`，59.04秒。本项只证明重复查询次数和读取归属，不是原生耗时/FPS改善测量；持续性能目标继续。

## 原生抽查与恢复

专用0.1.44程序 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-initial-reads-0144-20261123.exe` 基于2064da6加本项修改构建，SHA256为 `FCAD85A92513673AE8038059C02CB4DD7D4F57B3403C7062C6945C1EBD5D8341`。证据目录 `E:/IDEAproject/gitx/test-results/qa075-initial-reads-native-20261123`，独立WebView profile，没有替换用户安装版。

欢迎页Ctrl+O打开2000修改文件仓库，Changes计数、main分支和Log基线提交正确。切到Console卸载Log后，通过标题栏项目菜单的Open重新选择同一目录，Log重新挂载，Changes、分支和历史均正常。观察到打开等待反馈，稳定后Idle；点击左下角任务队列显示“No running processes”。截图与无障碍树并非原子采样，不用它们推导精确首读持续时间或调用次数；五入口、晚挂载代次、慢响应及导航边界由真实组件/store联合回归验证。

5秒身份采样仅用于退出核查，不是性能趋势实验。Alt+F4正常关闭后，7个采样进程身份均已自然退出；2000文件哈希、HEAD、index树和status与启动前一致。设置只有预期的最近项目插入，独占比较后恢复本轮备份原始字节，SHA256为 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，详见 `restoration.json`。

## 交付

提交前再次fetch成功，master仍为42df3f730be8ddd157a6aaca8d9a2b908638c950，交付分支仍为2064da6e5fb0fbff57c358e22e6cc4565530f5da，两者均已包含于当前基线。代码、完整前端回归、构建和本项原生抽查完成；提交推送结果随后补记。QA-075关闭后，已知未关闭回到11项，七项目标继续。
