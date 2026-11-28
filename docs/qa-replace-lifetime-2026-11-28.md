# QA139：批量替换结果通知与共享写入保护

日期：2026-11-28。开始前读取台账、fetch并检查master/交付分支，干净基线 `7a6bdb595acd9b90f1bd3ae952faf7646bc26ad6` 包含master `50a4802dd23f61055668e165f6fe7c0b93b17680`。全程主线程。

## 已确认问题与修改

批量替换还在执行时切换项目或重新打开同一路径，外层搜索窗口会按原有逻辑关闭，但后续成功、部分成功及失败仅尝试更新已经失效的窗口，用户无法知道源项目实际完成了多少文件。现在当前窗口仍有效时保留窗口内反馈；窗口失效或卸载后，显示包含源目录的结果通知，部分失败及异常通知持续显示，直到用户关闭。

File操作此前没有检查编辑器共用的 `fileMutationPending`，可以与在途批量替换并发写入，并在自身结束时提前将共享状态清零。现在操作入口及异步确认完成、实际发起写入前都检查该状态；被拒的操作不启动任务、不调用文件修改接口，也不释放其他操作持有的锁。替换完成后可以重试。没有新增排队或自动重试机制，没有改变后端替换和取消语义。

中英文搜索教程补充切换项目期间的任务、取消、结果通知及其他文件操作/保存暂不可用的行为；本项没有新增命令或快捷键。

## 测试假设纠正

早期测试直接挂载内部 `ContentSearchDialog`，观察到其写入期间拒绝关闭，曾将“窗口残留”列为候选。随后核对 `actions/definitions/m7.ts` 的真实入口为 `FileSearchDialog`，外层已经负责关闭过期窗口。最终测试改为实际外层并传入 `content:true, replace:true`，旧版窗口关闭对照通过。相关关闭改动已撤回，最终产品没有修改导航关闭行为。

直接组件旧/新测试及浏览器结果只作过程证据，不算实际入口缺陷。首次测试mock缺少 `createI18n` 的装配错误亦单独保留，不计产品缺陷。

## 最终验证

- 新增9项采用真实 `FileSearchDialog`、`DialogHost`、Pinia工作区/编辑器/任务/File操作store，后端与确认时序受控。旧实现6项失败、3项正常对照通过；修后9项全部通过。覆盖跨项目、同路径重开、嵌套弹窗草稿、部分成功、卸载后异常、当前写入Escape保护、编辑草稿、入口写锁及晚到确认。
- 最终定向4文件79项通过、1既有probe跳过；最终完整前端208文件2253项通过、4既有probe跳过，退出0。此前直接组件版本的日志不代替最终验证。
- 真实Chromium `158.0.8127.37` 加载实际外层、真实stores/弹窗/通知组件，模拟延迟IPC：跨项目、同路径、嵌套新弹窗、异常四场旧版均因结果通知缺失失败，修后四场通过；当前写入Escape及正常成功对照通过，无pageerror。额外断言旧、新版本均关闭过期窗口且保留在途任务和锁。
- 查看最终 `source-result.png`，通知显示源目录 `C:/source`、完成1个文件、`b.txt`取消信息及Dismiss。模拟IPC没有向任何真实仓库写盘，这不是Windows原生替换/导航竞态验收。
- 最终 `pnpm build` 类型检查与Vite生产构建通过；相关oxlint/oxfmt、`git diff --check`通过。已有动态导入混用/chunk体积提示保留。
- 双语Pages检查和VitePress构建通过（22中文/22英文页面、79命令、33设置、318本地链接、18图片引用）；教程在此后未变。Rust业务未改，沿用[当前组合验证](qa-combined-validation-2026-11-28.md)的666项通过证据，不宣称本项重复运行完整Rust。

Windows最终独立debug/no-bundle构建通过，退出0，耗时1分46秒。归档程序 `gitx-qa139-replace.exe` 为0.1.56，SHA256：`F846F6964F542FCA5304F2E71E58646011043EA77B0E4F263F29920546B44D6A`；来自本报告基线加最终产品修复。早期构建的dist含已撤回的关闭改动，不作最终产物。

提交前再次fetch及两分支快进检查成功，无新提交。浏览器和Vite正常关闭，1449端口不再监听，无对应Chrome测试实例。个人settings SHA256仍为 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`；本项没有启动原生GitX程序、修改测试仓库正文或更新用户安装版。

## 证据与交付

证据目录：`E:/IDEAproject/gitx/test-results/qa139-replace-navigation-20261128`。

- `registered-entry-before.log`、`final-targeted.log`、`final-full-frontend.log`：实际入口旧/新与完整回归。
- `browser-check.mjs`、`harness.html`、`browser-results.json`、`browser.log`、`source-result.png`：最终实际入口浏览器对照。
- `final-build.log`、`docs-build.log`、`final-native-build.log`：最终构建；`early-native-build.log`仅为早期过程。
- `direct-component-*`、`before.log`、`write-guard-before.log`、`targeted.log`、`full-frontend.log`和`test-setup-error.log`保留被修正的测试假设与装配过程，不扩大其结论。

本项新增并关闭QA139，修复结果反馈与共享写入保护，回到原9项持续验收/归因事项，整体七项目标继续；精确原生竞态和持续滚轮性能没有借此宣称通过。独立提交/推送状态见[统一台账](qa-progress.md)。

功能提交 `3b85715ce0c7642ae7a3b296b7ee79bc4667f93d` 首次推送成功，远端完整SHA核对一致，无凭据提示。补记前再次同步master和交付分支，无新提交。
