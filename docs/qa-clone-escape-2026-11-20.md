# QA-041：克隆等待期间 Escape 失效

日期：2026-11-20。接续QA-036原生取消验收，在实际输入中发现的新缺陷，与QA-040静置CPU线索分别处理。

## 原生复现

修复前程序 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-runner-pss-0140-20261120.exe`，SHA256 `6A0100C88CC57CD888DEA78EB99DADB884FF8F9E3CFFBCE7DC9B7ACEAB1504E3`，对应PSS功能 `a1f72b8`，PID15140。

本机fixture仅监听127.0.0.1的随机端口，接受Git HTTP请求后不返回数据，每连接最长120秒，服务最多10分钟。目标目录预先确认不存在。它用于等待期间取消，不模拟成功克隆或远程鉴权，不记录请求头、凭据或正文。所有操作均在独立test-results目录内。

第一轮输入URL和目标后点击Clone，观察到Cloning repository、输入/Browse/Clone禁用以及1个后台任务。URL预检的10秒超时与真正克隆的连接分别记录。点击Cancel后返回欢迎页，状态恢复Idle/no repo；4个Git相关进程按PID+StartTime核对全部退出。连接在按钮工具输入开始约128ms后关闭，工具截图完成约401ms；这些时间包含工具调用，不能当作精确呈现延迟。目标留下未完成的`.git`，符合现有保留目录避免误删其他写入的策略，不宣称回滚删除了目录。

第二轮重新打开克隆，使用另一个不存在的目标目录，等待Git实际连接后按Escape。UTC `2026-11-19T17:37:00.750Z`发出按键，随后及再观察时弹窗仍Cloning；UIA焦点为RootWebArea而非弹窗内控件。到UTC `17:37:40.354Z`改点Cancel才退出，连接在`17:37:40.480Z`关闭，远早于120秒fixture期限，排除把服务到期误认为取消。4个Git相关进程随后全部回收。

点击提交按钮后该按钮被禁用，浏览器焦点退回文档；Escape在文档上分发，没有经过CloneDialog局部overlay的keydown监听。这也是原组件测试直接给组件触发Escape未覆盖的路径。

修复前证据目录 `E:/IDEAproject/gitx/test-results/`：`qa036-button-running-20261120.json`、`qa036-button-cancelled-20261120.json`、`qa036-escape-running-20261120.json`、`qa036-escape-failed-20261120.json`、`qa036-slow-clone-20261120-013019-f324fc63-connections.jsonl`。fixture源码为`qa036-slow-clone-20261120.cjs`，计划与OS身份分别为`qa036-clone-cancel-plan-20261120.json`、`qa036-server-identity-os-20261120.json`。

修复前程序及fixture服务已退出，`qa036-native-exit-20261120.json`核对18个观察过的进程身份无存活成员；设置未改变，SHA256保持 `F160603B7BCE0F5CF7D07D6D1EAA088B6B69B79BB2F1FF83B855FB00E4F245C7`。两个目标目录保留为测试证据。

## 修改与验证

修改前新增body/document目标的两项失败回归，均未调用jobCancel。原组件触发方式不具备此覆盖；happy-dom不会完整模拟WebView禁用按钮后的失焦，测试显式将焦点移到body重建已原生观察的输入目标。

CloneDialog增加document冒泡阶段Escape兜底，仅当固定dialogId仍为当前顶层、组件存活且事件未被消费时处理。忽略IME/isComposing/keyCode229、按键自动重复及defaultPrevented；局部overlay仍阻止传播，避免同一键重复取消。挂载时同步注册，卸载移除同一监听函数。克隆开始后的nextTick仅在当前弹窗仍处于等待且没有取消时将焦点移到Cancel，保持键盘路径；快速完成、关闭或弹出凭据框后不抢焦点。

新增9项真实DialogHost栈回归覆盖文档焦点、Cancel焦点、重复取消、IME/已处理事件、嵌套确认/凭据框归属、旧弹窗关闭到Vue卸载间隙、监听释放及取消失败后重试。最终标准Node24.22.1/pnpm10.33.4定向5文件39项通过，相关Oxlint/diff-check通过，独立审阅无阻塞项。修改前失败日志使用当时默认Node20，最终验证采用项目所需新版本；不能把运行时差异当作产品修复。

完整前端141文件/1248项通过，类型检查及Vite生产构建通过；保留既有chunk体积/动态导入警告。`cargo build --offline -p gitx --features tauri/custom-protocol`原生构建通过。本项仅修改前端，Rust产品源码仍为已通过完整490项的PSS版本，没有重复计算旧回归。

证据 `qa041-escape-before-20261120.log`、`qa041-escape-targeted-20261120.log`、`qa041-final-tests-20261120.log`、`qa041-final-web-20261120.log` 位于同一test-results目录。

独立审阅另记录QA-042待核查：Confirm/Credential自身Escape监听没有IME/defaultPrevented保护，可能在Host检查前已关闭。当前测试证明嵌套普通Escape不会误取消Clone，没有宣称修复子弹窗自身的该边界；本功能不修改这些组件。

## 修复后原生验收

新程序 `E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-clone-escape-0140-20261120.exe`，SHA256 `E5AA5EC8FADD76AD5B8DA898D43C055017CBA6A1B1CFB165F54A39C1F394942F`，PID29144；使用同一fixture脚本的新端口60263和两个预先不存在的目标。

第一轮鼠标点击Clone后，Cloning/禁用/后台任务显示正常，实际HTTP连接等待期间直接按Escape，弹窗关闭并回到Idle/no repo；4个Git相关进程身份全部退出。第二轮重新打开，点击Clone后再点遮罩空白，UIA焦点为RootWebArea，Escape同样取消并回到欢迎页，另4个Git进程全部回收。连接分别在按键工具调用开始约108ms/101ms后关闭，均约28秒时取消，远早于120秒连接期限；不将工具与服务器时间当作精确输入到屏幕延迟。

第二轮立即回传的UIA树仍短暂包含旧弹窗，但同轮截图已显示欢迎页，随后重新观察的树确认弹窗消失。首轮聚焦Cancel策略有组件回归证据，原生UIA仍报告RootWebArea，截图没有独立证明Cancel焦点；本项原生结论只确认两条Escape路径成功，不把工具焦点报告等同DOM activeElement。第一次点击入口遇工具geometry unavailable，刷新窗口并激活、截图后重试成功，不计产品缺陷。

原生证据：`qa041-final-native-20261120.log`、`qa041-program-20261120.json`、`qa041-server-identity-os-20261120.json`、`qa041-server-connections-20261120.jsonl`、`qa041-{focus,document}-{running,cancelled}-20261120.json`。测试程序及服务均退出，`qa041-native-exit-20261120.json`记录全部观察身份无存活成员，设置SHA256与原备份一致。两目标保留未完成`.git`作为证据，没有递归清理。安装版未更新。

## 交付边界

QA-041代码、自动回归、原生复查已完成，独立提交为77176db122cc3f067951fbbb8b100a3580503df8。2026-11-20推送先遇OpenSSL SSL_read连接重置10054，随后两次连接github.com:443约21秒超时；均为网络失败，未触发凭据请求。单次使用HTTP/1.1重试成功，ls-remote返回完整SHA与本地一致；没有修改永久Git配置，不能将一次成功归因为HTTP版本。

QA-036原生按钮/Escape取消已补验，交叉导航等时序仍保留组件回归和待验收边界。QA-040静置归因、QA-042输入边界及持续滚动/长期负载仍未完成；用户安装版未替换，整体目标仍在进行。
