# Git 2.34 Worktree 列表兼容验证

日期：2026-11-09。环境：Windows、Git 2.34.1.windows.1、Rust 1.90。

## 问题与修改

Git 2.34 不支持 `git worktree list --porcelain -z`，会返回退出码 129。
此前列表操作直接失败，导致 Worktree 面板无法刷新。现在检测该兼容性错误后，
回退到 LF porcelain 输出。

LF 输出中的路径、锁定原因和失效原因可能使用 Git 的 C 引号（八进制字节、换行、
制表符、引号和反斜杠）。解析器现在解码这些值，并保留工作树路径中的空格、Unicode
和实际控制字符；NUL 输出仍按字面值解析。当前工作树比较统一经过路径规范化。

## 验证

- `gitx-git --all-targets`：57 项通过。
- 新增 2 项真实 Git 回归：中文与空格路径的主/Linked Worktree 列表、带中文和多行原因的锁定项。
- 新增解析器回归：C 引号、八进制 Unicode、CRLF、bare、detached、prunable、NUL 字面量和尾部空格。
- `gitx-git` all-targets Clippy 通过；保留 2 条已有 testkit/status 警告的普通 Clippy 记录。
- 集成工作区的严格 workspace/all-targets Clippy 通过（`clippy-compat-integrated-final.log`）。
- 集成工作区已构建 `gitx` 与 `gitx-helper`，并用该调试版本进行桌面复验。
- 桌面列表实际显示中文路径 `中文 review 工作树`、分支 `qa/中文-review` 和锁图标；可访问性描述包含正确解码的锁定原因，
  “解锁”可用，“移除”保持禁用。证据：`compat-gui-worktree-list-ui.txt`、`compat-gui-list-verified.json`。
- 同一构建在 Git 2.34 fixture 的主工作树根目录打开日志并改写中间提交消息，提交树、暂存区、未暂存修改、未跟踪文件、分支和 Linked Worktree
  均保持；历史消息变为 `QA middle rewritten`。证据：`compat-gui-reword-ui.txt`、`compat-gui-reword-verified.json`。
- 从子目录发起历史改写由自动回归覆盖，本轮未进行该入口的桌面复验。

本次未替换安装版 `D:/gitx/gitx.exe`。桌面进程树在复验期间保持单一调试主进程及其 WebView 子进程。
10:14 按 PID 和创建时间核对，复验时记录的 8 个进程均已退出，当前调试主进程计数为 0
（`compat-gui-closed-process-tree.json`）；本次检查未重新执行桌面关闭动作。
