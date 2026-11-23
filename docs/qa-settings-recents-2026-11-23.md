# QA-071：设置保存覆盖最近项目

日期：2026-11-23。范围：设置持久化、最近项目归属以及保存/重载并发。总体七项目标仍在进行。

## 基线与复现

开始前成功 fetch，工作区干净，HEAD 与交付分支均为 `7e2ca321155fad3495694076051077a89f97cdea`，包含远端 master `42df3f730be8ddd157a6aaca8d9a2b908638c950`（0.1.44）。沿用当前独立工作树，没有修改主检出或用户安装程序。

线索来自 QA-070 原生换肤：打开仓库后，最近项目更新了；保存主题后，设置文件却回到了启动时的最近项目列表。本轮使用旧专用程序 `gitx-editor-styles-0144-20261123.exe`，SHA256 `402E070D384B0309461F7754007C9A2F125AB316461E80CC9E2CD2C67202D3FA`，正式复现：

1. 启动时主题为液态玻璃浅色，最近项目不含本轮 fixture。
2. Ctrl+O 打开 `changes-load-20261119`，界面显示 2000 个修改文件；磁盘最近项目首项正确插入该路径。
3. 点击标题栏主题按钮切到深色，新项目从磁盘最近列表消失；除了主题，设置重新等于启动快照。

三个中间设置快照及截图位于 `E:/IDEAproject/gitx/test-results/qa071-settings-20261123/before`。严格核对后，旧程序的七个采样进程身份全部退出，再恢复本轮设置备份。还原 SHA256 为 `1ce741747aea8fbddeb9542177a5b86028c7854f0b9b20edc3d7b7a8d919a910`。没有编辑测试文件；其 2000 文件哈希、HEAD、index tree、status 与 QA-070 最终快照相同。

## 原因及修改

前端设置草稿包含 `recentWorkspaces`，后端打开仓库和移除工作树会独立更新该字段。原 `settings_set` 整份保存旧草稿，会抹掉后来打开的项目，或把已移除工作树重新加入最近列表。

此外，原保存顺序先写磁盘，随后等待 Git 写锁，最后发布内存。等待期间磁盘与内存不一致；此时再打开项目，最后的旧草稿发布又可能覆盖新记录。原 `settings_reload` 也先读磁盘、后等设置写锁，可能在并发写入后发布先前读取的旧快照。

- 设置保存保留后端当前 `recent_workspaces`，其余偏好仍按前端提交的设置保存。
- 固定按 Git → settings 取得写锁，再持久化、更新执行器和内存，保存失败不发布草稿。此顺序兼容 `remote_add` 持 Git 读锁后读取设置的路径，避免反向持锁。
- 重载先取得 settings 写锁再读取磁盘，防止等待期间快照过期。
- Web mock 遵循相同最近项目归属契约，返回值仍深拷贝。

没有扩展为所有偏好字段的三方合并，没有改变 `settings_reload` 原有不重绑 Git 执行器的语义，也未修改凭据开关行为。

## 自动验证

测试使用临时目录中的真实设置文件和独立锁，不创建真实 AppState，不读取用户凭据或配置。并发场景手动 poll 到 Pending，再受控更新状态，不依赖 sleep 猜测时序。

| 验证 | 结果 / 证据 |
| --- | --- |
| 正式旧 Rust 实现 | 先提取保存函数但保留旧行为；5 项中 4 失败，失败写入保护对照 1 项通过。`qa071-settings-before.log` |
| 修后 Rust 定向 | 7 项通过，覆盖新项目保留、删除不复活、客户端不得替换列表、等待 Git 的发布时序、保存失败保护、重载并发与失败。`qa071-settings-targeted.log` |
| Web mock 旧实现 | 新增 1 项回归失败。`qa071-settings-mock-before.log` |
| 前端定向 | mock.settings、settingsStore、SettingsDialog 共 3 文件 / 27 项通过。命令含一个不存在的 workspaceStore 测试路径，不计入实际执行数。`qa071-settings-frontend.log` |
| 完整前端 | 160 文件 / 1589 项通过。`qa071-settings-frontend-full.log` |
| 完整 Rust 工作区 | 81 个结果汇总，521 项通过、0 失败、7 项辅助 ignored；进程退出码 0。`qa071-settings-rust-full.log` / `qa071-settings-rust-summary.json` |
| 类型 / Vite | 通过；保留既有大 chunk 提示。`qa071-settings-build.log` |
| 格式 / 相关 lint | cargo fmt 检查通过；Oxlint 无错误，mock.ts 原有约 933 行多余展开 warning 保留，本次未改该行。`qa071-settings-lint.log` |
| Rust Clippy | `cargo clippy --offline -p gitx -- -D warnings` 通过。`qa071-settings-clippy.log` |

日志均在 `E:/IDEAproject/gitx/test-results`。Windows custom-protocol 构建通过，日志 `qa071-settings-native-build.log`。完整回归中历史 QA-023/032 未复现，不将一次全过当作其历史根因已解决。

## 修后原生验证

专用程序 `gitx-settings-recents-0144-20261123.exe`，SHA256 `75539C76A5A180F977BFC3C51CA465EDD77A1AFF733BDE04D65314DDD541EAF6`。使用独立 WebView profile，但应用设置仍为真实 settings.json，分别在本轮前后留存备份及中间快照。

- Ctrl+O 打开同一 fixture，2000 文件列表正确显示，最近项目首项正确插入。
- 点击主题切换浅→深，界面正常切换。严格对比设置：只有主题变化，最近项目全列表及顺序、其余字段保持。
- 正常关闭后重启同一二进制，欢迎页与 UIA 文本均确认 fixture 是最近项目首项；深色主题保留，磁盘设置与重启前相同。
- 两次修后进程各有七个采样身份，均核对已退出。2000 文件哈希、HEAD、index tree、status 前后相同。仅当当前设置仍等于本轮最后快照才写回本轮原始备份，恢复哈希与旧版阶段一致。

证据位于 `qa071-settings-20261123/after` 和 `restart`，含 opened/dark/welcome 截图、欢迎页文本、settings 中间快照、进程身份、fixture 快照及 restoration.json。首次采样因可执行路径斜杠拼写比较未通过；核对 PID/创建时间/规范路径后重新采样，原始 target 快照保留，没有将失败采样计入结果。文件夹对话框 UIA set_value 一次缓存失效，重新观察后使用已确认焦点的路径输入完成，没有改产品代码绕过测试。

## 交付状态与限制

代码已修复、上述测试及原生换肤/重启已通过，QA-071 关闭；提交推送结果随后补记。工作树移除后的列表保护及精确锁竞态以真实临时文件回归为证据，没有为此删除真实工作树或声称原生竞态已实测。用户安装版未替换。

提交前再次 fetch 成功，master 仍为 `42df3f730be8ddd157a6aaca8d9a2b908638c950`，交付分支仍为 `7e2ca321155fad3495694076051077a89f97cdea`，均已包含，没有新提交需要整合。
