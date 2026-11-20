# QA060 Combined Diff 读取失败被显示为空内容

开始前fetch成功，当前0efe2542b31848c2bf0b35c864ce47bd02df541f包含远端master efc2a8afe17af6f4c937c8c95c8f7e58dc834b0a与交付分支，无未提交修改。上一轮完成QA059属于有证据的进展，总体目标继续。

compare.rs的diff_combined将两侧读取错误统一unwrap_or(None)。先等价提取至GitRunner::combined_diff，保留旧行为，再以真实Git仓库回归：文件清单和第一文件完整读取成功，第二文件目标blob缺失被返回为纯删除，基础blob缺失被返回为纯新增；Windows工作区文件共享锁也被吞掉。3失败/3对照通过，证据qa060-before-final-20261120.log。最初测试用了错误的DiffLineKind类型，编译失败不作为复现证据；已改为实际hunk字符串格式再运行。

修复读取错误直接返回，保留错误code、command、stderr、exit_code等数据，message补充文件路径和修订。使用QA059的差异专用读取，让合法文件/目录替换依然支持空侧。完整结果只在所有已请求文件成功后返回，失败不发布部分列表。前端每次请求前清除已有combined结果，避免重试时看到过期差异；旧实现该回归失败，其余1474项通过（pnpm参数意外触发整套前端测试，记录实际范围）。

后端新增6项、相关32项通过：两侧缺失blob及恢复重试、工作区锁及恢复、双向文件/目录替换、新增/删除/重命名/二进制、EMPTY、limit及取消/无效修订。日志qa060-targeted-20261120.log。前端和原生最终结果随后补记。

原生fixture为test-results/repos/combined-read-errors-20261120，独立仓库无remote。缺失对象准备时普通删除因只读属性失败，带强制删除的后续命令被自动审批拒绝，均未改变对象；改为同目录保留备份的可恢复重命名成功。原生测试后恢复并核对对象及仓库状态。

最终验证：前端定向13项、完整153文件/1475项通过；类型检查、Vite生产构建、Windows原生构建、相关Oxlint与Rust格式检查通过。日志分别为qa060-ui-targeted-20261120.log、qa060-ui-final-20261120.log、qa060-web-build-20261120.log、qa060-native-build-20261120.log。完整Rust508项属于上一轮QA059基线，本轮执行相关32项，不将历史结果写成当前全量复验。

原生同仓库对照：QA059程序先从Log选择两次提交，Compare Versions→Show Combined Diff。a.txt正确显示新旧两行，z-broken.txt错误显示@@ -1,1 +0,0 @@及纯删除，未报错。修复版在相同缺失对象条件下显示Could not read z-broken.txt、修订及Git原始错误，没有发布部分差异；恢复对象后直接点同一按钮重试，两文件均正确显示旧行删除与新行添加。UIA证据为qa060-native-20261120/old-false-deletion.txt、new-read-error.txt、new-recovered.txt，截图在工具会话中观察，未另行导出。

旧二进制SHA256为A70AEA473077214691D443B0278416E9B8327D669E75D58367D94F5AD15B29F4，新二进制为B53F42B767ACA434470C1F44610460F9B07BB611E74A0803007A380E0B843F7D；新程序基于0efe254及本项产品修改，源码哈希见new-build.json。两个专用主进程29012/13372均已退出。对象字节、两个工作文件SHA256、HEAD、index tree和clean status与baseline.json一致；设置与prepared语义一致，仅序列化变化，恢复原始备份后SHA256为6DD5D73EAD1F19D1860AE9B143659A0753756E82DFF7B5F5FCCB588693F05335，详见cleanup.json。未替换用户安装版。

提交前fetch成功，origin/master仍为efc2a8afe17af6f4c937c8c95c8f7e58dc834b0a，交付分支为0efe2542b31848c2bf0b35c864ce47bd02df541f，均为HEAD祖先。代码、自动回归和本项原生失败/恢复路径已验证，提交推送结果后补。Combined按钮等待/重复请求为另行核查线索；并发导航仍由现有代次回归覆盖，本次未将这些边界写成新原生验收。

独立功能提交dee2722821d992fa7c611d50c1d3b2da586c5b29已推送，ls-remote完整SHA一致；首次推送成功，无凭据提示。后续fetch再次确认远端master与交付分支均已包含。按钮等待与防重复另列QA061。
