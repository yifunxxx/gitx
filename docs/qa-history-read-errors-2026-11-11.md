# 历史、修订与 Diff 后端读取错误（QA-021）

日期：2026-11-11。交付分支 `codex/checkout-target-safety`，相关修改同步至 `E:/IDEAproject/gitx`；保留集成目录独立修改。

## 复现与影响

原实现将历史、Blame、目录和文件读取的 Git 退出码 128 视为空结果。使用隔离的真实 Git 仓库验证：无效修订、非仓库、损坏引用、缺失 commit/tree/blob、损坏 index，以及冲突文件缺少 stage 0 都可能被隐藏。显式预览不存在的文件也返回“未选择文件”式空内容。

主目录与集成目录的初始 12 项回归均为 10 失败、2 通过，证据为 `E:/IDEAproject/gitx/test-results/history-read-baseline-{main,integration}.log`。这些不是模拟 IPC 错误；用例真实修改临时仓库对象/索引，并核对 GitRunner 的结果。

## 修改

- 文件读取使用 `cat-file blob`，成功路径仍只执行一次 Git；失败时用 literal pathspec 的 tree/index 查询证明路径确实不存在。已有对象损坏、未合并 stage、目录或子模块不能伪装成删除文件。暂存区明确读取 stage 0。
- HEAD 只在符号引用指向确实不存在的引用时作为未创建首提交处理；损坏引用和丢失对象继续报错。历史的所有分支查询失败不套用当前 HEAD 的空仓库兜底。
- 目录与 Blame 直接传播失败，保留真实空目录/空文件的成功结果。
- Diff 保留新增、删除、重命名、`EMPTY` 基线和未创建首提交仓库的合法空侧；显式文件预览在路径不存在时返回 `NotFound`。
- 工作区读取仅将真实 `NotFound` 视为空侧，其他文件系统错误和已取消操作正常报错。
- Git 错误保留原命令、stderr 和退出码，已有前端错误/重试入口无需变更接口。

## 自动验证

新增 17 个真实 Git 回归覆盖上述失败，以及对象恢复后重试、字面特殊路径、中文/空格、二进制、符号链接、目录、子模块、空 tree、HEAD 未创建但存在其他分支、detached HEAD、取消和 Git 程序缺失。

相关 Rust 回归独立分支 60 项、集成目录 62 项通过，覆盖历史/目录/文件读取、根提交比较、普通提交、部分暂存/取消暂存/回退和提交消息。明确 stage 0 后，两处最终 17 项读取用例均再次通过。前端定向独立分支 51 项、集成目录 60 项通过（包含其独立生命周期测试）。两处覆盖有重叠，不相加。

相关 Rust 文件格式检查、`git diff --check` 及独立分支原生构建 `cargo build -p gitx --locked --features tauri/custom-protocol` 通过。前端源码/接口未修改，沿用上一轮通过类型检查和生产构建的前端产物。日志统一使用 `E:/IDEAproject/gitx/test-results/history-read-*` 前缀。

## 原生复查

程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-history-read-20261111.exe`；SHA256 `FE0BA492D521452B7FF4258B8BE86990796A47D9FA3003BD65884B41C58F26EC`。实际 Git 版本 `2.34.1.windows.1`。

隔离仓库：`E:/IDEAproject/gitx/test-results/repos/history-read-gui-20261111`；HEAD `2337bf5329d73e6dd1bd6ce77350734c6e714767`。

实际观察：

- 打开修订浏览器后临时移走 readme.txt 对应 blob，选择文件显示“文件加载失败”及 Git `bad file` 错误，目录仍可操作。恢复对象后点击“重试”，显示 `Current preview restored`。
- 临时移走 nested 目录对应 tree，进入目录显示“目录加载失败”及 `not a tree object`；恢复对象后点击“重试”，重新显示 file.txt，选择文件显示 `Nested preview restored`。
- 临时移走父提交对象，打开 nested/file.txt 历史显示“文件历史加载失败”及 `Failed to traverse parents`；恢复对象后点击“重试”，显示根提交和该文件新增 Diff。
- 结束后核对 HEAD、引用、状态、索引原始哈希、两个工作区文件哈希及所有故障注入对象字节均与测试前一致。原生测试程序已关闭，进程及窗口列表确认退出。

记录：`history-read-gui-{before,after}.json`。原生仅验证上述三类故障与恢复；其余损坏索引、无效修订等组合由真实 Git 自动回归覆盖，不声称全部执行过 GUI 操作。

## 边界

本项解决读取错误分类，并不修复仓库本身的损坏。GUI 复查仅在新建隔离仓库内注入故障，结束后恢复对象并核对 HEAD、引用、状态、索引和文件哈希。WSL 环境未覆盖。原安装版 `D:/gitx/gitx.exe` 未替换，整体六项目标继续。

QA-022 单独登记历史 name-status 路径引号/分隔及 literal pathspec 的核查线索，尚未真实复现。本轮特殊路径用例覆盖 blob 和目录，不把它算作历史路径解析已修复。深色历史 Diff 亮色行号栏仍由 QA-009 跟踪。

## 交付

QA-021 代码、自动验证及原生复查完成；功能提交与远端核对结果待本次交付后补记。
