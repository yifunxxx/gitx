# 远程仓库与同步

## 配置 Remote

从顶部 VCS 菜单或 Find Action 打开 **Manage Remotes**。添加名称（常用 `origin`）和仓库 URL，保存；也可编辑或删除现有 remote。设置中的 **Fetch on add remote** 控制新增后是否立即获取。删除 remote 配置不会删除服务器仓库。

HTTPS 和 SSH 使用 Git 的认证环境。HTTPS 弹窗出现时输入用户名和服务器要求的密码/访问令牌；按需要选择记住凭据。SSH 需要先在系统中配置密钥和主机访问。gitx 不提供完整的 GitHub 账号、PR Review 或 GitLab MR 管理中心。

## 区分四种操作

| 操作 | 做什么 | 会否改变当前本地文件 |
| --- | --- | --- |
| Refresh (`Ctrl+R`) | 刷新本地状态 | 不主动从远程合入代码 |
| Fetch | 获取远程提交和引用 | 不自动合并当前分支 |
| Pull / Update Project | 获取并按策略整合远程 | 可能更改文件、提交历史或进入冲突 |
| Push (`Ctrl+Shift+K`) | 把本地提交发送到远端 | 主要改变远程引用 |

## Pull：明确指定目标

1. 打开 **Pull**，选择 remote 和 branch。
2. 按项目约定选择 Rebase 或 Merge 路径。
3. 核对选项及预览后执行；等待任务结束。
4. 在 Log、Changes 和 Console 检查结果；若有冲突按[冲突处理](./conflicts)继续。

| 选项 | 含义 |
| --- | --- |
| `--rebase` | 将本地提交重放到远程更新之上 |
| `--ff-only` | 仅允许快进，分叉时失败 |
| `--no-ff` | 即使可快进也保留合并提交 |
| `--squash` | 汇总修改到本地，通常还需自行提交 |
| `--no-commit` | 合并应用后暂停在提交之前；快进场景需结合 Git 实际行为 |
| `--no-verify` | 跳过适用 Git hooks，只在明确知道原因时使用 |

不要随意同时启用相互冲突的选项；以预览和 Git 返回的校验结果为准。

## Update Project：按项目策略更新

按 `Ctrl+T`。选择 **Merge remote changes**、**Rebase onto remote branch** 或 **Reset to remote branch**。最后一种会移除不在远端分支上的本地提交，需要先保留要用的历史。

有本地修改时，软件可按 **Clean tree method** 使用 Stash 或 Shelf 暂存，并在适当阶段恢复。若冲突、暂停或合并尚待提交，恢复可能延后；按状态横幅处理，再检查本地修改是否恢复。Update Info 显示本次更新结果，可从底部标签查看。

勾选“不再显示选项”后，后续使用设置中的策略；需要重新确认时到 Settings 开启 **Show options before update**。

## Push：检查预览再发送

1. 按 `Ctrl+Shift+K`。
2. 选择 remote、本地分支和远程分支。无 remote 时可在窗口中添加名称与 URL。
3. 检查待推送提交与目标。首次推送新分支可启用 **Set upstream**。
4. 标签策略可选不推标签、全部标签或当前提交相关标签；按实际需要选择。
5. 默认普通 Push。只有确认要替换远端历史时才使用 **Force with lease**，它仍可能改写协作者依赖的历史。

受保护分支设置可阻止强推，默认包括 main/master。保护规则是本机工具约束，不能代替服务器的分支保护。

## 推送拒绝和认证失败

推送被拒绝时先读原因：远端领先应先 Fetch，再 Pull/Update 解决分叉，完成后重试普通 Push。认证错误需检查 URL、权限、令牌或 SSH 配置。不要用强推解决凭据错误。

若本地提交已成功而推送失败，提交仍在本地，不需再提交一次。网络失败时查看任务与 Console；取消网络任务后确认实际结果再重试。

## 同步 Fork

在 Manage Remotes 添加父仓库 remote（通常 `upstream`），在 Settings 配置 **Fork parent remote**，通过 Find Action 执行 **Sync Fork with Upstream**。该流程会获取父仓库、更新默认分支并尝试推送到 origin，确认框中需核对 remote。它是通用 Git 流程，不是托管平台账号授权功能。
