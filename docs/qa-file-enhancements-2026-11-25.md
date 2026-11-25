# File E1–E5 增强验证记录

日期：2026-11-25；分支：`codex/file-tool-window`。用户要求全部增强且禁止子代理，本阶段均在主线程完成。

## 范围及影响

- QA083/E1：新增 `filesystem_ops.rs` 与 `fileOperationsStore`，文件/目录新增、重命名、复制、移动、回收站删除；File 面板菜单/F2/Delete。路径校验、不覆盖、部分失败报告、保存互斥及编辑器路径重映射。编辑器身份保持，草稿与撤销不因改名丢失；已发现仓库根与冲突文件限制原位迁移。
- QA084/E2：`fileTreeStore` 多选/范围选择，File 树拖放及落点校验；竖条悬停切 Commit，`ChangesTree` 接收同工作区变更进入 changelist。Windows 关闭 Tauri 原生文件拖放拦截以使用 HTML5 拖放。没有既有原生文件 drop 处理器。
- QA085/E3：全工作区文件名/路径模糊跳转，Ctrl/Cmd+P、命令面板、取消与旧请求丢弃。
- QA086/E4：UTF-8 磁盘内容搜索，Ctrl/Cmd+Shift+F，路径/行列/片段结果，编辑器定位且保留草稿。
- QA087/E5：可设置紧凑目录、父目录聚合变更标记；保留工作区树，最深仓库归属标识及仓库切换，有草稿时阻止切换。

这些改动会影响 FileViewer 保存、刷新、Commit changelist、快捷键及设置；沿用现有刷新和虚拟列表，没有重构其他面板或删除原功能。删除按用户选择使用系统回收站，失败不转永久删除。

## 自动检查

- 完整前端：184 文件、1834 项通过。首次失败分别为新增设置控件数量及测试 i18n mock 缺少 `createI18n`，均已修正后完整重跑；搜索焦点补修后19:58开始的最终完整重跑仍全部通过。
- 最终竞态/路径/菜单定向：36 项通过；类型检查、Vite生产构建、`pnpm lint`（含 Rust fmt/Clippy）通过。8 项现有 lint 警告；Vite保留已有大 chunk 提示。
- Rust filesystem/operations/search：20 项通过、1 项默认忽略；设置2项通过。默认忽略的真实Windows回收/恢复测试单独执行1项通过：普通文件、含文件目录均能回收后恢复，锁定文件回收失败后原文件仍在。
- Windows原生阶段构建通过，隔离测试程序 SHA256 `8AE7E5288B3B2BF994313E1B399E07BF2709848D0451CFF54A2FC6409356060E`。其后补修内容搜索关闭对话框后的编辑器焦点、确认框多行路径显示；最终构建身份另记。
- 本机Chrome真实鼠标事件、实际Vue组件/Pinia/DialogHost、mock后端边界：目录移动确认、Ctrl复制、根目录落点、拒绝子孙落点、悬停Commit再拖入changelist、搜索关闭后的焦点与UTF-16列定位六项通过，无页面异常。证据 `test-results/qa083-native/browser-check.mjs`、`browser-check.log`、`browser-check-result.json`；这是浏览器交互证据，文件系统实效另由Rust与原生验证。

## 原生界面

使用 `test-results/qa083-native/workspace` 仓库及系统TEMP下 `gitx-qa083-plain-20261125` 真正非Git目录、`app.gitx.qa083` 配置及独立 WebView profile。最初置于项目test-results下的plain属于父仓库，因此改用TEMP重验，未把前者当非Git证据。用户安装版未替换。

- 已验证新建文件成功、F2改名后文件树及已打开标签更新。
- 已验证Copy To生成目标文件；删除确认按Escape后原文件保留；Shift+Down多选；逐级展开压缩成src/one/two；切换嵌套仓库时工作区树保持、Commit内容随仓库更新。
- 已验证全局文件名模糊搜索命中尚未展开的 `src/one/two/find-me.txt`，Enter打开文本。
- 已验证内容搜索返回嵌套仓库及父仓库命中；包含emoji/中文的第二行正确报告UTF-16列6。点击打开现有编辑器。
- 真正非Git目录显示Repository no；内容搜索打开中文文件后编辑中文并Ctrl+S，磁盘内容核对一致。
- 树内原生拖放未取得完整验收证据：原生输入工具只生成pointerdown、一次跳至落点、dragstart/enter/leave/end，没有dragover/drop，未出现确认框。已用上述浏览器真实多步鼠标拖拽补验逻辑，不能写为原生拖拽已通过，也没有据此登记产品缺陷。

## 边界

内容搜索为字面量、每行首个匹配，不搜索未保存草稿。单UTF-8文件5MiB、总读取100MiB、500结果；整体15秒、10万条目、1万目录/深度256。隐藏/忽略规则沿用File设置；二进制、超大、不可读文件跳过并提示。

紧凑目录仅合并已按需加载的单目录链，避免渲染触发整仓扫描。其他仓库文件按磁盘文本打开，Git Diff/History仅用于活动仓库。批量失败按项报告，不覆盖目的地。跨卷移动及符号链接/联接操作可失败并保留原项；未在Linux/macOS原生验证。

## 同步与交付

起始及阶段同步包含master `6bf02dbfde1f26bcfaafa1fdc0e46647305b1cf4`。E3 `2f8b25179afe25a7e7c6cb1cfcf1b269e9a984f3`、E4 `f2c84ab046a36e68d876faa581dd7fe9437815fe`均已独立提交推送并核对远端。E4一次预提交fetch失败后误提交，随后同步成功、确认无新提交再推送，未跳过最终基线核对。后续多次SSL10054/443超时后重试成功，master和交付分支均已包含；无持久Git配置变更。

E1/E2/E5收尾及独立提交待补记。既有11项其他QA待办保持，本报告不将其计为本File任务缺陷，也不计算整体完成率。
