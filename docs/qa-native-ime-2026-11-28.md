# QA009：系统中文输入法原生续验

日期：2026-11-28。本轮补齐QA138、QA151、QA042/043此前只有受控事件或文字填入的部分输入法证据。开始前读取台账，fetch并整合master和交付分支成功；续办时再次同步，无新提交。基线`0fa0a391c91bcc0890073ed49b93241553588749`包含master`50a4802dd23f61055668e165f6fe7c0b93b17680`。全程主线程，没有产品源码修改。

## 环境与方法

使用0.1.56、与QA153最终产品一致的独立程序`E:/IDEAproject/gitx/test-results/qa-native-ime-20261128/gitx-ime.exe`，SHA256为`E848800CBFAB7C6BBB68103E4C8FD397138D54D6A3437AF72CB83AF9C3E427BF`。单独WebView profile及`app.gitx.qa153loading20261128`设置，无诊断端口。新建无remote的三提交仓库，正文含`hit hit`、`中文 one`和`中文 two`，中间提交说明含`修复中文输入 zhongwen`。

通过第一方CUA原生`pressKey`逐个发送拼音字母，截图实际观察Windows中文候选框，再分别按Return、Space或Escape。这里是原生按键经过系统IME的验证，不是人工实体键盘、合成CompositionEvent或setValue中文。只有替换测试的初始ASCII查找词`hit`使用setValue准备。没有录制页面事件，因此不声称测量了WebView事件字段或精确时序。

本机输入法中，组合中的Return提交原始拼音，Space选取第一个中文候选；Escape取消当前组合。部分AX读数比截图迟一拍，例如取消后短暂仍报告`q`，以之后稳定界面和正文为准，不将其计作产品缺陷。

## 实际结果

| 入口 | 操作与观察 | 结论 |
| --- | --- | --- |
| Log消息筛选 | 原生键入`zhongwen`，出现“中文”等候选。第一次Return后字段为`zhongwen`，仍显示三个提交、无Text筛选标签；第二次Return才出现`Text: zhongwen`并只剩中间提交。 | 组合确认不误应用筛选，普通回车有效。 |
| Log中文筛选 | Clear恢复三个提交；再次键入拼音，Space得到“中文”且仍为三个提交；Return后只剩对应中间提交。 | 中文候选提交与筛选结果正确。 |
| New Changelist | 输入`zhong`并观察候选，Return后弹窗仍在，字段为`zhong`。全选后输入`q`启动新候选；首次Escape取消候选，输入清空、弹窗保留；第二次Escape关闭。 | Prompt组合Enter/Escape保护通过。未创建变更列表。 |
| 文件内替换 | Ctrl+H、查找`hit`并选中首个匹配。在Replace输入`zhong`，候选Return后正文仍为`hit hit`，标签无未保存标记；第二次Return后变为`zhong hit`并标记未保存。编辑器Ctrl+Z恢复原文且标记消失。 | 组合确认不误改正文，普通替换及撤销有效。 |
| 文件内查找 | 原生拼音后Space确认“中文”，第二、三行匹配均高亮；普通Return后首个中文匹配被选择。输入`q`出现新候选，第一次Escape只取消候选、保留搜索替换面板，第二次Escape关闭面板。 | 中文匹配和两阶段取消通过。未单独验证查找框组合Return的选择不变。 |
| 全局搜索 | Ctrl+Shift+R打开窗口。原生拼音后Return得到`zhongwen`，自动扫描返回0处；重新输入后Space得到“中文”，自动扫描返回2处/1文件/扫描1文件。两次确认均没有打开结果或关闭窗口。 | 确认后自动刷新符合现有行为；不能将其误写为“组合回车后不扫描”。 |
| 全局替换 | 切到Replace，输入`zhong`并确认候选；预览更新为`zhong one`、`zhong two`，仍停留原窗口，没有执行写入或进入确认。新`q`候选的首次Escape保留窗口，第二次Escape关闭。 | 组合确认只更新预览，取消边界正常。未执行批量替换。 |

全局搜索的补充源码核对：`ContentSearchDialog.vue`监听查询及替换文本，变更后经220ms防抖重启扫描；keydown先排除输入法、229及已消费事件，普通查询框Enter用于打开所选匹配。Space确认也触发自动刷新，不能仅凭Return后的加载画面判定误触发。此次未观测到新缺陷，没有新增稳定编号或产品修复。

## 回收与证据

关闭全局窗口、确认正文及标签无未保存状态后，正常点击程序关闭。根PID26872（创建时间`2026-11-28T15:18:59.7947040+08:00`）及7个子进程全部按PID、路径和创建时间核对退出，没有强杀。

`verify-native.py`核对成功：HEAD为`bc7d086d0a88536d04d6045b9c904b7914f4741d`，index树为`c591b6f728ec0d935ea75e47d5ab5c9f86140b2f`，Git状态为空，notes.txt的SHA256为`b48db867f1ed59c7933ee0c0281ba3c0b2e5b0d9df1b24d4d6a795d4e033ba79`，均与开始前一致。个人settings保持`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。专用settings归档为`settings-after.json`、核对哈希后移除原设置文件，profile与fixture保留作证据。

证据目录`E:/IDEAproject/gitx/test-results/qa-native-ime-20261128`包含prepare/verify脚本、native-target/baseline/identities/exit/verified JSON及归档设置。GUI过程依据本会话第一方CUA截图和AX输出逐项记录；本轮没有另存截图，JSON不冒充GUI事件轨迹。旧QA007终端程序PID35288及原创建时间仍匹配，本轮未操作其权限现场。

## 范围与交付

此轮只补有限入口的系统IME原生证据。其他输入法、人工实体键盘、精确长按、Credential/Confirm、全部Log字段/修订定位、终端、拖放与主题组合继续保留边界。QA009及另外8项已知未关闭事项、七项目标仍在进行；不能用本轮通过结果关闭全部输入/界面验收。用户安装版未更新。

本次只更新验收文档和索引，复用QA153当前产品的完整2474项前端及构建证据，不重复运行未改动的业务测试。提交前再次fetch并检查master/交付分支成功，无新提交；diff空白检查、Pages检查及这7份报告/索引的417处本地QA链接检查通过。Pages检查覆盖22中文/22英文页面、79命令、33设置、318本地链接及18图片引用。最终提交和推送状态以统一台账为准。
