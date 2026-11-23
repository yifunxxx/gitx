# QA-074 打开项目首次读取的任务反馈

## 发现与基线

来源：产品1ec392d的[原生导航组合验收](qa-navigation-log-2026-11-23.md)。欢迎页最近项目打开及标题栏切回时，标题栏仍Loading，左下角显示Idle。开始前成功fetch，HEAD和交付分支均为 `452041adda7943bbe021ae32d67be2c3e06c8cc5`，包含远端master `42df3f730be8ddd157a6aaca8d9a2b908638c950`。由主线程独立完成。

公共后端观察器只跟踪 `workspaceOpen/initRun/vcsEnable` 的调用。共享控制器随后仍等待Changes、Log和Branches首次读取，这些方法本身属于后台读取，不进入队列。因此在首次主读取慢时会出现顶部等待、任务栏空闲的矛盾。这是QA-063任务覆盖遗漏，与QA-073辅助最近列表慢响应隔离是两个问题。

## 修改

后端打开完成后、首次主读取开始前，建立一个包含仓库路径的“打开项目”任务。所有必要读取结束后在finally释放，失败也释放；每个请求保有自己的任务ID，旧仓库完成不会清理新仓库任务。原有后端任务保持，只在后端调用结束后接续首次读取任务，正常单操作不会重叠登记。

取消选择目录、非仓库文件夹不创建主读取任务；最近项目辅助读取不延长任务。没有人为延迟、计时器、轮询或新增取消按钮；没有改后端读取行为。

## 受控回归

测试使用真实Pinia workspace/jobs store及公共 `withBackendActivity` 包装器，只有IPC和首次读取为可控制Promise。正式旧实现 **8失败/1通过**，失败均在主读取等待期间观察到0个任务，取消/非仓库对照通过。日志 `E:/IDEAproject/gitx/test-results/qa074-open-queue-before.log`。

修后新增9项通过，覆盖folder/create/recent/clone/enable五入口在后端阶段及主读取阶段各保持1个任务；原生jobList协调不丢UI任务；最近列表仍未返回时主读取完成能清理；A/B重叠读取旧成功/失败只移除自己的任务；主读取失败反馈及重试；取消和非仓库不产生多余读取任务。

首次相邻定向检查7文件65项通过、WelcomeView文件装配失败：它全部模拟store且没有Pinia，新增jobs依赖触发不完整的vue-i18n替身。补齐同层jobs替身，不改产品实现；失败日志保留 `qa074-open-queue-targeted.log`。首次全量中其余四个Commit组件文件同样未提供Pinia/jobs替身，85项未进入业务断言，1529项通过；已补齐这些不执行项目打开操作的组件替身。保留 `qa074-open-queue-full.log`，不把装配失败计作产品缺陷或隐去失败记录。

最终完整前端 **164文件/1614项通过**，日志 `qa074-open-queue-full-final.log`。类型检查、Vite和Windows custom-protocol构建通过，相关7个TypeScript文件Oxlint与diff-check通过。Vite保留既有大分块提示；构建日志为 `qa074-open-queue-build.log` 和 `qa074-open-queue-native-build.log`。Rust逻辑未改，本轮没有重新运行完整Rust测试。

## 原生抽查与恢复

专用程序 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-open-queue-0144-20261123.exe` 基于452041a加本项修改构建，SHA256为 `8ABDF879CD9D61217BB3F182F1F93CE0A21537558A91218C07DBD2995387C798`。证据目录 `E:/IDEAproject/gitx/test-results/qa074-open-queue-native-20261123`，独立WebView profile，不替换用户安装版。

Ctrl+O打开2000修改文件仓库成功，Changes计数、main和Log基线提交正确。立即观察的无障碍文本包含“Opening project”，同次截图已经显示Idle；截图与无障碍读取不是原子采样，不能把两者写成同一帧或声称完整捕获了首次主读取阶段。后续稳定观察为Idle，点击左下角后明确显示“No running processes”，没有残留任务。五入口、慢主读取、失败及交叉导航的精确时序以受控回归为证据，本轮未作原生延迟注入或性能测量。

目录对话框一次元素索引调用返回cached state不可用；重新截图后用实际按钮坐标完成，未据此登记产品缺陷。关闭后的第一份窗口列表仍有句柄，紧接着按PID和启动时间核对，7个采样身份均已自然退出。2000文件哈希、HEAD/index/status保持；设置仅有本次最近项目插入，排他检查后恢复原始字节，SHA256为 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。

## 交付

后续真实组件组合检查补充：QA-075发现面板挂载/目录监听会重复首读，并可替代本任务等待的读取代次。QA-074的控制器任务注册修复保留，不能把其受控回归视为完整组件组合已验证；[首读归属报告](qa-initial-read-ownership-2026-11-23.md)继续记录复现及修复证据。

提交前再次fetch成功，master仍为42df3f7、交付分支仍为452041a，均已包含于当前基线，无需补合并。QA-074独立功能提交 `40faa298c9c1fcdc280b34c129a6373f720c1112` 首次推送成功，独立ls-remote核对完整SHA一致，无凭据提示。补记交付记录前再次fetch成功，无新远端提交。已知未关闭事项回到11项，七项目标仍在进行。
