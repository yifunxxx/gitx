# QA148 任务启动信息与重复事件保留

日期：2026-11-28。开始前读取台账、fetch及master/交付分支整合成功，干净基线`d16577f154167c6988ec869790bf4b8c298bc028`包含master`50a4802dd23f61055668e165f6fe7c0b93b17680`。全程主线程。

## 发现与修复

来源为QA147相邻事件链审阅。clone/statusProbe的Tauri启动事件只发送id/title，background fetch另外包含cancellable但同样没有startedAt；JobManager内部广播没有另一路前端桥接，不能依赖它补齐。前端将缺失字段覆盖已有快照，并把同id任务移到末尾，导致取消按钮/进度丢失和开始时间重置。真实useAppEvents/store/JobsPopup联合回归及浏览器受控对照确认前端影响。

三处启动事件统一发送既有JobInfo，与jobList使用同一数据来源，包含真实取消能力和开始时间。前端事件桥接传递开始时间，保留字段缺省含义；store原位合并同id任务，缺失字段保留已有标题、取消能力、开始时间和进度。明确的false、0和空字符串不会被当作缺省。取消中状态仍归本次取消请求；结束后删除行，再使用同id不会继承旧进度或取消状态。没有新轮询、额外缓存或快捷键。

## 验证与构建

证据目录：`E:/IDEAproject/gitx/test-results/qa148-job-start-events-20261128`。

- 新增7项实际useAppEvents/Pinia/JobsPopup回归，旧实现6失败、1结束后重用对照通过，既有监听器清理2项通过（`before.log`）。
- 修后相关7文件50项通过（`targeted.log`），包含首次完整事件、快照后稀疏事件、取消期间重复启动、明确false/0、旧发送方首次观察时间、事件覆盖过期快照、结束后重用。
- 完整前端213文件2372项通过、4项既有probe跳过，94.64秒、退出0（`full.log`）。类型/Vite构建通过，36.06秒，既有chunk警告保留（`build.log`）。
- Windows真实Git clone取消回归4项通过，1.06秒，含运行中取消/并发文件保留及排队取消/锁释放（`clone-cancellation.log`）。Rust应用lib63项通过、1项既有ignored，9.41秒（`rust-lib.log`）。没有重复此前完整Rust工作区。
- 相关oxlint/oxfmt、cargo fmt、Clippy（`cargo clippy -p gitx --lib -- -D warnings`）及diff检查通过，Pages命令/设置/双语链接检查通过。生成绑定的公开命令参数和返回类型没有改变，本项未新增教程操作或快捷键。
- Windows debug构建通过，1分57秒（`native-build.log`）；保存为`gitx-qa148.exe`，SHA256 `B958BBFCBB8BBA8A7D5E33F6120BB20C2AE361DD8D2D379AA633155CA34D9404`，专用identifier `app.gitx.qa148jobstartevents20261128`。

## 浏览器交互与边界

Chrome158.0.8127.37，真实useAppEvents、store、弹层、状态栏、样式及中英文翻译；仅Tauri订阅和backend调用受控。英文浅色和中文深色各一场，旧两场失败、修后两场通过，无pageerror（`browser.log`、`browser-results.json`）。

旧场景按原clone载荷发送id/title，首次没有取消按钮；列表快照补齐后，迟到同id启动事件再次移走行并清掉取消能力和42%进度。修后以完整JobInfo形状载荷首次即可取消，列表后再发送旧稀疏事件，顺序、1234开始时间和42%进度保持，取消按钮仍有键盘焦点。Space发起取消后，重复启动不解除取消中状态，结束事件后空态正确，Escape恢复状态栏焦点。中英截图已保存并目视复查；卸载后四个监听器全部移除，1455服务/浏览器在finally关闭。

浏览器载荷是按前后源码契约构造的受控输入，没有把它当作Windows真实Tauri事件采集；原生精确事件/列表交错未验收。旧QA007权限现场保留，用户安装版未更新。原9项继续覆盖性能、原生输入、其他UI及组合验收边界；本项不归因历史滚轮断档。

提交前再次fetch及master/交付分支整合成功，无新提交，祖先关系检查通过。旧fixture HEAD/index/status/文件及个人settings核对保持，个人settings SHA256 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。本轮完成QA147/148两个任务反馈缺陷，回到原9项已知未关闭事项，整体七项目标继续。独立提交推送结果随后补记。
