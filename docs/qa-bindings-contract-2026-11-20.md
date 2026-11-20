# QA-055 显式绑定导出的错误契约

2026-11-20 为 QA-053 新增命令导出 TypeScript 绑定时，发现生成器沿用默认 Result 返回包装，现有前端约定却是直接成功值与 rejected promise。生成后 vue-tsc 大量失败；这可复现于开发导出步骤，不是正常启动自动改写，也不等于当前安装版运行失败。

显式设置 tauri-specta ErrorHandlingMode::Throw，使导出与原有命令调用约定一致。已用本机 rc.21 源码核对 API，Windows debug 构建成功，重新执行 GITX_EXPORT_BINDINGS 并格式化；新 workspaceOpenDirectory 返回 Promise<null>，不再吞掉 AppError。前端类型检查通过。QA-053 的命令绑定在该功能提交中交付。

提交前重新 fetch 成功，master efc2a8a 与远端交付分支均已包含。独立修复提交 `c774bd47ee79e69455be3f910dbd5d483c45969a` 已推送并确认远端一致；新增命令绑定随QA-053的 `073556c40967f36a1f0599531a1409186772d552` 交付。最终整合程序 `2519c34c137f70c72322840cb02bfb3e17182171` 的完整前端153文件/1459项、后续定向46项、类型/Vite及Windows原生构建通过。目录打开及终端实际调用证据见[原生报告](qa-tree-actions-native-2026-11-20.md)，导出行为本身以显式生成和类型检查验收。安装版只读核对为0.1.41，本轮未替换。
