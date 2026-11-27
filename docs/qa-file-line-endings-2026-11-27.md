# QA128 普通文件编辑保存换行

日期：2026-11-27，全程主线程。开始前读取台账，fetch及master/交付分支快进检查成功；干净基线 `3d2a9932e3ae50045fcdb8985e622fd1f504ed57` 包含 master `e295c8e` / 0.1.55。

## 已确认问题

QA125只在文档完全恢复到保存基线时回填原始文本。正文仍有修改时，普通文件编辑器使用 `doc.toString()`，其LF序列化被直接交给保存逻辑，导致原有CRLF、CR或混合换行也被改写。首批新增7项回归中6项失败，原24项和LF对照通过。

同一输入链另确认右键粘贴CRLF文本时用原始字符串长度设置光标，两个字符的CRLF在编辑器内只有一个位置，光标实测为5而非4；在文件末尾可能越界。初次粘贴回归遇happy-dom同步selectionchange重入，改用既有测试中的延迟剪贴板/失焦方式后稳定复现位置错误，不将模拟器异常计为产品故障。

## 修改

- 普通文件编辑器复用合并编辑器已有的 `preservedText`：按文档位置保留每个原始换行，删除/替换后随CodeMirror历史恢复，BOM与没有末尾换行的文本保持。
- 新增换行沿用文件第一个换行类型，无换行时使用LF；未改动位置保留各自原类型。该规则适用于输入、多行粘贴和文件内替换；不对全文件统一转换换行。
- 保存使用当前保留换行的草稿，保存后继续编辑、在途保存期间的新草稿、重新挂载后编辑均保持一致。移除仅比较基线等价文本的特殊回填分支。
- 粘贴先通过 `EditorState.toText` 形成编辑器文档片段，用片段长度定位光标；中间及末尾插入均有回归。
- 避免在每次序列化时为每个CRLF构造小字符串：统一换行直接从文本树序列化，显式混合插入会关闭该快速路径；混合换行按连续类型分段输出。公共实现改动同时验证合并编辑器及TextViewport。
- 中英文文件教程补充换行规则，无新增快捷键。

## 自动与性能证据

目录：`E:/IDEAproject/gitx/test-results/qa128-file-endings-20261127`。

- `before.log`：旧实现6失败/25通过；`clipboard-before-controlled.log`：换行修复后粘贴光标仍1失败/32通过。
- 普通文件组件新增10项，共34项；公共保留文本新增2项，共7项。覆盖CRLF/CR/LF/BOM/混合、单词修改、插行、跨行替换与撤销、重新挂载、Replace All、粘贴位置和保存并发；最终相关60项通过，含合并编辑器5000冲突和TextViewport。
- 首轮完整检查与公共序列化优化在时间上重叠，因此以最终源码冻结后的 `full-final.log`、`build-final.log`为整体结果，不以首轮结果代替。
- 0.1.55最终完整前端201文件2131项通过，4项既有probe跳过，退出0；类型检查、Vite、Windows debug构建、四份修改源码的Oxlint/Oxfmt及中英文档检查通过（各22页、79 commands、33 settings、318 links）。Rust产品未改，本轮没有重跑完整Rust测试。
- 模型探针用530000条CRLF行、中间一条LF及尾行，三轮序列化中位从123.44ms降到47.10ms；普通LF序列化对照中位30.70/29.80ms，保留后的输出完整为6,360,031字节（含末尾追加）。见 `mixed-before.json`、`mixed-final.json`、`measure.mjs`。这是Node中的CodeMirror文本模型与序列化，未测GUI帧率/磁盘写入/输入延迟，也没有据此关闭持续滚轮事项。
- 纯CRLF53万行快速路径三轮序列化22.60/23.02/25.68ms，见 `large-model-timings.json`。首次未经优化样本同时有全量测试/构建负载，不能将其和后续空闲探针直接当同条件加速比。

## 原生与交付

使用专用两文件仓库、独立 `app.gitx.qa128endings20261127` 设置与WebView profile。最终0.1.55测试程序SHA256为 `251d1c4b3c103f1c65db905070bd641bb838b2ce5e9f18e381dd52d7bcfb173c`，见 `target.json`。

- `mixed.txt`初始字节为 `BOM + alpha\r\nbeta\ngamma\rdelta`。原生双击打开，在第二行末尾输入`-edited`并按Enter、Ctrl+S后，字节精确为 `BOM + alpha\r\nbeta-edited\r\n\ngamma\rdelta`，原位置换行、BOM及无末尾换行保持，新增换行沿用首个CRLF。见 `mixed-saved.json`。
- 连续撤销插行和编辑、Ctrl+S后，文件哈希恢复为初始值，界面未保存提示清除。见 `mixed-restored.json`。
- `large.txt`含530001个CRLF，约6.36MB。原生Ctrl+End到第530002空行，输入`appended`并保存后6360019字节与完整预期相同，530001个CRLF保持，没有单独LF。见 `large-saved.json`。Ctrl+Z再保存恢复原始字节。这是大文件完整编辑保存验证，不是原生输入延迟或持续滚轮测量。
- 保存中面板文字及左下角任务状态可见，完成后恢复干净标签；正常关闭后观察到的7个测试进程身份（PID及创建时间）均退出，stderr为空。见 `process-identities.json`、`process-exit.json`。
- 最后两文件哈希、仓库HEAD/status及个人settings均与baseline相同；专用settings复制、字节核对后移出Roaming，见 `verification-final.json`。用户安装版未更新。

提交前fetch发现master已合入上一轮交付并升至 `50a4802` / 0.1.56，交付分支被删除；确认其包含原HEAD `3d2a993` 后用命名stash保存并快进整合，台账顶部冲突两侧记录均保留。差异仅版本清单/锁文件和台账，无产品逻辑或外部依赖变化。升级后类型/Vite及Windows debug构建通过，日志为 `build-0.1.56.log`、`native-build-0.1.56.log`。产品源码与已测stash内容逐文件相同，见 `sync-verification.json`；恢复stash产生的工作区CRLF使格式检查失败，按格式器归一到LF后通过，没有Git内容变化。文档/Oxlint及diff检查也通过。以上完整回归和原生操作保留实际0.1.55执行版本，不宣称全部在0.1.56重跑。最后再次fetch成功，master无新提交，准备独立提交推送并重建交付分支。

本项补齐QA125明确保留的正常编辑保存边界；其他持续事项及整体七项目标仍按统一台账推进。
