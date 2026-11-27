# QA138：文件内搜索与替换的输入法按键保护

日期：2026-11-28。开始前读取台账、fetch并检查master/交付分支，干净基线 `b739576b61492bcbf59db17ab862cd71b46cdd23` 包含master `50a4802dd23f61055668e165f6fe7c0b93b17680`。全程主线程。

## 缺陷与修改

文件内搜索面板自己的keydown绕过了全局快捷键的输入法保护：`isComposing`或Windows兼容信号`keyCode=229`的Enter仍执行查找/替换，Escape仍关闭面板；已被其他处理器preventDefault的事件也会再次执行。例：正文`hit hit`、选中第一个`hit`、替换值`替换`，候选确认Enter会把正文变成`替换 hit`，即使该Enter仍属于输入法。

在共享`IdeaSearchPanel.keydown`入口先返回这三种事件，保留正常Enter/Shift+Enter、Escape及现有快捷键和只读限制。输入法事件不被该面板preventDefault，也不阻止其继续传播；没有添加定时器、全局监听或编辑器状态。本项没有增加用户功能或修改快捷键，现有中英文搜索/替换教程保持。

## 验证

- 新增`editorSearchComposition.test.ts`使用真实CodeMirror状态、编辑器及搜索面板。旧实现12项中9失败、3正常对照通过；失败覆盖三种输入信号分别触发查找、替换和关闭。
- 修后这12项通过，连同已有搜索、编辑器样式和只读Diff共4文件24项通过。
- 完整前端207文件2244项通过、4项既有probe跳过。`pnpm build`中的类型检查和Vite生产构建通过；相关oxlint/oxfmt检查通过。原有chunk体积提示保留，不当成本项新增缺陷。
- 真实Chromium158.0.8127.37、真实CodeMirror模块：旧9场全部错误执行，修后9场保持正文/选择/面板状态；每场之后再由浏览器正常按Enter或Escape，查找/替换/关闭均正常，无pageerror。测试使用受控CompositionEvent/KeyboardEvent，不能冒充Windows物理中文输入法。
- `pnpm docs:check`通过：22中文/22英文Pages、79命令、33设置、318本地链接及18图片引用。Rust业务源码未变，不重复完整Rust业务回归。

Windows独立debug/no-bundle构建通过，退出码0，耗时2分23秒。归档程序`gitx-qa138-ime.exe`版本0.1.56，SHA256为`531A93F50A854EC8FBADE3A5374CE2292DE4430987CB1A2E5ACF8872EEF43FAF`，来自上述基线加本项修复及已通过构建的前端。本项未启动原生程序，物理中文输入法仍未实测，用户安装版未更新。

提交前再次fetch、检查并合并master与交付分支，均Already up to date。浏览器Vite端口1448已关闭，无本项浏览器测试进程残留。个人settings的SHA256仍为`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，与开始前相同。

## 证据与范围

证据目录 `E:/IDEAproject/gitx/test-results/qa138-search-ime-20261128`：旧/新定向日志、完整前端日志、类型/Vite及Windows构建日志、真实浏览器前后模块/脚本/结果。浏览器使用隔离上下文，结束后关闭浏览器及本机Vite服务，没有读写测试仓库正文。

新增并修复QA138一项；本项受控输入路径已验证，物理IME仍归原QA009的未覆盖边界。QA008/034持续输入断档及其余原9项继续，不将此问题归因为滚动卡顿或宣称整体七项目标完成。独立提交/推送结果见统一台账。
