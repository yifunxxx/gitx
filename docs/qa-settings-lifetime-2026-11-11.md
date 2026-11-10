# 设置预览、保存与 Git 路径测试

日期：2026-11-11。对应 QA-024，来源于 QA-009 的设置页审计。代码、自动回归和下述原生流程已验证；整体目标继续。

## 发现与修改

- 原设置窗被 DialogHost 或外部调用关闭时，没有恢复未保存的主题/语言。预览现在有各自的生命周期，任意关闭路径均清理；旧窗口的清理和旧保存响应不会覆盖新窗口预览。系统主题变化使用当前预览；系统监听在 store 释放时回收。
- 原保存可重复发起，没有错误反馈，延迟完成的“确定”会关闭当时最上层的新弹窗。现在提交快照、保存期间锁定字段与按钮、固定原弹窗 ID，拒绝过期回填；失败保留草稿并显示实际错误，可重试。store 串行保存，失败不会阻断后续请求。
- 原 Git 路径“测试”会立即替换全局 GitRunner，取消设置仍留下副作用；空路径测试读取的是已保存路径。现在始终测试当前输入，只有正式保存才更换运行器，过期路径测试结果不回填。
- 进一步发现显式无效路径会自动回退到系统 Git，显示成功。新增精确路径测试入口，非空路径严格验证；空白路径才自动发现。保留启动阶段原有探测策略。
- 搜索页面标题现在显示该页所有字段。英文竖线标题被翻译系统当成复数分隔符，现改为中点并补中文标题。
- 设置字段关联可见标签，复选框不再只读为“开/关”。Fetch 间隔拒绝空值、小数、负数和超过 1440 的值；字段内显示范围错误并禁用保存。
- Keymap 编辑随保存禁用，页面使用剩余高度，避免标题叠加导致双重高度。Keymap 绑定/重置和输入录制行为继续列入 QA-009 待核查，本轮不把它算作完成验收。

## 自动验证

首轮回归重现了四个缺陷：预览残留、旧响应误关新弹窗、连续点击三次保存、按“外观”搜索无字段。新增 20 项前端回归覆盖取消/卸载、错误重试、保存防重与锁定、旧窗口/新窗口预览、语言/系统主题、监听回收、测试路径乱序、数值和控件标签。

- 独立分支完整前端：95 文件 / 849 项通过。
- 集成目录完整前端：112 文件 / 969 项通过。两处覆盖重叠，不相加。
- 两处前端生产构建（含类型检查）通过。
- 两处真实 Git 路径回归各 2 项通过，覆盖存在的 Git、空白自动发现和不存在的显式路径。
- 独立分支原生 `cargo build -p gitx --locked --features tauri/custom-protocol` 通过。
- 变更前端文件 Oxlint 无错误；Keymap 两条原有空对象展开警告保留。两处相关文件 `git diff --check` 通过。
- 本轮未重跑全部 Rust 测试；保存失败/异步乱序使用受控自动测试，没有把它们写成原生实测。

日志位于 `E:/IDEAproject/gitx/test-results/settings-{main,integration}-{tests,build}.log`、`settings-git-tests.log`、`settings-git-integration-tests.log`、`settings-native-build.log`。

## 原生复查

测试程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-settings-20261111.exe`。

SHA256：`3832960940E800B032E138427FAA61C7D6F1384F59FBBF4AD57D01137184753E`。

使用 Windows Computer Use 操作，CDP 只读取 DOM、计算样式和焦点作为证据。窗口 1280×800，DPR 1；这不是全部缩放组合验收。

1. Ctrl+, 打开设置；搜索框获得初始焦点。深色字段、对话框和按钮显示正常，控件读出各自字段名。
2. 打开主题下拉后 Escape 只收起列表，设置窗仍在，焦点回到主题按钮。空格可重新打开下拉。
3. 浅色实时预览后 Escape 关闭设置，恢复原深色，磁盘设置哈希未变化。
4. 搜索“外观”保留四个外观控件，未匹配的页面按钮禁用；清空搜索恢复页面选择。
5. Git 页输入 -1，显示 0–1440 整数提示，应用/确定禁用；改回 0 恢复。
6. 填写不存在的测试路径后显示未找到 Git；清空路径立即清除旧错误。空路径测试找到 `D:\Git\bin\git.exe`，版本 `2.34.1.windows.1`。这些测试没有写设置文件。
7. 将浅色主题应用，观察保存中字段与按钮禁用，完成后“应用”禁用；关闭并重开仍为浅色。文件比较确认只有主题变化。
8. 恢复深色并确定，所有设置恢复原值，文件字节哈希与测试前一致；关闭测试程序。

原始证据：`E:/IDEAproject/gitx/test-results/settings-*.json`，包括 `dark-dropdown-escape`、`light-preview`、`cancelled`、`search-appearance`、`invalid-number`、`invalid-path`、`automatic-git`、`applied-light`、`reopened-light`、`restored-dark`。

设置测试前后 SHA256：`0230A96BB22EC074D8F932FFE149EA2EC8471F95BC1DD1C1E671D4AA0627C73C`。本轮在未打开仓库的 Welcome 界面完成，无 Git 仓库写操作。

## 交付与边界

集成目录只同步本项内容，保留其 Keymap 类型、可选 locale 和 WSL 解析差异；同步前备份位于 `E:/IDEAproject/gitx/test-results/settings-sync-backup`。

功能提交 `abe4794e985d6bb847ddfaa90c85b7fa69c3044e` 已推送至 `codex/checkout-target-safety`，经 ls-remote 核对一致。未替换 `D:/gitx/gitx.exe`。QA-009 的 Keymap、菜单和缩放组合，QA-007/008/010 及 QA-023 继续。
