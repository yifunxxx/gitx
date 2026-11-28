# QA-043：Enter误提交及取消按钮行为

后续证据：2026-11-28[系统IME原生续验](qa-native-ime-2026-11-28.md)确认New Changelist的实际候选Return只提交拼音、不会提交Prompt。Credential、精确长按及其他输入法仍保留边界。

日期：2026-11-20。由QA-042的同源输入审阅发现，独立修复、提交和验证。

## 发现与复现

Prompt和Credential把`@keydown.enter.prevent`绑定在整个dialog容器，输入法组合、229、已处理及重复Enter均调用提交；焦点在Cancel按钮时也被容器截获并提交，阻止按钮自己的取消。空Credential虽然未通过字段校验，但仍阻止IME默认行为；默认allowEmpty的Prompt可提交空串。

独立临时回归16项中14失败、2正常Enter通过；真实`promptCredentials`链使用stub后端，确认IME Enter和Cancel Enter错误结果会调用credentialSessionSet（storeHelper=true）并向上返回retry=true。没有保存真实凭据、调用真实helper或执行网络重试。

正式回归33项在产品修改前28失败、5正常对照通过，覆盖Prompt输入、Credential用户名/密码三种目标、按钮和checkbox、空值校验及保存/重试边界。该失败数量包含默认行为断言，不是28个独立缺陷。临时证据为`E:/IDEAproject/gitx/test-results/qa043-enter-review-20261120/`，正式日志为`qa043-enter-before-20261120.log`。

### 修改前原生证据

使用QA-041程序`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-clone-escape-0140-20261120.exe`，SHA256 `E5AA5EC8FADD76AD5B8DA898D43C055017CBA6A1B1CFB165F54A39C1F394942F`，PID11148，启动时间2026-11-20T02:13:59.117834+08:00。

新建独立仓库`E:/IDEAproject/gitx/test-results/repos/qa043-dialog-input-20261120`，HEAD `cdd65eed0583fab982e2efe9d8b262ca483ec87d`。打开New Changelist，输入`qa043-before-cancel`，Tab后截图确认Cancel焦点环，按Enter后弹窗关闭。磁盘`.git/gitx/changelists.json`确实写入该名称，确认取消操作被当作提交，并非仅测试模拟。

工具UIA焦点报告停留RootWebArea、弹窗树短暂不更新，焦点与结果以截图及磁盘证据分别核对；不将UIA陈旧记录当产品焦点错误。目录选择曾遇工具cached element unavailable，重新观察后使用截图定位完成，不计产品缺陷。

证据`qa043-native-before-{enter,settled,data,exit}-20261120.json`。旧程序及采样的8个进程身份均已退出，修改前创建的变更列表保留为独立fixture证据。

## 修改及验证

Enter监听仅绑定文本输入，四类拒绝事件及字段无效时直接返回；有效输入才preventDefault/stopPropagation并提交。Prompt的allowEmpty与Credential用户名trim/密码必填规则保持，Credential按钮禁用和提交复用相同条件。按钮及checkbox不再由容器拦截，浏览器负责按钮键盘激活。

定向6文件80项、类型检查、相关Oxlint和diff-check通过。首次after有3项测试装配错误：消费者后注册在相同输入的冒泡阶段，产品先执行，事件当时尚未defaultPrevented。改用capture消费以准确构造“已经处理”的事件后通过，保留首次日志，不把该测试修正当作额外产品修复。最终日志`qa043-enter-final-targeted-20261120.log`、`qa043-enter-{typecheck,lint}-20261120.log`。

完整前端143文件/1301项、类型检查及Vite生产构建、Windows原生构建通过；日志为`qa043-final-tests-20261120.log`、`qa043-final-web-20261120.log`和`qa043-final-native-20261120.log`。已有chunk体积/动态导入警告保留。独立审阅无阻塞项，本项没有Rust改动，不重复统计此前490项工作区回归。

## 修复后原生验收

同一最终程序`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-dialog-input-0140-20261120.exe`，SHA256 `59EA2034659900D84FDB2DBB411D3C830C1F30EAC1B0F9A7A90590B1BFC8FEDB`，PID17252，启动时间2026-11-20T02:22:53.428118+08:00。

| 操作 | 结果及磁盘核对 |
| --- | --- |
| 输入qa043-after-cancel，Tab到Cancel，截图确认焦点环后按Enter | 弹窗关闭，changelists.json没有该名称；与修改前同路径行为形成对照。 |
| 重新打开并输入qa043-after-enter，在输入框内按Enter | 正常创建，changelists.json包含该名称，活动列表正确。 |
| 重新打开并输入qa042-after-escape，再按普通Escape | 正常取消，changelists.json没有该名称；补验QA-042正常取消入口。 |

证据`qa043-program-20261120.json`、`qa043-after-{cancel,enter}-metadata-20261120.json`、`qa042-after-escape-metadata-20261120.json`及工具回传截图。两代程序共16个采样身份均退出，最终记录`qa043-final-exit-20261120.json`。fixture的HEAD、干净status、README和index哈希均保持基线；两个已创建名称保留为独立测试证据。设置只有recentWorkspaces被本轮操作改变，核对其他字段无变化后恢复原备份字节，SHA256回到`F160603B7BCE0F5CF7D07D6D1EAA088B6B69B79BB2F1FF83B855FB00E4F245C7`。

物理IME候选/长按及真实凭据GUI未验证；synthetic keydown不产生浏览器可信默认click，测试将不拦截与显式click分开。本轮只将Prompt的Cancel/输入Enter和普通Escape记为原生通过，不扩大为所有输入法和凭据路径。安装版未更新。

独立提交`21ced015ad751f8292bdd769dab9d4dd05224e90`推送成功（远端报告0e57390..21ced01）。随后三次独立ls-remote复核分别遇SSL连接重置10054、443连接约21秒超时，以及RPC连接重置/expected flush after ref listing，不能将复核失败写成推送失败；未出现凭据请求。交付记录单独提交，后续网络恢复时继续核对。

后续复核已完成：记录提交`b8a400a7f76729fa291d391dfa22fe2c786f6804`推送成功，ls-remote返回相同完整SHA；该提交包含QA-043功能及上述验收记录，远端已确认。不再将早先复核网络失败保留为当前交付阻塞。
