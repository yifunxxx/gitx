# 完整功能索引

本索引按当前桌面界面组织操作指南。构建时会核对源码中已注册的命令，减少新增功能后文档遗漏；各面板按钮与右键菜单也纳入对应章节。

## 按任务查找

| 功能范围 | 操作指南 |
| --- | --- |
| 安装、打开、创建、克隆与第一次提交 | [查看步骤](./getting-started) |
| 面板、布局、标签、项目切换和命令查找 | [查看步骤](./workspace) |
| 更改列表、暂存、提交、Amend、忽略与回退 | [查看步骤](./commit) |
| 双栏/统一差异、行号暂存与比较限制 | [查看步骤](./diff) |
| 文件编辑、批量操作、拖放与路径菜单 | [查看步骤](./files) |
| 已加载过滤、模糊跳转、全局内容搜索 | [查看步骤](./search) |
| 分支新建/检出/改名/删除、收藏、比较和标签 | [查看步骤](./branches) |
| Remote、认证、Fetch/Pull/Push、更新项目和同步 Fork | [查看步骤](./sync) |
| Log、筛选、修订比较、文件历史、历史浏览与恢复 | [查看步骤](./history) |
| Merge、Rebase、Cherry-pick、Smart 保存与冲突处理 | [查看步骤](./conflicts) |
| 交互式变基、Reword、Squash、Drop、Fixup、Reset、Revert、撤销 | [查看步骤](./rewrite) |
| Stash/Shelf 创建、应用、预览、删除与恢复 | [查看步骤](./stash-shelf) |
| 当前变更补丁、Shelf 导出、补丁导入 | [查看步骤](./patches) |
| Worktree 创建/管理、Ref 审查、多仓库与子模块 | [查看步骤](./worktrees) |
| 真实终端、会话、Console 和后台队列 | [查看步骤](./terminal) |
| 所有设置字段、外观、语言、快捷键和软件更新 | [查看步骤](./settings) |

## 已注册命令

用查找动作（`Ctrl+Shift+A`）搜索名称。是否可执行取决于仓库状态和当前选择；没有默认快捷键不代表功能不可用。

| 命令 | Windows 默认键 | 说明 |
| --- | --- | --- |
| 新建变更列表 | — | [使用方式](./commit) |
| 提交 | `Ctrl+K` | [使用方式](./commit) |
| 创建补丁… | — | [使用方式](./patches) |
| 显示 Diff | `Ctrl+D` | [使用方式](./diff) |
| 文件内查找 | `Ctrl+F` | [使用方式](./search) |
| 查找下一个 | `f3` | [使用方式](./search) |
| 查找上一个 | `Shift+f3` | [使用方式](./search) |
| 文件内替换 | `Ctrl+h` | [使用方式](./search) |
| 替换文件内全部匹配 | `Ctrl+Alt+enter` | [使用方式](./search) |
| 替换当前匹配 | — | [使用方式](./search) |
| 在文件中查找… | `Ctrl+Shift+F` | [使用方式](./search) |
| 跳转到文件… | `Ctrl+P` | [使用方式](./search) |
| 打开… | `Ctrl+O` | [使用方式](./getting-started) |
| 在文件中替换… | `Ctrl+Shift+h` | [使用方式](./search) |
| 保存 | `Ctrl+S` | [使用方式](./files) |
| 添加到版本控制 | `Ctrl+Alt+A` | [使用方式](./commit) |
| 分支… | — | [使用方式](./branches) |
| 接受对方 | — | [使用方式](./conflicts) |
| 接受己方 | — | [使用方式](./conflicts) |
| 合并… | — | [使用方式](./conflicts) |
| 拣选 | — | [使用方式](./conflicts) |
| 中止拣选 | — | [使用方式](./conflicts) |
| 继续拣选 | — | [使用方式](./conflicts) |
| Clone 仓库… | — | [使用方式](./getting-started) |
| 提交并推送… | `Ctrl+Alt+K` | [使用方式](./commit) |
| 切换提交控件 | — | [使用方式](./workspace) |
| 提交工具窗：停靠 | — | [使用方式](./workspace) |
| 提交工具窗：浮动 | — | [使用方式](./workspace) |
| 提交工具窗：独立面板 | — | [使用方式](./workspace) |
| 与分支或标签比较… | — | [使用方式](./history) |
| 管理 Remotes… | — | [使用方式](./sync) |
| 新建 Worktree… | — | [使用方式](./worktrees) |
| 丢弃提交 | — | [使用方式](./rewrite) |
| 丢弃所选更改 | — | [使用方式](./rewrite) |
| Fetch | — | [使用方式](./sync) |
| 修补到所选提交（Fixup）… | — | [使用方式](./rewrite) |
| 忽略文件… | — | [使用方式](./commit) |
| 创建 Git 仓库… | — | [使用方式](./getting-started) |
| 提取所选更改… | — | [使用方式](./rewrite) |
| 从此处交互式变基… | — | [使用方式](./rewrite) |
| 与本地比较 | — | [使用方式](./history) |
| 合并… | — | [使用方式](./conflicts) |
| 中止合并 | — | [使用方式](./conflicts) |
| 提交合并 | — | [使用方式](./conflicts) |
| 打开 .git/info/exclude | — | [使用方式](./commit) |
| Pull… | — | [使用方式](./sync) |
| Push… | `Ctrl+Shift+K` | [使用方式](./sync) |
| 变基… | — | [使用方式](./conflicts) |
| 中止变基 | — | [使用方式](./conflicts) |
| 继续变基 | — | [使用方式](./conflicts) |
| 跳过当前提交 | — | [使用方式](./conflicts) |
| 刷新状态 | `Ctrl+R` | [使用方式](./workspace) |
| 将当前分支重置到此处… | — | [使用方式](./rewrite) |
| 解决冲突… | — | [使用方式](./conflicts) |
| 中止还原 | — | [使用方式](./rewrite) |
| 还原提交 | — | [使用方式](./rewrite) |
| 编辑提交说明… | `F2` | [使用方式](./rewrite) |
| 导入补丁… | — | [使用方式](./patches) |
| Shelve… | — | [使用方式](./stash-shelf) |
| 显示 Stash… | — | [使用方式](./stash-shelf) |
| 显示工作树 | — | [使用方式](./worktrees) |
| 显示历史 | — | [使用方式](./history) |
| 压缩提交… | — | [使用方式](./rewrite) |
| 合并到所选提交（Squash）… | — | [使用方式](./rewrite) |
| 暂存 | — | [使用方式](./commit) |
| 取消暂存 | — | [使用方式](./commit) |
| Stash… | — | [使用方式](./stash-shelf) |
| 更新子模块 | — | [使用方式](./worktrees) |
| 撤销提交 | — | [使用方式](./rewrite) |
| 撤销最近一次历史改写 | — | [使用方式](./rewrite) |
| 在 Worktree 中打开 Ref | — | [使用方式](./worktrees) |
| 与上游同步 Fork… | — | [使用方式](./sync) |
| 设置… | `Ctrl+,` | [使用方式](./settings) |
| 启用版本控制集成… | — | [使用方式](./getting-started) |
| 显示提交工具窗 | `Alt+0` | [使用方式](./workspace) |
| 显示文件工具窗 | `Alt+1` | [使用方式](./workspace) |
| VCS 操作 | — | [使用方式](./workspace) |
| 在修订版浏览仓库 | `Ctrl+Shift+O` | [使用方式](./history) |
| 更新项目… | `Ctrl+T` | [使用方式](./sync) |

## 当前界面边界

普通本地文件 Diff 已提供逐块 Stage/Unstage/Rollback 按钮，支持范围及预览核对见差异教程。Changelist 的 HEAD→Local 差异支持按块归属，选择规则及限制见提交教程。专门的子模块注册、托管平台账号管理、PR Review 与 MR 工具也不属于当前界面。安装包与截图以 Windows 为准，存在其他平台快捷键定义不代表已有对应原生发行包。
