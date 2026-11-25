# 维护与部署文档

本页供项目维护者使用。普通软件使用不需要 Node.js、pnpm 或 GitHub Pages 设置。

## 本地编辑和预览

站点使用 VitePress 1.6.4。公开内容位于 `docs/site`，项目 QA 台账与内部工作记录不进入网站。

在项目根目录使用 `.nvmrc` 指定的 Node 版本和 `package.json` 中的 pnpm 版本：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm docs:dev
```

打开终端显示的本地地址，并访问 `/gitx/` 路径。提交前运行：

```sh
pnpm docs:reference
pnpm docs:build
node scripts/check-docs-output.mjs
pnpm docs:preview
```

`docs:reference` 更新从应用动作生成的功能索引与默认快捷键。`docs:build` 先核对双语配对、72 个已注册命令、设置覆盖、图片和本地链接，再构建；新增动作未归属指南时会报错，需要更新覆盖映射和教程。

## 目录约定

| 目录/文件 | 用途 |
| --- | --- |
| `docs/site/index.md`、`guide/*.md` | 中文首页和指南 |
| `docs/site/en/index.md`、`en/guide/*.md` | 相同路径的英文版本 |
| `docs/site/public/screenshots` | 已检查可公开的示例截图 |
| `docs/site/.vitepress/config.mts` | 导航、语言、搜索和部署路径 |
| `docs/site/.vitepress/theme` | 主题样式 |
| `scripts/docs-reference.mjs` | 动作覆盖与速查生成 |
| `.github/workflows/docs.yml` | 校验、构建与发布 |

新增章节时同时创建中英文页面，更新侧边栏；截图写上说明和替代文本。不能把私人仓库、令牌、真实凭据或无关桌面窗口放进公开截图。截图应来自实际软件，使用示例数据；若裁剪应保留理解操作所需的上下文。

## GitHub Pages 首次启用

1. 打开仓库 **Settings → Pages**。
2. 将 **Build and deployment → Source** 设为 **GitHub Actions**。
3. 确保 Actions 被允许运行，`github-pages` 环境允许用于发布的分支。
4. 推送文档变更触发 **Documentation** 工作流；查看 build 和 deploy 两个任务。
5. 部署成功后访问 `https://yifunxxx.github.io/gitx/`，英文入口为 `/gitx/en/`。

此项目仓库的路径前缀是 `/gitx/`。若 Fork 后仓库名不同，修改工作流的 `DOCS_BASE`、配置中的站点地址和 favicon 路径；若使用自定义域名或 `username.github.io` 根站点则按需要使用 `/`。不要只改首页链接而保留错误的资源前缀。

## 发布分支与更新流程

当前支持推送到 **master、main、codex/docs-site** 自动发布；`codex/docs-site` 用于首次文档交付，主分支合入后可从 workflow 的两个分支条件中移除这一交付分支。多个发布分支指向同一网站，最后完成的部署会生效，日常应选定单一维护分支。

Pull request 只校验和构建，不部署。手动 **Run workflow** 入口需工作流存在于默认分支；在此之前使用受支持分支的 push 触发。编辑链接按构建分支生成。

站点使用 GitHub 提供的 Pages 与短期工作流凭据，无需另存个人访问令牌。仓库只保存源码和截图，生成目录 `.vitepress/dist` 作为构建产物上传。

## 检查部署与排错

- **构建报坏链接/图片**：修正引用或补齐文件，不能关掉坏链接检查。
- **新命令没有文档归属**：更新动作覆盖表并补写两种语言，再生成索引。
- **环境不允许发布分支**：在 Settings → Environments → github-pages 检查发布分支策略。
- **页面正常但资源 404**：核对 base、实际仓库名、图片路径及部署产物。
- **刷新深层链接 404**：确认 Pages 已完成此次部署，目标 `.html` 页面在产物中，访问正确前缀。
- **旧内容仍显示**：检查最近成功运行的提交和部署时间，再刷新浏览器。

参考：[VitePress 部署](https://vitepress.dev/guide/deploy)、[国际化](https://vitepress.dev/guide/i18n)、[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
