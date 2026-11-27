# QA130 全局搜索换行与空行边界

## 来源与基线

搜索读取/资源生命周期审阅发现后端只按 LF 分行，文件编辑器按 CR、CRLF、LF 分行；CR 和混合换行可能造成结果行列与正则行边界不一致。开始前读取统一台账，fetch 并检查 master/交付分支成功，干净基线 `2ee8a53` 包含 `origin/master 50a4802`（0.1.56），无新远端提交。全程主线程，没有子代理。

## 受控确认与修改

- 首批3项新增测试全部在旧实现失败，原13项通过。BOM/emoji/混合换行文本的命中位置旧为 `[(1,2),(1,9),(2,8),(3,1)]`，实际编辑器模型为 `[(1,2),(2,4),(4,1),(5,1)]`。
- 行锚点 `^foo(\d)$` 在混合换行文本应命中第1、2、4、5、7行，旧实现为0；CRLF跨缓冲及连续CR的分行亦失败。
- 第4项空文件/末尾空行对照在旧实现失败。已安装CodeMirror模型确认空文档为1行、末尾换行产生最后空行，`^$` 应可匹配。
- 搜索与替换共用流式 `TextLines`，识别三种换行并把跨缓冲CRLF作为一个分隔符；复用单行缓冲，保留原字节用于哈希及写回。空文件、末尾空行只访问一次，无终止符的末行不会再多出一行。保留逐缓冲取消检查、UTF-8/BOM规则及替换发布前校验；发布前释放源文件句柄。
- 明确的行为变化：`BOM foo\r\n` 用 `^.*$` 替换为 `new`，结果为 `BOM new\r\nnew`，包括末尾空行。修后首次定向运行16通过/1旧预期失败，核对编辑器模型后更新该断言并补匹配数量，未忽略失败。
- 中英搜索教程说明CR/混合换行定位、保留分隔符及空行正则语义；本项未新增快捷键动作，已有搜索替换Keymap保持。

## 自动验证

- 最终4项新增回归通过，覆盖混合换行/UTF-16列、捕获组替换、1/2/3/4/8/8192字节缓冲边界、空文档/末尾空行/BOM-only。原晚到二进制/无效UTF-8撤回测试改为CR与CRLF混合输入。
- 完整 `cargo test -p gitx --lib -- --test-threads=4`：60通过、1既有ignored，包含全部17项内容搜索测试及文件搜索/终端资源测试。
- 106.25MiB末尾命中、8MB超长行、1001匹配分页、取消回收、同长度外部修改及零宽替换回归通过。没有新增文件大小或结果数量限制；本轮不声称原生大文件性能重新验收。
- `cargo fmt --check`、`cargo clippy -p gitx --all-targets -- -D warnings`、类型/Vite构建、Pages引用检查与静态站点构建通过。Pages中英各22页、79动作、33设置。
- 没有前端产品改动，未重复QA129的完整2139项前端回归。

## Windows 原生验证

最终0.1.56独立debug程序构建通过，identifier `app.gitx.qa130search20261127`，程序SHA256为 `79ff0ce450f2fe5a3bfd26f703e8ea01a9d674ce1fa03a27287921a62e3153bd`。使用独立WebView profile及专用三文件Git仓库，UI操作由Computer Use完成。

- Ctrl+Shift+R输入 `^foo(\d)$` 并启用正则，界面实际显示5处匹配/1文件，行列为 `1:2、2:1、4:1、5:1、7:1`。点击第二项打开mixed.txt，光标出现在编辑器第2行foo2之前。
- Ctrl+Shift+H输入同一正则及 `bar$1`，显示捕获组替换预览；两步确认后界面报告已替换1文件。磁盘逐字节为 `BOM bar1\rbar2\r\n\rbar3\nbar4\r\rbar5`，BOM与每处换行保持，其他两文件不变。
- 在同一替换窗口把范围设为 `empty.txt,trailing.txt`、查询改为 `^$`、替换为 `new`。界面显示2匹配/2文件，分别为 `empty.txt:1:1` 和 `trailing.txt:2:1`；两步确认后报告已替换2文件，磁盘分别为 `new` 与 `first\rnew`，mixed.txt保持上一结果。
- 正常关闭测试程序，记录的7个进程身份全部退出。三文件按基线恢复后字节、HEAD、索引及干净status一致；个人settings SHA256保持 `1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，专用settings归档后移除。stderr为空，用户安装版未更新。

## 交付与边界

新增并解决QA130一项，回到原11项持续验收/归因事项，整体七项目标继续；本项不作为持续滚动断档或高CPU的归因。UTF-8/二进制/逐行正则范围及整文档编辑内存边界沿用搜索教程；没有宣称支持跨行正则或完成全部性能验收。

提交前再次fetch及master/交付分支检查成功，无新提交，基线仍包含master `50a4802` 与交付 `2ee8a53`。功能提交 `ce19fae2c8ea60d373f71d80a5120c307908ac15` 首次推送到 `origin/codex/checkout-target-safety` 成功，ls-remote完整SHA核对一致，无凭据提示；补记前再次同步成功。交付核对见证据目录 `delivery.json`。

证据目录：`E:/IDEAproject/gitx/test-results/qa130-search-endings-20261127`。`before.log`、`empty-before.log`保存旧失败，`targeted.log`保存首次修后旧预期失败，`editor-model.mjs/json`保存编辑器对照，`lib-tests.log`、`clippy.log`、`build.log`、`docs-build.log`保存最终自动验证。`native-build.log`、`target.json`记录最终程序；`native-*.json`记录原生可访问性结果，截图在本次工具记录中；`mixed-verified.json`、`empties-verified.json`、`restore-verified.json`、`final-verified.json`记录写入/恢复字节，`process-exit.json`记录进程退出。
