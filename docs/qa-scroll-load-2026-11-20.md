# QA-034/008：大列表并发刷新下的原生滚动与资源采样

测试开始于 2026-11-19，分析与退出核对完成于 2026-11-20（Asia/Shanghai）。本项增加有限场景证据，不关闭整体性能验收，也未据此登记新缺陷。

## 程序与场景

使用 [阶段验收](qa-native-lifetime-2026-11-20.md) 的 0.1.40 最终程序，产品提交 `f36a25f`，程序 SHA256 `896FEF96DC1139A551B39336EE491742B06B96838C626DC34414E93EE1BE4CF7`。本次为 debug 原生构建、带 trace 的单版本记录，没有优化前后原生对照。

专用仓库 `E:/IDEAproject/gitx/test-results/repos/changes-load-20261119` 有 2000 个修改文件。打开 3 个普通差异标签，活动为 file-0002；外部每秒写入活动文件，共 90 次，相邻写入间隔 1.001–1.017 秒，首次到末次共 89.744 秒（23:55:55.254 至 23:57:24.998）。之后恢复该文件原有修改文本。

期间实际执行 4 次彼此分开的滚轮操作，看到差异内容更新和列表位置变化。随后拖至列表末尾并双击 file-1999，第 4 个标签显示正确的 `original 1999` 与 `changed 1999`。观察与 trace 不能证明 90 个中间版本全部逐个呈现；本次不是连续快速滚动。

通过独立 WebView profile 和进程环境启用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`：`--trace-startup=benchmark,cc,input,latency --trace-startup-duration=300 --trace-startup-file="…/commit-load.json" --trace-startup-format=json`。trace 实际跨度约 299.890 秒，时钟域 WIN_QPC。没有精确墙钟/QPC 同步标记，事件耗时使用 trace 本地微秒计算，操作阶段依据实际执行顺序。trace 写出后的一次额外上滚不纳入统计。

## 输入与呈现

按 PID 与 async id 配对 `EventLatency` 的开始/结束；同一个 async id 会复用，采用时间序配对，未用全局首尾相减。对应 `FIRST_GESTURE_SCROLL_UPDATE` 共 5 条：

| 操作 | 事件耗时（ms） | 呈现证据 |
| --- | ---: | --- |
| 第 1 次独立滚轮 | 40.364 | 标记 `NON_DAMAGING_WITHOUT_EXTRAPOLATED_PRESENTATION_TIMESTAMP`；没有匹配呈现时间，不计为输入到呈现延迟。 |
| 第 2 次独立滚轮 | 14.188 | 匹配 Presentation、Display::FrameDisplayed；VSync 6.944 ms，is_janky=false。 |
| 第 3 次独立滚轮 | 13.542 | 同上。 |
| 第 4 次独立滚轮 | 15.715 | 同上。 |
| 拖动至末尾 | 9.718 | 匹配呈现与 VSync，is_janky=false。 |

仅 3 个可确认呈现的滚轮样本，范围 13.542–15.715 ms；不据此计算百分位、最坏延迟、掉帧率或宣称全部滚动流畅。启动阶段的 15 条 Browser FramePresented 不作为滚轮延迟或 FPS。

## 资源采样

每约 10 秒采样进程树，实际间隔 10.309–10.579 秒，共 25 点（23:53:40.861 至 23:57:49.354），各点均为 9 个进程。短命进程可能在两次采样之间漏记。

| 指标 | 峰值 | 末次 |
| --- | ---: | ---: |
| PrivateBytes 总和（MiB） | 309.008 | 279.332 |
| WorkingSet 总和（MiB） | 566.652 | 541.184 |
| 句柄总数 | 3901 | 3841 |

WorkingSet 求和可能重复计入共享页，不等于独占物理内存。写入期间完整采样区间的 CPU 为 1.709–1.931 核；CPU 定义为进程树 CPU 秒数之差除以区间秒数。12 逻辑核机器的主机百分比另见统计文件。

末尾两个完整区间仍有拖动、打开第 4 个差异和 trace 活动，CPU 拆分如下，单位为核：

| 进程角色 | 23:57:28.695–39.020 | 23:57:39.020–49.354 |
| --- | ---: | ---: |
| GitX 主程序 | 0.222458 | 0.219219 |
| Renderer | 0.003027 | 0.004536 |
| Browser | 0.464588 | 0.517054 |
| GPU | 0.010593 | 0.004536 |
| Tracing service | 0.006053 | 0.004536 |
| 全部进程（含其他子进程） | 0.709746 | 0.751393 |

末次采样距最后写入仅 24.356 秒，且仍在交互，不是静置恢复窗口。内存与 CPU 较负载时下降，不能写成完全回到基线、空闲 CPU 正常或已排除内存泄漏。Tracing service 自身 CPU 也不能代表全部 trace 开销；Browser/Renderer 等进程同样可能承担采集成本。本次不据这些数值单独判定忙循环或新增缺陷。

## 原始证据与恢复

原始目录 `E:/IDEAproject/gitx/test-results/scroll-load-0140-20261119/`：

- `statistics.json`：配对方法、原始微秒、文件 SHA256、25 个资源点、CPU 拆分与限制。
- `commit-load.json`：约 66 MB，323286 条 trace 事件，SHA256 `fae341a926cb450eb05b26b849d898158cd9bac1845bc75cb851ab58cac30226`。
- `resources.json`、`write-times.json`、`processes-before-exit.json`、`processes-after-exit.json`、`pid.txt`。

负载程序 PID 29040 及采样中的 9 个进程已按 PID 与 StartTime 核对退出。fixture 结束 HEAD 为 `20e7b3b7963d129818958ae9ae9f9abb2a461926`，索引 SHA256 为 `12C63B63A83D53250D3C6B79117CABB9BE5CBAD9450B30BB9276D55E33C50A67`；HEAD、索引和2000项修改数量与基线一致，2000个文件逐个核对预期文本，0个异常。基线JSON未保存逐文件内容或哈希，文本核对使用该专用fixture的确定性预期内容。基线 `changes-load-before-20261119.json`、结束汇总 `lifetime-live-end-20261119.json` 保存在 test-results。

后续仍需持续快滚、终端、无 trace 的静置恢复与长期负载验证；保留 QA-034/008。该样本不用于比较 metadata 修复的原生收益，不代替完整 UI/资源验收，用户安装版未更新。
