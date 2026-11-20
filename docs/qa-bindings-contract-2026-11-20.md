# QA-055 显式绑定导出的错误契约

2026-11-20 为 QA-053 新增命令导出 TypeScript 绑定时，发现生成器沿用默认 Result 返回包装，现有前端约定却是直接成功值与 rejected promise。生成后 vue-tsc 大量失败；这可复现于开发导出步骤，不是正常启动自动改写，也不等于当前安装版运行失败。

显式设置 tauri-specta ErrorHandlingMode::Throw，使导出与原有命令调用约定一致。已用本机 rc.21 源码核对 API，Windows debug 构建成功，重新执行 GITX_EXPORT_BINDINGS 并格式化；新 workspaceOpenDirectory 返回 Promise<null>，不再吞掉 AppError。前端类型检查通过。QA-053 的命令绑定在该功能提交中交付。

提交前重新 fetch 成功，master efc2a8a 与远端交付分支均已包含。此修复独立提交推送，结果随后补记。无安装版更新；不需要单独 GUI 验收导出行为。
