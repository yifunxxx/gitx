# QA-099 按块预览更新时复用 Commit 文件模型

日期：2026-11-26。开始前读取台账并fetch/两分支快进检查成功，基线`3e7a993`包含master`5241dd5`及最新交付分支，全程主线程。接续QA034/008的后台刷新和临时分配检查，不将本项归因于全部滚动卡顿。

## 问题与确认

按块归属启用后，文件内容或预览token更新会替换`changelists`。此前即使各列表的文件、顺序与状态完全相同，`filesByList`和`unversioned`仍返回新数组；ChangesTree重新生成sections闭包，丢弃目录模型，再生成所有行。只修改列表标题也有同样目录重建。

真实store、ChangesTree及VirtualList的新增回归先在旧实现运行，树/平铺内容刷新和仅改标题3项失败；真实归属移动对照通过。后端IPC被测试桩替代，树构造及Vue更新为真实代码。

2万文件场景只有一个文件有部分归属，其余19999个普通修改文件。每轮发布新的预览/内容token，文件状态保持；5轮均重新处理19999+1个路径，重建20005行。旧版耗时58.7–80.3ms，中位70.45ms；修后单独运行28.5–47.3ms，中位30.04ms，5轮均无目录重建并复用原行数组。计时包含测试桩的status复制、store和组件更新，不是原生滚轮延迟；无硬毫秒阈值测试。

第一次修后与其他4测试文件并行执行，出现73.7ms样本，记录保留；最终单文件复测与旧组具有相同执行范围，不删除较慢组。不能把有限的合成样本外推为所有场景稳定帧率。

## 修改及资源边界

- store比较当前分组的FileChange引用及顺序，保留未变化的分组数组；未变化的unversioned也复用原数组。原status比较仍保证路径、状态、种类变化必须发布。部分预览、错误与内容token继续发布，已勾选提交的旧token仍被冻结。
- ChangesTree将懒加载目录模型与标题分离，标题修改复用模型；只有所有可见分组元数据和成员都相同才返回原sections，保留行数组。折叠组仍只读计数，展开才生成最新目录。
- 缓存只由当前分组持有，不增加全局历史Map；目录model不引用旧section，连续改名不会形成section引用链。移除的分组或旧仓库随当前引用替换释放；没有用本次结构审阅替代原生堆泄漏验收。

## 自动验证

新增9项常规回归及1项显式性能probe覆盖：树/平铺内容更新、焦点/勾选/旧token、标题变更、真实归属移动/勾选修剪、读取错误、折叠改名及最新状态展开、新建文件归属/状态、列表顺序/删除、跨仓库清理。导航回归首轮捕获的是测试保留已卸载VirtualList包装器，改为查询当前实例后通过。首轮类型检查指出新测试缺少DiffHunk.header及两个wrapper API类型问题，已修正重验，产品契约未放宽。

最终完整前端192文件1963项通过，1项性能probe默认跳过并已单独运行；类型/Vite、Windows独立profile构建、相关Oxlint、文档校验和diff检查通过。Vite保留既有大chunk提示。Rust实现未变，本轮未重跑完整Rust测试。

证据目录：`E:/IDEAproject/gitx/test-results/qa099-changes-model-refresh-20261126`。性能probe通过`GITX_QA_TREE_COST=1`显式运行，避免机器负载影响普通CI正确性。

## 原生与交付

独立2000修改文件fixture使用`app.gitx.qa099`测试profile。测试程序`gitx-qa099.exe`的SHA256为`7BDFF147EFD2DD06A65C590F6414D15F07D50A4A39669CAA3AEFAB87CEB3A012`，主进程身份为PID27904、启动UTC时间2026-11-25T19:13:34.6911705Z；没有替换用户安装版。

同一文件的两个块分别归属Changes与Feature。原生界面完成以下复查：

- 折叠Changes、展开并勾选Feature的文件，目录和列表勾选联动，Changes保持未选；双击差异的两块归属标签正确。
- 每两秒写入一次前置行，共六次，差异更新至`QA099 refresh 6`，文件选择、Feature勾选和Changes折叠状态保持。
- 将Feature改名为Reviewed Feature，列表标题和差异标签同步更新；切换平铺模式，选择及勾选保持。恢复原内容与名称后，浅色主题显示正确。
- 新增测试文件后，树形Unversioned(1)出现；只删除本轮创建且已核对内容的文件。
- 展开Changes并滚动至首个可见文件为file-0012，再触发后台内容更新；差异更新，列表仍停在file-0012。随后恢复原文件并正常关闭程序。

截图见`native-after-refresh.png`和`native-scroll-refresh.png`。此次只是普通滚轮与后台刷新的状态保持复查，没有连续快滚帧时间或堆泄漏测量，也没有执行真实提交。QA034/008/040的相关验收边界保留。

`native-restoration.json`核对2000文件内容、HEAD、index、status、metadata和用户设置全部一致。`native-exit.json`确认8个观察进程身份均退出。测试profile的settings归档并核对SHA256后移除，见`native-settings-cleanup.json`；用户设置哈希保持`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。

提交前再次fetch及两分支快进检查成功，仍包含master`5241dd5`和交付`3e7a993`。功能提交`c747b5e331a6ec789b489134394856ea2fa8c7b4`首次推送成功，ls-remote完整SHA一致，无凭据提示。交付补记前再次fetch/两分支检查成功，master无新提交。QA099修复、所列验证及交付完成；其他11项已知事项及七项目标继续。
