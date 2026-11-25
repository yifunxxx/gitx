# 安装与第一次提交

这一页带你从安装 gitx，到完成一次本地提交。第一次练习建议使用单独的示例文件夹。

## 安装与准备

1. 从 [GitHub Releases](https://github.com/yifunxxx/gitx/releases/latest) 下载 Windows 安装包：NSIS `.exe` 或 MSI，选一种即可。
2. 运行安装包，安装并启动 gitx。普通使用无需安装 Node.js、pnpm 或 Rust。
3. 系统需要可用的 Git。若软件提示找不到 Git，安装 [Git for Windows](https://git-scm.com/downloads/win)，然后在 **Settings → Git → Git executable** 选择 `git.exe` 并点 **Test**。
4. 首次提交前，配置 Git 作者身份。gitx 沿用 Git 配置；可在系统终端中对当前仓库设置：

```sh
git config user.name "Your Name"
git config user.email "you@example.com"
```

在仓库目录运行上面的命令。只有希望应用到所有仓库时才加 `--global`。

## 切换软件语言

按 `Ctrl+,` 打开 **Settings → Appearance → Language**，选择 **简体中文**，点 **Apply** 或 **OK** 保存。文档右上角的语言菜单只切换文档语言；它与软件设置独立。中文界面会保留 Git、Commit、Stash 等常用术语。

## 打开、克隆或创建

| 场景 | 入口 | 操作与结果 |
| --- | --- | --- |
| 电脑已有项目 | 欢迎页 **Open Folder** 或 `Ctrl+O` | 选择文件夹；软件检测其中的 Git 仓库。普通文件夹也能浏览编辑 |
| 项目在远程 | **Clone Repository** | 填 URL、父目录和目录名，核对最终目标路径，再 Clone；完成后打开克隆结果 |
| 从零开始 | **Create Repository** | 选择目标目录，确认初始化；原有文件保留，出现 Git 提交界面 |
| 已打开普通文件夹 | **Enable Version Control Integration / Init** | 确认后在该目录启用 Git |

克隆窗口的 **Shallow clone** 可设置历史深度（正整数），适合只需近期历史时减少下载；完整历史比较/重写可能需要完整克隆。**Open after clone** 控制完成后是否打开。克隆可以取消；若目标目录留下部分文件，先检查，再使用空目录重试。认证问题见[远程同步](./sync)。

## 完成第一次提交

1. 打开示例仓库，按 `Alt+1` 显示 **File**。右键目录新建 `README.md`，双击打开，写下项目说明。
2. 按 `Ctrl+S` 保存。保存只写入磁盘，并未创建 Git 提交。
3. 按 `Alt+0` 显示 **Commit**。新文件出现在 **Unversioned Files**，已跟踪文件的修改出现在更改列表。
4. 默认使用 **Changelist 模式**：勾选这次提交的文件。双击文件或 `Ctrl+D` 检查差异。若你启用了暂存区模式，先 **Stage**，再检查 **Staged**。
5. 输入有意义的 Commit message，例如 `Add project introduction`；保留 **Run Git hooks**，点击 **Commit**。
6. 在底部 **Log** 检查新增提交，确认说明和文件正确。成功后本次已提交的修改从待提交列表消失；其他未提交修改仍保留。

![Commit、差异和 Log 的实际界面](/screenshots/commit-diff-zh.png)

图中左侧负责选择提交内容，中间显示两个版本的差异，底部显示提交历史。截图为中文界面，英文版布局一致。

## 把提交推送到远程

按 `Ctrl+Shift+K` 打开 **Push**。没有 remote 时先添加远程名称与 URL；核对本地分支、远程分支、待推送提交，并按需要启用 upstream，再 Push。完整流程见[远程仓库与同步](./sync)。

**Commit 成功只表示本地历史更新。Push 成功才表示提交已发送到远程。** 文件保存、提交和推送是三个不同步骤。

## 继续学习

- [工作区与界面导航](./workspace)：找到面板和命令。
- [提交与更改列表](./commit)：理解勾选、暂存、Amend 和忽略文件。
- [常见问题](./troubleshooting)：按钮不可用、Git 身份、认证和恢复。
