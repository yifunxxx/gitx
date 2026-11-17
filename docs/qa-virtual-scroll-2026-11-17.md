# QA-030：虚拟列表滚动窗口同步

日期：2026-11-17。来源：继续 QA-008 性能检查时，对更新到 0.1.37 后的共享 VirtualList 调度进行复查。

## 问题与复现

滚轮处理虽然已有 requestAnimationFrame，后续仍用 50ms 定时门控更新行窗口。原生滚动位置先移动，行窗口仍停留在旧位置，快滚可能超出 overscan 范围而显示空白。主鼠标键按下期间完全暂停行窗口更新，因此拖住滚动条时也会出现空白，直到松手才恢复。

此外，定时门控保存旧 scrollTop。快滚后调用 scrollToIndex 定位到新行，尚未执行的定时器会将渲染窗口改回旧位置，实际 scrollTop 却仍在新位置。

新增回归在修改前均失败：拖动到 row-500 仍显示 row-0；第二次滚轮到 row-500 下一帧仍显示 row-0；快滚后定位 row-900 又被旧值覆盖。日志：`E:/IDEAproject/gitx/test-results/virtual-scroll-before-20261117.log`。

## 修改

- 每帧合并滚动事件，并读取当前滚动容器的位置更新有界行窗口；删除 50ms 门控及旧位置缓存。
- 拖动期间照常更新可见行，但继续推迟父组件分页通知和锚点变更，保留固定 spacer、行节点复用以及 hover/title 抑制。
- 松手时读取实时位置并通知父组件。销毁时仍清理 rAF、空闲定时器、观察器和全局手势监听。

## 受控浏览器对照

真实 Chrome headless，GPU disabled，1280×800，开发版 Vite。使用修改前真实组件与修改后组件；两组均为 20,000 行、22px 行高、700px 视口、overscan 10、recycleKeys 开启。图形组使用真实 CommitGraphCell 和 40 条图线。脚本逐帧滚动 2,000px，共 120 帧，并采样行窗口是否覆盖视口。

| 测量 | 普通行修改前 / 后 | 图形行修改前 / 后 |
| --- | --- | --- |
| 120 个采样帧中视口覆盖不足 | 104 / 0 | 99 / 0 |
| 拖住滚动条到 220,000px 后覆盖目标视口 | 否 / 是 | 否 / 是 |
| p95 帧间隔 | 16.7 / 16.8ms | 16.7 / 16.7ms |
| 超过 33.4ms 的帧 | 0 / 0 | 0 / 0 |
| 最终挂载行数 | 52 / 52 | 52 / 52 |
| 最终 DOM 元素数 | 158 / 158 | 2446 / 2446 |

修改前持有拖动时仍渲染 0–41 行，修改后渲染 9990–10041 行。主要改进是消除渲染窗口落后；帧间隔在这次采样中没有明显变化。这是合成滚动事件的浏览器对照，不能当作 Windows 原生滚轮输入延迟、真实滚动条捕获或所有仓库的性能保证。

原始数据：`E:/IDEAproject/gitx/test-results/virtual-scroll-{before,after}-20261117.json`。脚本：`virtual-scroll-run-20261117.mjs`；组件和页面归档在同目录的 `virtual-scroll-sources-20261117/`，已移出产品源码目录。

## 验证与交付

- 完整前端 128 文件 / 1082 项通过，含共享列表 10 项与新增滚动 5 项；覆盖拖动、连续滚动、程序定位、事件合并和卸载取消。
- 类型检查和生产构建通过，保留已有的大包体积提示；相关 Oxlint、git diff --check 通过。
- Windows 原生构建通过（`cargo build -p gitx --locked --features tauri/custom-protocol`）。日志：`virtual-scroll-all-20261117.log`、`virtual-scroll-build-20261117.log`、`virtual-scroll-native-20261117.log`。
- 专用测试程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-scroll-0137-20261117.exe`，SHA256 `BC6C9EE3FA79D86490A760E5D7D2A674A361F9C75D477A1313D82C24A4BC443A`，原生交互验收另记。
- 旧原生编辑器测试程序仍停在剪贴板权限提示，须由用户自行处理，未以旧程序验收本轮滚动源码。安装版 `D:/gitx/gitx.exe` 未更新。
- 本功能独立提交、推送后在统一台账补记哈希和远端核对结果。QA-008 继续记录原生性能测量边界。
