# 检出反馈与恢复重试（2026-11-09）

## 行为

- 检出返回明确成功/失败；部分失败、重复操作、过期导航结果不再触发 pane/popup 的成功提示或关闭弹窗。
- 显示每个仓库的检出错误与恢复错误。自动恢复未完成提供持久“重试恢复”；重试失败或 IPC 拒绝后仍可继续重试。
- 操作和恢复共享 busy 防重入，导航 token 使 A→B→A 的旧结果及旧恢复按钮失效。
- 刷新分支列表也核对路径、导航 token、请求序号，避免旧引用覆盖新页面；刷新失败单独反馈。
- 全部根被 skipped 不报检出成功；部分 skipped 显示持久提示。
- 状态刷新由 store 统一发起，组件不再重复刷新。Toast 支持禁用动作/拒绝动作时保留，操作提示停留 30 秒。
- 长错误详情换行、滚动，并加宽到最多 42rem；小窗口保留两侧间距，恢复按钮保持可见。

## 验证

证据根目录 E:/IDEAproject/gitx/test-results。

- 旧实现 10/10 回归失败（branch-checkout-extract-before.log），提取后通过。
- 新边界又复现 2 项：全部跳过仍成功、刷新失败没有提示（branch-checkout-boundaries-before.log）；均已修复。
- 独立前端全量 24 文件 / 181 项通过（branch-checkout-extract-all.log）；集成目录 54 文件 / 371 项通过（branch-checkout-integrated-all.log）。
- 两个目录 vue-tsc 与生产构建通过（branch-checkout-extract-build.log / branch-checkout-integrated-build.log）；Toast 最终仅样式加宽后相关 3 项及独立生产构建再次通过（branch-checkout-toast-final.log / branch-checkout-final-build.log）。已有 chunk 体积提示仍在。
- 新编译的集成 debug app（build-multi-root-current-debug.log，PID10080）实际双击 shared：父测试 hook 建立 index.lock，子仓库本地修改拒绝检出，界面显示两类错误；锁仍存在时点重试，失败后按钮保留。独立 Git 核对 11 项全通过（multi-root-current-failure-verified.json）。
- 确认 fixture 锁、hook 字节、HEAD 和子目录快照后，仅移除测试锁；再点 GUI 恢复，回到原 detached SHA eab8102fd8c4545b852a095e2f1ffdd19227041b。父子 HEAD、refs、index、status、文件内容等 15 项全通过（multi-root-current-recovery-verified.json）。
- GUI 实际观察加宽后错误详情可滚动、恢复按钮固定可见；错误及恢复后页面文本保存在 multi-root-current-*-ui.txt。没有采到短暂的恢复成功 toast，不把该文字算作 GUI 证据。
- GUI 正常退出，8 个采样进程全部结束（multi-root-current-closed-process-tree.json）。未替换安装版。

## 后续范围

此项补齐检出反馈与恢复流程；Changes/Log 等其他 store 的内部导航生命周期、跨命令写入调度仍需继续按功能提取和验证。GUI 使用集成 debug 构建，独立分支使用上列单元/组件及构建验证；两者不混记。
