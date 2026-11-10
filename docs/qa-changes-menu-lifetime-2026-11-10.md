# Changes 菜单操作目标与取消保护

日期：2026-11-10。QA-004（Changes 部分）、QA-014。

## 发现

- 文件菜单只记录显示位置和单个路径，命令实际读取可变的全局选择，仓库切换后也不立即失效。
- 回退确认后使用当前仓库和当前分区；多文件回退每轮重新读取仓库，等待取消暂存或首个文件恢复期间切换仓库可能继续操作新目标。
- 停止跟踪使用“同时写入 .gitignore？”的确认结果作为布尔选项，关闭或取消返回 false 仍调用 rmCached。新增 QA-014，需把取消与“不忽略”分开。
- ignore 的建议规则请求后重新读取当前仓库执行 ignoreAdd，存在跨仓库续写路径。
- 独立分支变更列表提示后的保护不足；集成目录已有命名/移动保护，需保留并在本轮提取到独立分支。

初始 13 项回归全部失败，覆盖上述缺口及新增生命周期约定，不等于 13 个独立缺陷。日志：`E:/IDEAproject/gitx/test-results/changes-menu-lifetime-baseline.log`。

## 修改

- 文件菜单保存操作来源、文件数组、分区和暂存模式；异步确认后继续使用原目标，不再读取新的全局选择。
- 仓库导航令牌改为可观察状态；导航刚发起时、同路径重新打开、仓库身份变化、选择/分区/模式改变时关闭菜单。组件卸载后旧请求失效，已排队的旧点击不会执行。
- 回退在确认、取消暂存及每个文件之间重新校验来源；始终向后端传递捕获的 repoId/path。已经开始的单次操作不回滚，仓库切换后停止后续文件操作。
- 忽略规则建议和写入使用同一个仓库；建议返回时来源已失效就停止。文件菜单命令的成功提示和异常提示也不回填到新仓库。
- 停止跟踪改为专用确认窗口，独立复选框决定是否写入 .gitignore；取消/关闭返回空结果，不触发 rmCached。导航使弹窗失效，并按自己的对话框 ID 关闭。
- 空白区域菜单也捕获仓库和选择，拒绝失效动作。保留“没有选中文件时使用已勾选文件”的补丁创建行为；显式文件列表按菜单传入值执行。
- 提取并保留集成目录已有的变更列表保护，使用创建操作返回的列表 ID；命名/创建/移动后校验来源，失败时不显示成功提示。全局“新建变更列表”命名提示也补仓库校验。

## 自动验证

- 最终独立分支：75 个测试文件 / 572 项通过；集成目录：98 个测试文件 / 730 项通过。两处测试有重叠，不能相加。
- 覆盖实际组件事件、两类菜单、旧点击、导航/同路径重开/往返、组件卸载、确认后变更选择、多步回退、取消与 .gitignore 选项、忽略规则建议、变更列表以及补丁文件选择。
- 初次集成完整回归中新增 ignore 测试漏配 mock，补齐后定向 16 项通过；最终完整回归已重新全部通过。
- 两处类型检查和生产构建通过；变更文件 Oxlint 和 `git diff --check` 通过。Vite 既有分块大小提示仍存在。
- 日志目录 `E:/IDEAproject/gitx/test-results/`：`changes-menu-lifetime-{baseline,focused,integration-focused,final-focused,main-tests,integration-tests,integration-recheck,main-final-tests,integration-final-tests,main-final-build,integration-final-build,final-native-build}.log`。

## 范围和交付

原生构建通过。测试程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-changes-menu-20261110.exe`，SHA256：`C4F439087D5A300DD0001356A2BFECB78E7C9BB8B592DCA2435950289CA4B11D`。

原生检查：右键隔离仓库的 `src/module/file-000.txt` 打开停止跟踪窗口，数量为 1，中文说明明确本地文件保留；勾选 .gitignore 后点击取消，窗口关闭且文件仍在；再次打开复选框恢复未勾选，Escape 关闭并返回文件行焦点。未执行确认后的 Git 写操作，确认选项的后端参数由组件回归验证。仓库切换竞态由受控异步测试覆盖，没有将其写成原生实测。

隔离仓库 `E:/IDEAproject/gitx/test-results/repos/changes-keyboard-gui-20261110` 的前后快照为 `test-results/changes-menu-gui-{before,after}.json`；Git 状态、索引以及 86 个文件哈希完全一致。测试程序已关闭，`D:/gitx/gitx.exe` 未替换。

QA-014 已关闭；QA-004 的 Changes 部分完成，功能提交/推送待落库补记。Log 菜单和重写对话框的目标保护另有未完成路径：QA-004 保留 Log 菜单跟进，新增 QA-015 记录独立分支重写对话框内部缺少仓库/卸载校验，集成目录已有部分保护。不能以本轮 Changes 测试代替 Log 验收。
