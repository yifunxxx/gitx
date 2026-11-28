# QA147 任务队列读取反馈与失败恢复

日期：2026-11-28。开始前读取台账、fetch及master/交付分支检查成功，干净基线`1bb4a870abd8689d342122246cf129761eb0c0a4`包含master`50a4802dd23f61055668e165f6fe7c0b93b17680`。全程主线程。

## 发现与修改

来源为任务队列和30秒校准调用链审阅。打开队列时，jobsStore静默吞掉jobList失败；列表未返回或失败时，弹层仍按已有行判断空态，可能显示“没有正在运行的进程”，状态栏也可能显示空闲。真实store、组件和浏览器对照确认这一误导。

现在公开读取中与读取错误状态。没有已知任务时，状态栏区分检查中、状态不可用和空闲；已有任务保持显示，失败附错误标记。弹层持续显示错误详情及重试入口，读取期间有等待反馈且重试禁用；长错误换行并限制高度。失败保留事件驱动的任务和取消状态，成功有效快照才清错，过期快照不覆盖更新后的任务。销毁或失效owner的迟到错误不再发布，没有新增定时器或自动错误重试。

中英文教程同步说明读取失败和重试。没有新增快捷键。

## 自动验证

证据目录：`E:/IDEAproject/gitx/test-results/qa147-jobs-refresh-20261128`。

- 首10项新回归在旧版全失败，6项既有对照通过（`before.log`）。最终新增14项，相关7文件49项通过（`targeted-final.log`）。
- 完整前端212文件2365项通过、4项既有probe跳过，94.99秒、退出0（`full.log`）。覆盖失败保留、成功恢复、事件覆盖、取消并发、失效/销毁及防重复请求。
- 类型/Vite构建通过，35.30秒（`build.log`）；双语Pages构建通过，29.41秒（`docs-build.log`）。相关oxlint/oxfmt及diff检查通过；Vite既有大chunk提示保留。
- Windows debug构建通过，2分33秒（`native-build.log`）；保存为`gitx-qa147.exe`，SHA256 `7B00404D8AEF669CB01E11851D313F6E05D17747F964D2320F293349880FA45C`，专用identifier `app.gitx.qa147jobsrefresh20261128`。本项没有Rust产品改动，不重复此前完整Rust工作区。

## 浏览器交互

Chrome158.0.8127.37，实际JobsPopup、StatusBar、jobsStore、Pinia、CSS及中英文翻译，仅backend的list/cancel受控。英文浅色、中文深色各一场：旧两场等待期间误显空队列；修后两场通过，无pageerror（`browser-final.log`、`browser-results.json`）。

修后验证读取中不显示空态，失败详情及状态栏提示可见；Tab/Space可重试，重试期间按钮禁用，关闭重开不会新增请求。请求期间事件加入三个任务，第二次长错误仍保留任务，错误区域没有横向溢出或窗口越界。取消入口仍可用，取消中状态跨成功刷新保持；成功清错、结束事件后显示空态，Escape关闭并恢复状态栏焦点。四张中英深浅色截图已保存，其中英文短错误和中文长错误/三任务截图已目视复查。

首次脚本因Vite解析后的绝对backend路径没有匹配mock，pending未建立而失败；补齐绝对路径匹配后，最终四场完成。原`browser.log`及`browser-first-results.json`保留为夹具问题，不计产品失败。1454测试服务和浏览器均由finally关闭。

## 原生与交付边界

本项没有在Windows应用注入jobList读取失败，浏览器模拟不作为原生IPC故障验收。QA007旧剪贴板权限现场保留，未操作隐私提示；旧fixture HEAD/index/status/文件和个人settings经脚本复核保持，个人settings SHA256为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。用户安装版未更新。

提交前fetch及master/交付分支检查成功，无新提交。新增并解决QA147一项；相邻启动事件缺少取消能力/重复事件覆盖问题另登记QA148候选，尚未受控确认。原9项加QA148共10项已知未关闭，整体七项目标继续。独立提交推送结果随后核对。

功能提交`9daf49a44f032bf4d368c50eca702d22075351bb`首次推送成功，ls-remote完整SHA与本地一致，无凭据提示；补记前再次fetch及master/交付分支检查成功，无新提交。370处本地报告链接、Pages及fixture/settings保持检查通过，交付状态见统一台账。
