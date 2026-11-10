# Shelf 保留和引用清理（QA-006）

日期：2026-11-11。原始依据为 `docs/dev-plan/07-stash-ignore-settings-chrome.md` 的“删除后保留 30 天”，系统 Shelf 不自动删除。相关代码同步至集成目录，保留其独立修改。

## 实现

- `deletedAt` 记录实际删除/完整消费时间；恢复时清除，重新删除重新计时。创建时间不作为删除时间。旧删除记录没有有效时间时，从首次维护起给予完整 30 天，未来时间不提前过期。系统条目始终保留。
- 到期条目先原子移动为 `.expired-<id>`，再逐个删除校验过的普通补丁文件，最后删除元数据和空目录。失败可重试，不递归删除陌生内容；损坏条目、链接/Windows reparse point、额外文件和未知目录均保留，并阻止无主引用回收。
- 新 Shelf 在发布元数据前保留 base 对象；导入还记录预镜像 tree 的归属。部分消费保留全部对象归属及旧补丁代次，直到整个条目到期。
- 旧条目的对象归属迁移读取所有补丁代次，总量上限 32 MiB；预镜像缺失/歧义、异常记录或超限时保留旧引用。迁移先发布引用，再原子记录归属，失败不会提前丢失恢复对象。
- 清理仅回收已无人使用、名字与对象一致的 `refs/gitx/shelf-base-<oid>` 和无条目的 UUID Shelf 引用。使用 `update-ref --no-deref --stdin` 的带旧值比较事务；保留符号引用、陌生名字和其他 Git 引用，不运行 `git gc`。
- 创建、导入、应用、删除、恢复、改名和维护共享 common-dir OS 文件锁；进程退出自动释放，无需删除陈旧锁文件。等待支持取消，10 秒后返回“操作进行中”。GUI 维护还使用仓库写调度器。
- 刷新 Shelf 时检查维护时间，每小时最多执行一次成功维护；保留项目状态跨进程/重启共享。维护失败记日志，不隐藏已有列表。列表提供 30 天说明与系统备份标签，删除确认同步提示保留期限。

## 自动验证

- 主目录 Shelf 元数据原有 storage/consumption 14 项通过；最终 retention 11 项通过（其中 1 项为跨进程锁的辅助入口）。覆盖秒级边界、旧记录宽限、活动/系统/未来时间、恢复/消费重置、陌生/损坏/缺失文件、Windows junction、打开中的文件和重试。
- 主目录真实 Git 首轮除 1 项异常外通过；最终 retention 9 项、unshelve safety 6 项通过。另有 local changes 7、export 9、import safety 12、preview 4、creation safety 11、partial 11 项通过。GC 测试实际执行 reflog expire / prune，验证导入孤立 blob、原始与剩余代次、共享归属和最终回收；另覆盖引用锁失败、符号引用、worktree、取消和并发导入。
- 相关真实 Git 用例最终主目录 **69 项**、集成目录 **80 项**通过（集成 local changes 多 11 项独立用例）；覆盖重叠，不相加。两处 Shelf 元数据各 **25 项**通过。以上为按测试目标合并的最终结果，首轮异常及后续复跑分别保留日志。
- 前端定向主目录 **88 / 集成目录 89 项**通过；两处生产构建（含类型检查）、独立分支 `cargo build -p gitx --locked --features tauri/custom-protocol`、集成 `cargo check -p gitx --locked` 通过。改动组件 Oxlint 无错误，相关 Rust 格式及 diff whitespace 检查通过。既有分包大小警告未改变。
- 首轮 `unshelve_safety::binary_unshelve_roundtrip_retains_unrelated_staged_changes` 一次返回 `Shelf entry not found`，单测重跑及整组复跑通过。该测试不触发维护；新增失败诊断，登记 QA-023，不能算已修复。首轮失败日志保留。
- 集成回归发现 preview 测试的观察命令 `git status` 自身会刷新 index 的 racy stat 数据，导致“预览修改 index”的误报；两处观察命令改为 `--no-optional-locks`，保持原有逐字节断言，不修改产品预览实现。

日志：`E:/IDEAproject/gitx/test-results/shelf-retention-*`。

## 原生验证

程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-shelf-retention-20261111.exe`。

SHA256：`5C8240EB007212755FCF098302B78D35DC30A064A3C5AD422D5FEC8676928966`。

隔离仓库：`E:/IDEAproject/gitx/test-results/repos/shelf-retention-gui-20261111`。

- 原生刷新展示“删除后保留 30 天”的中文说明和系统备份标签。活动、旧版删除及系统备份的 createdAt 都设为 1970 年，三者仍保留，未按创建时间清理。
- 检查磁盘元数据，旧删除记录从本次首次维护生成 deletedAt；系统备份的 deletedAt=1 保持不变。
- 通过已删除条目右键菜单“恢复”，条目回到活动 Shelf 并选中，元数据删除时间清除；系统备份仍在最近删除列表。
- 深/浅主题说明及标签可读；恢复原深色主题和面板大小，关闭测试程序。
- 复查 HEAD、Git 引用、状态、索引原始哈希和工作文件哈希全部保持不变；已恢复条目及系统条目的保存补丁保持不变。证据 `shelf-retention-gui-{before,after,ids}.json`，脚本在独立分支忽略的 `test-results/shelf-retention-gui.mjs`。

到期删除、GC、取消、并发和失败重试由自动测试验证，本轮未通过原生界面触发实际到期删除。第一次误用开发模式构建只显示 localhost 拒绝连接，关闭后重新构建内嵌资源版本，以上验收使用最终 SHA256 对应程序。

## 边界

安全无法确认的旧/损坏数据仍可能占用磁盘和 Git 对象；这是保留恢复能力的行为，不声称已回收全部历史垃圾。超过 32 MiB 的旧条目不自动迁移引用归属。旧版程序和手工直接修改元数据的外部工具不遵守新增的 Shelf 锁；不支持同时用旧版客户端写同一 Shelf 存储。

QA-006 代码、自动验证和原生复查完成，待提交推送。原安装版 `D:/gitx/gitx.exe` 未替换。QA-023 异常仍待核查，整体目标保持进行中。
