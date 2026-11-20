# QA057/058 紧凑选择器与同窗提交原生验收

2026-11-20使用产品提交`1bb5595c6269642fdfd1699bc8d67ef144285fe9`构建的0.1.42专用程序完成验收，包含QA058索引保护提交`50266e70d00dc38ec588749a2df3dae5c9b43a9f`。

- 程序：`E:/IDEAproject/gitx/test-results/isolated-target/debug/gitx-compact-commit-0142-20261120.exe`。
- SHA256：`D527D7816B8F053CEE5B069C369C938AD7FD32964F790509F65EABB73F208BD8`。
- 独立测试仓库：`E:/IDEAproject/gitx/test-results/repos/tree-actions-compact-20261120`，无远端。
- 证据目录：`E:/IDEAproject/gitx/test-results/qa057-native-20261120/`，含binary.json、process.json、Git前后记录、原生控件文本和cleanup.json。

原生多选b.txt/c.txt后从Commit Files进入同一弹窗，提交说明、多选文件和Commit按钮同时可见。列表行高24px；切树后src/nested层级与文件行同样紧凑，M在每行右端。取消b后数量为1/2，两个祖先目录显示半选，仅c仍勾选。输入`QA compact dialog commit`，在搜索框按Enter没有隐式提交。

明确点击Commit后显示Committing selected files等待，选择、输入及按钮禁用。测试pre-commit先等待1秒再拒绝，错误显示在原窗，说明与c的选择保留。提交前和拒绝后的HEAD均为`993b4c7c3cc144053c6f983c1373685b7cd273e2`，index SHA256均为`0415F5054026E0C07866BFEF1595AB067800FE911B273257BFC9C7D5593A510D`，索引条目完全一致，无遗留index.lock。

移除独立测试仓库的qa-reject标记后，在原窗口再次点击Commit成功，弹窗关闭、Log出现新提交、Changes由4变为3。实际新提交`5c4508ba13981a7f292be00951f8cb5df3f97b78`仅包含`src/nested/c.txt`；docs/readme.txt仍为MM，其索引内容`staged readme`与工作区`current readme`分别保留；src/a.txt与src/nested/b.txt仍为未暂存修改。四个工作区文件SHA256与启动前逐一一致，左侧提交说明仍为空。测试提交保留供复核，不能把HEAD描述为未改变。

随后打开Stash，列表与树模式都使用相同24px紧凑行及行末状态；切换后仍只选中b，目录半选正确，Cancel退出且未执行Stash。这是本次共享布局代表入口原生验证；Move/Rollback/Shelf的新布局以共享组件及自动回归为证据，不写成三者全部再次原生执行。

18:25完成清理：专用窗口关闭，记录到的主进程10608与子进程31352均已退出。用户安装程序同时运行，本次未将共享或未记录的WebView进程归入专用进程退出结论，也未操作用户安装窗口。设置逐字段检查仅包含本次预备的recentWorkspaces变化，恢复备份后SHA256为`6DD5D73EAD1F19D1860AE9B143659A0753756E82DFF7B5F5FCCB588693F05335`。D:/gitx/gitx.exe仍为0.1.41，本次未更新安装版。

产品提交推送遇到443超时/SSL连接重置后重试成功；独立ls-remote确认交付分支为1bb5595完整SHA，随后fetch成功，master仍为efc2a8a且包含于本地HEAD。QA057/058在上述范围关闭；磁盘发布失败、断电、物理IME及持续性能边界未由本次原生流程覆盖。
