# Appendix — Traceability（#→章节→里程碑）

> 返回索引：[../dev-plan.md](../dev-plan.md)。编号 = feature doc Appendix A 顺序编号（A.1–A.15 连续计数）。本表由各章节标题与「里程碑」行生成，覆盖全部在范围条目：#1–10、#12–124（共 123 条）。
> Deferred（不在本计划实现）：#11、#125–136（GitHub 插件体验）、#137–141（非核心/姊妹能力）。

| # | 条目 | Appendix A 分组 | 章节 | 里程碑 | 备注 |
|---|---|---|---|---|---|
| 1 | `Git.Clone` — Clone Repository | A.1 Setup/Clone/Init | [02-setup-remotes.md](./02-setup-remotes.md) | M2 |  |
| 2 | Shallow clone + `Git.Unshallow` | A.1 Setup/Clone/Init | [02-setup-remotes.md](./02-setup-remotes.md) | M2 |  |
| 3 | Welcome / New Project from Version Control | A.1 Setup/Clone/Init | [02-setup-remotes.md](./02-setup-remotes.md) | M1（Clone 入口 M2 接入） |  |
| 4 | `Start.Use.Vcs` / Enable Version Control Integration | A.1 Setup/Clone/Init | [02-setup-remotes.md](./02-setup-remotes.md) | M1 |  |
| 5 | `Git.Init` — Create Git Repository（multi-root） | A.1 Setup/Clone/Init | [02-setup-remotes.md](./02-setup-remotes.md) | M1 |  |
| 6 | `Git.Add` — Add to VCS | A.1 Setup/Clone/Init | [02-setup-remotes.md](./02-setup-remotes.md) | M1 |  |
| 7 | Auto-add on create（Confirmation） | A.1 Setup/Clone/Init | [02-setup-remotes.md](./02-setup-remotes.md) | M6 |  |
| 8 | Force-add ignored files | A.1 Setup/Clone/Init | [02-setup-remotes.md](./02-setup-remotes.md) | M6 |  |
| 9 | Git executable path + Test（+ WSL） | A.1 Setup/Clone/Init | [02-setup-remotes.md](./02-setup-remotes.md) | M0（WSL 支持 M7） |  |
| 10 | Share project settings via VCS prompt | A.1 Setup/Clone/Init | [02-setup-remotes.md](./02-setup-remotes.md) | M8 | gitx 适配为 .gitx/settings.json |
| 12 | `Git.Configure.Remotes` — Manage Remotes | A.2 Remotes/Auth | [02-setup-remotes.md](./02-setup-remotes.md) | M2 |  |
| 13 | Define remote（Push dialog） | A.2 Remotes/Auth | [02-setup-remotes.md](./02-setup-remotes.md) | M2 |  |
| 14 | Edit / Remove Remote（Branches pane） | A.2 Remotes/Auth | [02-setup-remotes.md](./02-setup-remotes.md) | M2 |  |
| 15 | Fetch on add remote | A.2 Remotes/Auth | [02-setup-remotes.md](./02-setup-remotes.md) | M2 |  |
| 16 | Password policy / credential helper | A.2 Remotes/Auth | [02-setup-remotes.md](./02-setup-remotes.md) | M2 |  |
| 17 | `Github.Sync.Fork`（通用部分） | A.2 Remotes/Auth | [02-setup-remotes.md](./02-setup-remotes.md) | M7 | 仅通用部分；与 #136 重叠，待确认 |
| 18 | VCS Widget（incoming / outgoing） | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2（M1 先实现只读分支名） |  |
| 19 | `Git.Branches` / Show Branches（Popup + pane） | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2 |  |
| 20 | New Branch（current / selected / commit） | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2（Log 入口随 M3） |  |
| 21 | Checkout / Checkout and Update | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2 |  |
| 22 | Force vs Smart Checkout | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M4 |  |
| 23 | Rename local branch + unset upstream | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2 |  |
| 24 | Favorite branches | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2 |  |
| 25 | Group by Directory / Recent / Tags nodes | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2 |  |
| 26 | Compare with Current | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M3 |  |
| 27 | Diff with Working Tree | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M3 |  |
| 28 | Two-dot range filter in Log | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M3 |  |
| 29 | Delete branch（+ restore notification） | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2 |  |
| 30 | Update selected branch | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2 |  |
| 31 | `Git.Cleanup.Branches` | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M3 |  |
| 32 | `Git.FindMergedLocalBranches` | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M3 |  |
| 33 | Execute branch operations on all roots | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M7 |  |
| 34 | Restore workspace on branch switch | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M8 |  |
| 35 | Copy branch name | A.3 Branches | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2 |  |
| 36 | `Git.CreateNewTag` / New Tag（annotated） | A.4 Tags | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2 |  |
| 37 | Tag from Log | A.4 Tags | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M3 |  |
| 38 | Checkout / Jump to tag | A.4 Tags | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M3 |  |
| 39 | Reassign tag | A.4 Tags | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M3 |  |
| 40 | `Git.Tag.Push` / Push tags in Push dialog | A.4 Tags | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2 |  |
| 41 | Delete tag | A.4 Tags | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2 |  |
| 42 | Fetch tags policy（settings） | A.4 Tags | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M2 |  |
| 43 | `Git.Show.WorkingTrees` / Worktrees tab | A.5 Worktrees | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M7 |  |
| 44 | `Git.CreateNewWorkingTree` | A.5 Worktrees | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M7 |  |
| 45 | Open / Remove / Refresh / Prune / Lock | A.5 Worktrees | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M7 |  |
| 46 | Open Review / Open PR in Worktree（通用部分） | A.5 Worktrees | [03-branches-tags-worktrees.md](./03-branches-tags-worktrees.md) | M7 | 仅通用部分；与 #134 重叠，待确认 |
| 47 | Commit tool window（`Alt+0`） | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M1 |  |
| 48 | Default Changes + Unversioned lists | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M1 |  |
| 49 | Show Ignored Files | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M6 |  |
| 50 | New / Rename / Remove / Set Active changelist | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M6 |  |
| 51 | Move to Another Changelist（`Alt+Shift+M`） | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M6 |  |
| 52 | Per-hunk / per-line changelists | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M6 |  |
| 53 | Changelist conflict dialog + settings | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M6 |  |
| 54 | File status colors + directory highlight | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M1（设置页 M8） |  |
| 55 | Editor gutter markers + line rollback / diff | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M6 |  |
| 56 | Enable staging area mode | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M1（staging 先行）/ M6（双模式切换） |  |
| 57 | `Git.Stage.*`（add / reset / revert / compare / three-way / conflicts） | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M1（文件/块级）· M6（行级） |  |
| 58 | Delete versioned file → commit removal | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M1 |  |
| 59 | Stop tracking（workaround → 显式动作） | A.6 Local Changes | [04-changes-commit-push.md](./04-changes-commit-push.md) | M6 | gitx 提供显式动作 |
| 60 | Commit（`Ctrl+K`） | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M1 |  |
| 61 | Amend | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M1（早期 commit amend M5） |  |
| 62 | Commit message history / template / reformat | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M2 |  |
| 63 | Author / Sign-off / GPG sign | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M2 |  |
| 64 | Run Git hooks toggle | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M1（PATH 修正属 M0） |  |
| 65 | Commit Checks / Advanced Checks / After Commit upload（通用部分） | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M8 | 仅语言无关检查；#140/#141 deferred |
| 66 | Partial commit（chunks / lines） | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M6 |  |
| 67 | Commit from gutter | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M6 |  |
| 68 | Commit and Push（`Ctrl+Alt+K`） | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M2 |  |
| 69 | Commit TW view modes / toggle controls（modal 除外） | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M7 | 不含 Modal（#139 deferred） |
| 70 | Push dialog（`Ctrl+Shift+K`） | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M2 |  |
| 71 | Push All up to Here / Push Selected Commits | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M3 |  |
| 72 | Force push（with lease）+ protected branches | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M2 |  |
| 73 | Push Rejected → merge / rebase | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M2（冲突衔接 M4） |  |
| 74 | Push tags（All / Current Branch） | A.7 Commit/Push | [04-changes-commit-push.md](./04-changes-commit-push.md) | M2 |  |
| 75 | `Git.Fetch`（+ auto fetch + widget button） | A.8 Fetch/Pull/Update | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M2 |  |
| 76 | Incoming changes check | A.8 Fetch/Pull/Update | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M2 |  |
| 77 | `Git.Pull` + modify options | A.8 Fetch/Pull/Update | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M2 |  |
| 78 | `Vcs.UpdateProject`（`Ctrl+T`） | A.8 Fetch/Pull/Update | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M2 |  |
| 79 | Update strategies: Merge / Rebase / Reset to Remote | A.8 Fetch/Pull/Update | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M2 |  |
| 80 | Update Info tab | A.8 Fetch/Pull/Update | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M2 |  |
| 81 | Submodule update behavior | A.8 Fetch/Pull/Update | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M7 | 仅 update 行为；#11 deferred |
| 82 | `Git.Merge` + options + Abort / Commit | A.9 Merge/Rebase/Cherry-pick | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M4 |  |
| 83 | Smart merge | A.9 Merge/Rebase/Cherry-pick | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M4 |  |
| 84 | `Git.Rebase` + options | A.9 Merge/Rebase/Cherry-pick | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M4 |  |
| 85 | Branch popup rebase variants | A.9 Merge/Rebase/Cherry-pick | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M4 |  |
| 86 | Interactive rebase（Pick / Edit / Reword / Squash / Fixup / Drop） | A.9 Merge/Rebase/Cherry-pick | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M5 |  |
| 87 | Rebase Abort / Continue / Skip | A.9 Merge/Rebase/Cherry-pick | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M4 |  |
| 88 | Cherry-pick + Abort / Continue | A.9 Merge/Rebase/Cherry-pick | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M4 |  |
| 89 | Cherry-pick suffix for protected | A.9 Merge/Rebase/Cherry-pick | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M4 |  |
| 90 | Highlight cherry-picked commits | A.9 Merge/Rebase/Cherry-pick | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M3 |  |
| 91 | Apply / Get file from revision | A.9 Merge/Rebase/Cherry-pick | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M3 |  |
| 92 | Extract / Drop selected changes | A.9 Merge/Rebase/Cherry-pick | [05-sync-merge-rebase.md](./05-sync-merge-rebase.md) | M5 |  |
| 93 | Conflicts dialog（Yours / Theirs / Manual） | A.10 Conflicts/Diff/Patch | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M4 |  |
| 94 | Three-way merge editor | A.10 Conflicts/Diff/Patch | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M4 |  |
| 95 | Abort Merge / Resolve Conflicts actions | A.10 Conflicts/Diff/Patch | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M4 |  |
| 96 | CRLF warning | A.10 Conflicts/Diff/Patch | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M2 |  |
| 97 | Diff Viewer（side-by-side / unified / ignore rules） | A.10 Conflicts/Diff/Patch | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M1（基础双栏/unified、hunk stage）· M3（全部选项） |  |
| 98 | Combined Diff | A.10 Conflicts/Diff/Patch | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M3 |  |
| 99 | Compare with Revision / Branch or Tag | A.10 Conflicts/Diff/Patch | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M3 |  |
| 100 | Compare two commits | A.10 Conflicts/Diff/Patch | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M3 |  |
| 101 | Create / Apply Patch（+ clipboard, reverse） | A.10 Conflicts/Diff/Patch | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M6 |  |
| 102 | Log tab panes + filters + graph options | A.11 Log/History | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M1（基础：commits+graph+details+changed files）· M3（完整过滤/选项/右键） |  |
| 103 | Git Log Indexing | A.11 Log/History | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M3 |  |
| 104 | File / Folder / Selection History | A.11 Log/History | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M3 |  |
| 105 | Annotate with Git Blame + options | A.11 Log/History | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M3 |  |
| 106 | Code author Code Vision | A.11 Log/History | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M6 |  |
| 107 | Show Repository at Revision（含 #110 BrowseRepoAtRevision） | A.11 Log/History | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M3 | 与 #110 同一实现 |
| 108 | Reword / Squash / Drop / Fixup / Squash Into | A.11 Log/History | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M5 |  |
| 109 | Undo Commit / Revert Commit / Reset（Soft / Mixed / Hard / Keep） | A.11 Log/History | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M5 |  |
| 110 | BrowseRepoAtRevision | A.11 Log/History | [06-conflicts-diff-history.md](./06-conflicts-diff-history.md) | M3 | 见 #107 |
| 111 | Shelve / Unshelve / Restore / Import patches | A.12 Stash/Shelve/Ignore | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M6 |  |
| 112 | Stash / Apply / Pop / Drop / Clear / Unstash as branch | A.12 Stash/Shelve/Ignore | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M6（smart 操作内部使用的 stash 在 M4 已具备） |  |
| 113 | Combine Stashes and Shelves tab | A.12 Stash/Shelve/Ignore | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M6 |  |
| 114 | Clean working tree using Stash \| Shelve | A.12 Stash/Shelve/Ignore | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M4（Stash 方式）· M6（Shelve 方式） |  |
| 115 | Add to .gitignore / exclude | A.12 Stash/Shelve/Ignore | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M6 |  |
| 116 | Open exclude file | A.12 Stash/Shelve/Ignore | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M6 |  |
| 117 | Settings \| Git（full page） | A.13 Settings/Chrome | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M8（各项随对应功能里程碑上线，M8 统一完善与搜索） |  |
| 118 | Confirmation / Changelists / Ignored / File Status Colors | A.13 Settings/Chrome | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M8 |  |
| 119 | Diff & Merge / Advanced VCS settings | A.13 Settings/Chrome | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M8（Diff 基础选项随 M3） |  |
| 120 | VCS Operations Popup（`` Alt+` ``） | A.13 Settings/Chrome | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M2（M0 框架） |  |
| 121 | Git main menu groups | A.13 Settings/Chrome | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M1（随功能逐步填充） |  |
| 122 | Main toolbar Git quick actions | A.13 Settings/Chrome | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M1 |  |
| 123 | Console tab | A.13 Settings/Chrome | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M1（M0 已有底层日志） |  |
| 124 | Keymap customization | A.13 Settings/Chrome | [07-stash-ignore-settings-chrome.md](./07-stash-ignore-settings-chrome.md) | M8（M0 先实现 registry + 默认 keymap） |  |

## Deferred 条目（不在本计划）

| # | 条目 | 说明 |
|---|---|---|
| 11 | Submodule clone/register | 以后再说；#1 预留扩展点，#81 只做 update 行为 |
| 125–136 | GitHub 插件体验（accounts、Clone via GitHub、Share、Open/Copy link、Gist、Create PR、PR TW、Review、Merge PR、Checkout PR/Worktree、Protection rules、Sync Fork） | 以后再说；#17/#46/#72 中只做托管无关部分 |
| 137–141 | GitLab MR、Features Trainer、Modal Commit、Deployment after commit、Language-specific commit checks | 明确非核心 |
