# QA-036/010 项目切换与 Log 组合原生验收

2026-11-23开始前成功fetch，HEAD/交付分支 `212aff1bb03e1743c181149285324f0b5a185659` 一致，包含master `42df3f730be8ddd157a6aaca8d9a2b908638c950`，工作区干净。该HEAD只比产品 `1ec392ddff34fd9a4dfc608cc38631594431b968` 多交付记录，本轮复用相同产品程序，不重新构建或重复完整回归。

程序为 `gitx-recent-flow-0144-20261123.exe`，SHA256 `6FCADD2D738D037C1575B572128A960DC04E04271C97336C5C24C3ED5017AF5B`；独立profile、无trace。证据目录：`E:/IDEAproject/gitx/test-results/qa-navigation-log-20261123`。由主线程独立完成。

## 实际步骤与结果

1. 欢迎页最近项目打开 `large-log-qa`，顶部显示Loading，完成后主分支main和无本地修改，Log显示octopus合并图。最大化Git面板后曲线、节点与三父提交详情可见。
2. 在定位框输入 `qa-early` 并回车，看到Locating commit，再选中 `QA history 00100`，详情SHA `596e23aaad1e60f9775c1676f5bb986e9e525c92`，与独立 `git show` 一致。历史窗口显示Load newer commits与Back to latest。
3. 点击该行后Shift+Down，00100和00099两行同时高亮。加载较新提交时显示Loading，完成后两行仍选中且保持原屏幕位置，详情为00099的 `79b3bf1b8694e2d540a2a6ee62ca70f53eb3ae15`。未通过这一步验证Ctrl按住单击或持续滚轮。
4. Back to latest返回初始octopus图和对应详情，历史窗口翻页提示消失。
5. Ctrl+O打开 `changes-load-20261119`，还原Git面板后看到Changes(2000)、main及 `20e7b3b7963d129818958ae9ae9f9abb2a461926` 的唯一提交，未显示旧历史内容。
6. 标题栏最近菜单切回 `large-log-qa`，主内容重新显示无本地修改、octopus历史和对应文件/详情，任务恢复Idle。定位框草稿仍为qa-early，但没有自动在新仓库执行旧定位请求。

这是一轮普通顺序组合操作，没有人为制造原生慢IPC、跨请求乱序、持续快滚或性能计时。旧结果晚到/同路径竞态仍以受控回归证明；QA-036/010尚不能据此整体关闭。

## 新发现与现场

截图 `01-recent-open.json` 和返回过程显示标题栏仍Loading、左下角已Idle。代码审阅发现 `workspaceOpen` 只在后端调用期间进入任务队列，共享打开控制器继续等待Changes/Log/Branches时没有任务。这是QA-063覆盖遗漏，另登记QA-074并先受控复现；不把截图时序单独作为完整根因证明。本批未修改产品代码。

正常关闭后7个观察进程身份均退出。两仓库共2001文件、HEAD、index树、status保持，Log仓库50个引用保持。设置仅按三次打开更新最近顺序，通过排他句柄和字节比较恢复本轮备份，SHA256 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。用户安装版未替换。5秒采样只用于进程身份核对，不用于资源趋势判断。
