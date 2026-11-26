# QA-111 普通文件夹自动刷新的导航隔离

日期：2026-11-26。开始前读取统一台账，fetch并快进检查master与交付分支；基线`86067379390254b75c90aca957270b8646f74aec`包含master`e2e33d96e3bc0aed8c206fe22562ab9432c8d27a`。全程主线程，未使用子代理。

## 问题与受控复现

App通过`useRepositoryRefresh(() => useFileTreeStore().refreshExpanded())`给普通非Git文件夹提供焦点/可见性和5秒周期刷新。旧实现只有一个`folderRefresh` Promise；旧文件夹的读取未返回时，切换到另一普通文件夹或重开同一路径，新的自动刷新仍被这个旧Promise挡住。

新增测试使用真实workspace/fileTree stores及实际刷新回调，模拟fsReadDir延迟返回。A首次文件树正常加载，后台读取挂起；打开B（或重开A）并完成其首次读取后模拟外部新增文件，推进完整5秒周期，旧实现仍显示初始文件。原首批6项中5项失败/1项正常对照通过；两种导航的自动更新、旧完成期间新请求等待、卸载前微任务和旧回调错误均有失败断言。没有把受控慢磁盘场景称为用户安装版已自然复现或整体卡顿根因。

## 修改

每次非Git刷新记录路径、导航代次和已发布打开代次。同一份文件树只保留一个在途刷新；切换/重开后新树可独立读取。已发布代次还区分“打开同路径尚未返回时开始的旧树刷新”和稍后发布的新树，单靠路径或导航号不足以区分这两者。

微任务开始和错误回报前确认归属；旧请求结束只清理自身标记，不释放新请求的并发保护。既有5秒刷新节奏、隐藏窗口暂停及Git刷新路径保持。没有新增定时器、重试队列或改变文件读写接口；实际File树对迟到目录内容的隔离继续由原store执行。

通用refresh回调的迟到异常现在也会隔离；生产fileTree store自身已经处理fsReadDir错误，未把测试回调主动抛错称为实际File目录错误污染。

## 验证与边界

新增最终9项包括跨路径、同路径重开、打开发布阶段、Git转换、旧finally与当前等待、微任务导航/卸载、错误恢复及同目录合并/隐藏恢复。相关4文件57项通过。完整前端首轮2035通过/2失败，失败原因是两个旧测试桩缺少`appliedOpenToken`接口；补齐后最终198文件2037项通过/4项既有probe跳过。类型/Vite构建、最终类型复查及相关Oxlint通过，构建既有分包体积/静态动态混合导入提示保留。Rust源码未改，本轮不宣称重跑完整Rust套件。

Windows debug/no-bundle构建通过，独立`app.gitx.qa111`程序SHA256为`A849F7FA261C23DA7FC0052FBD8FDABD556FAC9B4F0C42167F94593475DECF11`，PID13224，启动UTC `2026-11-26T05:25:34.7078220Z`。新profile，stdout/stderr写入文件，没有开启CDP。使用Temp下的alpha/beta两个普通文件夹，Git命令及界面均确认非仓库，避免放在项目目录下被识别成父仓库。

原生File面板最初显示alpha-original.txt，外部新增alpha-external.txt后自动出现。通过最近项目与This window切换beta，只有beta-original.txt；再外部新增beta-external.txt后自动出现，任务回到Idle，未点击手动刷新。界面文字及最终截图归档。首次点击遇到`coordinate input geometry is unavailable`，重新绑定并激活窗口后恢复；该工具错误未计为产品缺陷。精确慢读取竞态采用上述受控证据，不以普通原生更新替代，不报告输入到呈现延迟。

7个观察PID/创建时间身份全部退出，两个原文件哈希保持，两个新增文件与测试fixture保留为证据；测试settings已归档移除。用户settings SHA256仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，安装版未更新。构建源文件哈希与交付源码核对一致；提交前再次fetch及两分支快进检查成功，没有新远端提交。

证据目录：`E:/IDEAproject/gitx/test-results/qa111-folder-refresh-20261126`，包括旧失败/新回归、完整前端、构建日志、源码哈希、fixture/baseline、原生状态、进程身份及verification.json。本轮新增并解决QA111一项，原11项已知未关闭继续；提交推送状态见统一台账。
