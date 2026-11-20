# QA058 按文件提交失败保留暂存区

2026-11-20 为QA057接入弹窗直接提交时，检查到旧commit_create_ex(paths)先git add真实索引，而且忽略add失败。真实Git回归重现：选中文件已有部分暂存、又有工作区修改及新增文件，pre-commit拒绝后原索引被改写。修改前四项中1项失败、3项对照通过，日志qa058-before-20261120.log。

按文件提交现在先持有真实index.lock，将索引复制到独立临时文件，所有add及commit --only通过GIT_INDEX_FILE执行。失败或取消不发布索引；成功后原子替换真实索引，保留未选文件的暂存内容。add失败立即返回，字面路径避免方括号等被当作通配。临时文件和锁由作用域清理；发布失败保留可恢复索引并返回提交已成功的警告，不继续自动恢复Smart状态。

新增7项真实Git回归通过，覆盖钩子拒绝、取消钩子、已有外部index.lock、首次提交、缺失候选导致add失败、字面文件名和split index、选中文件成功及其他文件的部分暂存保留。M6、Worktree及Smart合并恢复定向通过；完整gitx-git 49个目标、392项通过、7项辅助ignored、0失败；Windows custom-protocol构建通过，日志qa058-git-full-20261120.log与qa057-native-build-20261120.log。日志qa058-after-20261120.log、qa058-boundaries-20261120.log均位于E:/IDEAproject/gitx/test-results。

最终原生QA057弹窗补验通过：真实钩子拒绝后HEAD及index SHA256与提交前完全一致，无遗留index.lock；原窗重试仅提交所选c.txt，未选readme暂存版本仍为staged readme，工作区仍为current readme。四个工作区文件SHA256保持，见[原生记录](qa-compact-commit-native-2026-11-20.md)。

此修复在已同步master efc2a8a和交付2519c34的基线上实施，提交前再次fetch核对。独立提交50266e70d00dc38ec588749a2df3dae5c9b43a9f已随1bb5595推送，ls-remote核对远端完整SHA一致。首次443超时及后续SSL重置重试成功，无凭据失败。用户安装版未替换。尚未模拟磁盘发布失败和崩溃断电，不将正常回归当作这些故障的实证。
