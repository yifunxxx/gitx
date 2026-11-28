# QA165：Git 元数据目录保留与解析

日期：2026-11-29。开始前已读取台账、fetch 并 ff-only 整合 master 与交付分支；基线 `6ffe5d31826d521d8785685e598749cf1674d588` 包含 master `b5987aea07606de7b98d01f7648db8b62f68f4ce`（0.1.57）。全程主线程。证据目录：`E:/IDEAproject/gitx/test-results/qa-common-directory-20261129`。

## 复现与修改

在真实 `git init --separate-git-dir` 仓库中，元数据目录名以全角空格 U+3000 结尾。原 `git_common_dir` 对 Git 输出执行 `trim()`，把合法目录名裁短为相邻路径。首轮 5 项回归中 4 项失败、普通及 linked worktree 对照 1 项通过（`before.log`）：

- common-dir 返回的路径丢失 U+3000。
- 多仓库识别返回同样错误的元数据路径。
- `open_or_create_exclude` 在截短的相邻目录创建 `info/exclude`。
- 相邻目录已经存在时，Shelf 条目被保存到相邻目录；实际 common-dir 下没有该条目。

本项影响实际文件落点，不只是路径显示。Shelf 历史 QA023 的失败 fixture 是普通临时仓库，目前没有证据关联到本问题；QA023 保持待核查。本轮核对 runner 输出等待、metadata 互斥、Shelf 发布/消费和 TempDir 生命周期，没有取得它的新增根因证据，也没有重复旧 12 轮测试或增加读取重试。

修改：

- `git_common_dir` 与 `git_dir` 共用单路径输出解析，只移除 Git 输出最后一个 LF，保留合法空白；复用已有 WSL 到 UNC 的转换。
- 打开项目与多仓库识别共用四字段 `RepositoryProbe`，统一根目录、git-dir、common-dir 处理，保留原 canonicalize 行为。
- 新窗口 `--open` 参数也保留完整目录名，避免进入路径探测前就截掉末尾空白。
- 空路径、NUL、非 UTF-8 和缺少/多余字段明确失败，避免回退到工作目录或静默写入替代路径。
- 回归覆盖末尾 Unicode 空白、相邻目录隔离、Shelf 保存/恢复与导出保护、本地 exclude、普通/子目录/linked worktree/bare，以及路径输出和 WSL 转换。

不会自动移动此前被错误写入的相邻目录内容：相邻目录可能属于另一仓库，不能仅凭名称判断归属。单路径输出能保留 Unix 换行路径；四字段探测不支持含换行的路径，现明确拒绝歧义，不宣称已实现这类项目打开。WSL 为转换回归，尚无真实发行版端到端证据。

## 自动验证

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 旧实现真实目录回归 | 1 通过 / 4 失败 | `before.log` |
| 首轮同条件修后 | 5 通过 | `after.log` |
| Git 与 metadata 两 crate 完整回归（含扩展目录 6 项） | 69 个测试/文档目标，553 通过 / 8 既有辅助 ignored，退出 0 | `rust-git-meta.log` |
| 应用 lib（含新窗口参数） | 76 通过 / 1 既有 ignored，退出 0 | `app-lib.log` |
| 最终路径单元测试 | 8 通过，执行 0.00 秒 | `path-unit-final.log` |
| Clippy（gitx / gitx-git / gitx-meta）与 fmt | 通过 | `clippy.log` 及命令输出 |
| Windows debug 独立标识构建 | 通过，2 分 41 秒 | `build.log`、`tauri.qa.json` |

新增 12 项测试：6 项真实 Git 集成、5 项解析单元、1 项启动参数。最后一次仅把解析单元测试的虚构 WSL UNC 路径换成本地临时目录，避免单元测试意外探测网络文件系统；单路径 WSL 转换测试保留，末次 8 项通过。产品逻辑与原生构建一致。初次 fmt 检查发现新测试的断行格式，已格式化；没有掩盖测试失败。

前端源码、接口类型和页面交互协议未变，原生构建复用当前 QA164 前端资源，未重复整套前端测试。这里报告的是相关 Rust 与当前 Windows 原生验收，不冒充全平台或完整项目验收。

## 原生验证与收尾

使用独立 settings/profile 及无 remote 的真实仓库，工作目录 `working tree　`、元数据目录 `metadata　` 均以 U+3000 结尾；CLI 只准备 fixture/启动测试程序和读盘核对，GUI 操作由第一方 CUA 完成。

1. `--open` 启动后显示 Repository=yes、main 分支、1 个修改文件及正确 Log；路径末尾字符在实际文档文本中保留。
2. 文件右键 Shelve，保持默认“Keep local changes”未选，保存完成后 Changes 为空，Shelf 显示 1 文件。磁盘核对 `metadata　/gitx/shelf/0d58e498-2a4e-45de-bdd3-2ffc3a12f3e8` 存在、工作文件恢复 base、状态干净；截短的 `metadata` 目录未创建。
3. Shelf 右键 Unshelve，选择该文件并保留 Shelf 条目。完成后 Changes 恢复 1 文件，文件字节 SHA256 与初始修改完全相同，HEAD 保持；恢复按原有行为将文件暂存，原生结果为 `M  fixture.txt`，已单独记录，未称索引自动保持原状。
4. GUI 正常关闭。8 个观测到的应用/WebView/conhost 进程身份均退出，专用 settings 已归档并移除，个人 settings SHA256 保持。CLI 仅将测试文件取消暂存，核对 HEAD/索引树/状态/文件回到基线；本次新建的 Shelf 及保活 refs 作为测试证据保留。

首个 AX 点击返回 `coordinate input geometry is unavailable`，重新观察后用可见坐标和当前 AX 继续，未把这次工具错误认定为产品缺陷。后续操作按最终状态与磁盘结果验收；没有进行原生性能计时。WSL 真机、多平台及历史 QA023 的边界仍保留。

测试程序 SHA256：`279c4cdff51e5cfcb8e3afed1072b07d64608ca07e39c3e86d3f55b96ceb0af3`。证据包括 `target.json`、`baseline.json`、`native-shelved.json`、`native-restored.json`、`fixture-verification.json`、`native-identities.json`、`exit-verification.json`、`test-summary.json`，GUI 状态和截图保留在本任务工具输出中。

QA165 按上述范围关闭，新增并解决 1 项，原 9 项及七项目标继续。提交前再次 fetch/整合两分支无新提交，准备独立提交推送；最终完整 SHA 与远端核对留在本目录 `delivery.json`。用户安装版未更新。
