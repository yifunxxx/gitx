# QA-025 快捷键原生验收

日期：2026-11-17。功能修复 `88a920c` 已进入当前分支；本次补齐 Windows 原生验证，没有修改产品源码。

## 版本与范围

- 当前源码 `de2a522`，包含主分支 0.1.37 及 QA-027 至 QA-029。
- 原生程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-editor-0137-20261117.exe`。
- SHA256：`41FD8CA462964D7A136553B0593B05DAA8CAF19F1C3A44AEB1C4925624AFD345`。
- 通过 Windows 原生设置窗口操作，使用 Settings 动作测试，未打开业务仓库或执行推送等 Git 动作。

## 实际验证

1. Keymap 搜索 Settings 后可录制。输入 Ctrl+Shift+K 时提示已分配给 Push，保持录制且不误执行 Push；干净草稿的 Apply 未被启用。
2. 改录 Ctrl+Alt+9，冲突消失，保存后磁盘为 `Settings: ["mod+alt+9"]`；按新快捷键确实打开设置，重新进入 Keymap 仍显示该绑定。
3. 单项 Reset 草稿立即显示默认 Ctrl+,，不回落到保存的自定义值。
4. 录制中 Escape 退出录制，保留原绑定及设置窗口；Tab 也退出录制，焦点落在 Rebind。
5. Remove binding 显示 Unbound。取消设置后磁盘仍保留先前 Ctrl+Alt+9，新快捷键仍能打开设置，证明草稿未误保存。
6. 再次移除并 Apply，磁盘保留 `Settings: []`；保存完成后 Apply 禁用，设置窗口保持打开。
7. 对已保存空覆盖点击 Reset，立即显示 Ctrl+,；OK 保存后默认 Ctrl+, 实际可重新打开设置。
8. 取消最后一次只读查看。设置文件与测试前备份 SHA256 均为 `E99D2DC05F0E81A599801DA87552957FABC281002DAD8E8FBEF528FD21C123AC`，通过 UI 完成恢复，未覆盖文件。

## 证据与限制

原生截图及可访问性状态见本任务工具记录。窗口恢复时一度出现 `coordinate input geometry is unavailable`；重新选择并激活测试窗口后操作正常，不计作产品缺陷。

IME、重复键、修饰键等边界沿用已有自动回归；本次不把它们写成原生实测。最终源码已有完整前端 1077 项、类型检查及构建通过，文档验收未重复运行这些测试。用户安装版 `D:/gitx/gitx.exe` 未替换。QA-025 关闭，其他 UI 与整体目标仍按统一台账继续。

本验收记录独立提交推送；提交号和远端核对结果在后续台账更新补记。
