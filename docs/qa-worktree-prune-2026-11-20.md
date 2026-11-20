# QA-049 Worktree 清理等待与导航保护

## 基线与发现

2026-11-20 开始前成功 fetch，`44c7627236fb24d65e17f6a224c717cb2bc76f08` 与远端交付分支相同，已包含远端 master `15413310ea91c5e20ef8d436ef72785f901e1a9c`。没有恢复此前丢弃的 watcher 实验。

Worktree 清理仅在最终写入时使用共享 busy：预览和确认期间按钮仍可再次提交，也允许其他 Worktree 写入。保护只比较路径变化代次，同路径重开、导航已开始但路径尚未更新时，旧确认仍会执行清理。后续列表刷新也会在相同边界回填旧列表或错误。

## 修改

- 以仓库路径记录普通写入/清理状态，清理占用完整的预览、确认、执行和刷新周期；同仓库防重复，其他仓库的操作不会被旧请求释放。
- 预览、确认及写入完成后核验原路径、仓库代次和导航令牌。取消、空预览及过期确认均不执行清理；已经启动的写入可以完成，但不回填旧界面。
- 列表刷新同样固定路径和导航身份；旧结果/错误不发布，仍释放属于自身的 loading。
- 清理按钮增加旋转图标、aria-busy 和可访问等待文字；现有其他操作使用同一 busy 禁用，取消/失败后恢复。
- 写入成功后的列表刷新失败单独展示错误，不把已完成的清理报为失败，也不重复写入。

## 验证

证据目录：`E:/IDEAproject/gitx/test-results/qa-worktree-prune-20261120/`。

最终17项测试对旧 store/view 的隔离加载为 **12失败/5通过**（`prune-final-before-17.log`，12:52:36）；修复后 **17项全部通过，相关3文件/55项通过**（`prune-final-after-55.log`，12:53:42）。旧实现由 `git show HEAD` 导出并通过 Vite pre-transform 加载，未交换活动源码。包括真实 Pinia/workspaceStore 与 WorktreesView 按钮检查，以及延迟预览、确认、写入、列表请求的导航边界。

类型检查、Vite生产构建、修改文件Oxlint和diff检查通过。构建仍有原有的大chunk提示。初次构建在最后两项refresh保护前执行；最终组合148文件/1399项、类型检查、Vite和Windows原生构建全部通过，覆盖最终refresh保护。组合日志为 `E:/IDEAproject/gitx/test-results/qa049-050-final-{tests,web,native}-20261120.log`。`prune-before-with-view.log` 实际是中途修后结果，不作旧基线。

独立审阅未发现阻塞问题，并指出后续refresh边界；该边界已由两项失败测试复现并修复。

## 验收与交付边界

代码与自动回归已完成；最终0.1.41组合程序完成原生GUI预览、等待、取消与重试复查。专用仓库 `E:/IDEAproject/gitx/test-results/repos/prune-lifetime-20261120` 的测试指针临时指向不存在位置，确认框列出预期的失效worktree；此时Prune显示spinner，New Worktree、Open Ref、Prune、Refresh Status均禁用。点击Cancel恢复按钮；再次打开后Escape也恢复，列表条目保持。没有确认实际清理，跨导航及写入失败仍以自动回归为证据。

原生证据在 `E:/IDEAproject/gitx/test-results/qa049-050-native-20261120/`。程序 `gitx-wait-actions-0141-20261120.exe` 的SHA256为 `9BB5065B7C02E3F77C0E04ECC70203CA00183E47395D37E0278D6D21D4E8DEC4`，源码身份为a8e0b7f加当时未提交QA-050。`prune-confirm.txt`、`prune-cancel.txt`、`prune-retry.txt` 和 `prune-escape-settled.txt`记录原生状态；Escape紧接的首次UIA仍是旧树，随后刷新及截图确认已关闭，不将缓存延迟记为产品缺陷。

测试主进程30872已退出，未逐一追踪子进程。fixture的HEAD、refs、status、index、两个readme及临时gitdir指针哈希与测试前一致；随后恢复原worktree指针并移除本次专用gc配置，两个worktree均正常列出。设置仅recentWorkspaces变化（加入本次仓库并触发20项截断），核对后按字节恢复，SHA256为 `6DD5D73EAD1F19D1860AE9B143659A0753756E82DFF7B5F5FCCB588693F05335`。记录见fixture-after/restored和restoration.json。用户安装路径 `D:/gitx/gitx.exe` 仍为0.1.41（08:26:54修改），本轮未替换，不能认为包含本分支修复。

总体七项目标仍在进行；本项不代表全局滚动性能问题已经解决。

提交前再次fetch：期间443超时/SSL连接重置，重试后成功，远端master与交付分支仍为上述SHA，均已包含于HEAD；无新提交需要整合。

功能提交 `a8e0b7faa5c613b1fb8d117f8a7df90c91b266a3` 已推送：首次443连接超时，第二次成功；独立 `ls-remote` 核对完整SHA一致，未触发凭据提示。
