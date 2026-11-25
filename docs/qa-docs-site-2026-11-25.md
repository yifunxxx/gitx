# QA-088：双语使用文档与 GitHub Pages

日期：2026-11-25。执行方式：仅主线程，遵循用户禁用子代理要求。

## 基线与范围

开始前成功 fetch，原 `codex/file-tool-window` 已被合入并由远端删除；快进到 `origin/master` 的 `59a931382b0344e8f1938da3dc511b14a0815a37`（0.1.47），创建 `codex/docs-site`。本轮新增文档、构建检查和部署，不改桌面软件行为。

- VitePress 1.6.4；公开目录单独放在 `docs/site`，QA 记录不在站点发布目录内。
- 中文根路径、英文 `/en/`，各 22 页：首页以及 21 个指南。包括上手、工作区、提交、Diff、File、搜索、分支、同步、历史、冲突、历史整理、Stash/Shelf、补丁、Worktree、终端、设置、快捷键、排错、术语、完整功能索引和发布维护。
- 72 个注册命令均映射到指南，33 个设置字段在两语设置说明中覆盖。TypeScript AST 提取名称、默认按键和注册项，生成双语索引；新增动作未分配指南会阻止构建。
- 中英文同章节切换、侧边导航、正文目录、两语本地搜索、主题切换、编辑链接、站点地图。中文搜索使用 `Intl.Segmenter` 分词，移动端宽表格在自身区域内横向滚动。
- README 两种语言提供在线入口和本地维护方式。GitHub Actions 中 PR 只校验，授权发布分支 push 构建并发布 Pages。

## 内容核查与 QA-089

从动作注册、菜单、Vue 组件、store、Rust Git 调用及原生窗口核对实际操作，尤其检查选择/勾选/暂存的区别、Changes 与 File 的 F4、Patch 输出位置及未跟踪文件、Worktree PR 引用、更新下载/安装边界。

发现并登记 QA-089 为功能入口差距，未当作已复现数据损坏：

1. `stageHunks/unstageHunks` 存在于 backend/store；当前 Diff 的实际 UI 是输入新增/修改行号暂存，没有逐块 Stage/Unstage/Rollback 按钮。文档说明纯删除/选块的 Git 命令替代。
2. `allowPerHunkChangelists` 有设置，但未发现按块分配的 UI 消费；按文件管理 Changelist。
3. ShelfFiles 是只读清单，Unshelve 操作整条记录；文档说明创建时拆分 Shelf。
4. `autoFetchMinutes` 有存储/设置展示，没有已接通的定时 Fetch 调用；明确使用手动 Fetch。

上述边界已写入两语教程与功能索引，本轮不扩展产品实现。既有 11 项产品 QA 与 QA-089 共 12 项未关闭，不是项目所有潜在问题的总量，也不影响本轮文档交付范围。

## 原生截图证据

使用已有隔离程序 `test-results/qa083-native/gitx-qa083.exe`，SHA256：`0B5166A17CD4070AEBFD4FEC9BA622E01E1138EB97D9F68C44AC0B3B1C99D643`，独立标识 `app.gitx.qa083`。它来自前轮最终 0.1.46 原生构建；0.1.47 相对于前版本提交仅变更版本号/锁文件，相关功能源码相同。不把它写成用户安装版已更新。

本轮专用示例仓库 `test-results/docs-demo/orbit-notes` 与 `orbit-merge`，使用虚构作者 Alex Chen / alex@example.com，不含私人远程仓库或凭据。Windows 原生截图共 9 张：中英文 Commit/Diff、File 编辑器、内容搜索、Log、Stash、中英文设置、三栏冲突。冲突截图裁去侧栏/底部无关区域，保留来源标签、三栏内容与按钮。

截图使用 Computer Use 原生窗口接口；没有用 mock 网页代替桌面截图。示例应用进程已退出，测试 profile 按备份恢复原字节，真实 `app.gitx.desktop` 设置 SHA256 与开始前一致。没有运行安装更新。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 双语源码检查 | 22 + 22 页面、72 命令、33 设置、280 本地链接、20 图片引用通过 |
| VitePress 生产构建 | 通过，生成两语静态 HTML、搜索索引与站点地图 |
| 产物检查 | 45 HTML（含 404）、1,924 本地路由/锚点/资源引用通过，两语 lang 正确 |
| 浏览器桌面 1440px | 两语首页、提交及冲突章节、截图加载通过，无 console/pageerror |
| 语言切换 | 中文提交章节切换到同名英文提交章节通过 |
| 搜索 | 中文“冲突”首项为“逐文件解决冲突”，英文 worktree 首项为 Worktree 教程；结果各在对应语言下 |
| 深色主题 | 切换及深层页面刷新保持通过 |
| 浏览器移动 390px | 无页面横向溢出，目录导航、正文/截图通过；表格自身可横向滚动 |
| 依赖安装 | Node 24.22.1 / pnpm 10.33.4，frozen-lockfile 通过；CI 使用 .nvmrc Node 22.23.3 |
| 软件兼容性 | `pnpm typecheck`、`pnpm build` 通过，保留原有 chunk/dynamic-import 构建警告 |

临时自动浏览器检查和画面保存在 `test-results/docs-demo/`，不会发布到站点。正式检查脚本为 `scripts/check-docs.mjs` 和 `scripts/check-docs-output.mjs`。文档检查处理 Windows CRLF，避免平台换行造成生成引用误报。

首次缺图构建按预期拒绝，补齐后通过。重建后未重启预览服务的一次浏览器验证因旧 hash 映射出现资源 404；重启同一正式产物的预览后全部通过。没有将其误记为线上站点缺陷。

## 同步与交付

提交前首次 fetch 遇到 SSL 10054；重试使用单次 HTTP/1.1 成功，远端 master 仍为 `59a9313`，当前 HEAD 已包含，尚无远端 docs-site 分支。期间只整理/验证现有文档。

已通过仓库 API 开启 GitHub Pages，Source 为 GitHub Actions，计划地址为 `https://yifunxxx.github.io/gitx/`。提交、推送、CI 和线上访问证据将在部署完成后补记；此时不声称已上线。
