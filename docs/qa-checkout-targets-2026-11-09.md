# 分支检出目标校验

远程分支 `origin/feature/login` 现在创建或复用 `feature/login`，保留完整目录。只有确实追踪目标远程引用的本地分支才会复用；同名冲突和不存在的远程引用明确报错，保留原有分支及未推送提交。支持完整远程引用、带斜杠的远程名称和中文分支。

本地检出验证准确的本地分支，禁止 Git 把文件路径解释为恢复文件操作。空值、选项式目标和未知模式会被拒绝；修订检出解析到提交后进入 detached HEAD。操作开始前检查取消和进行中的 Git 操作。

验证环境：Windows，Git 2.34.1.windows.1，Rust 1.90。

- 本分支：`cargo test -p gitx-git --test checkout_targets --test m2_branches_sync`，8 项新增真实 Git 回归和 3 项原有分支测试通过；`cargo fmt --check` 和差异空白检查通过。
- 本分支 Clippy 普通模式通过；严格模式受远程基线的 `FixtureBuilder` 手写 Default 和 status 测试中的歧义转义告警阻挡，本次变更未产生告警。
- 扩大的 `cargo test -p gitx-git --all-targets` 在历史改写集合有 4 项失败：本机 Git 不支持基线使用的 `merge-tree --write-tree --merge-base`。临时恢复本文件到未修改的远程基线后，同样四项失败，已确认与本次检出修改无关。
- 集成 QA 构建的桌面验证：双击 `origin/feature/login`，正确分支、SHA、upstream、已有 `login` 分支、远端 refs、索引、内容和未跟踪文件等 11 项核对通过；检出冲突的 `origin/feature/collision` 被拒绝，9 项状态核对不变。退出后采样的 8 个进程全部结束。该桌面构建还包含其他待拆分优化，本提交仅包含目标校验及其测试。

本记录证明本功能的验证范围，不代表项目六项整体验收完成。
