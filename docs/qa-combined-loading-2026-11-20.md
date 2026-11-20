# QA061 Combined Diff等待反馈与防重复

开始前重新fetch成功，HEAD及origin/codex/checkout-target-safety均为dee2722821d992fa7c611d50c1d3b2da586c5b29，包含origin/master efc2a8afe17af6f4c937c8c95c8f7e58dc834b0a。上一项QA060已独立提交推送，无网络或认证阻塞。

来源为QA060原生操作和调用链检查：计算Combined时按钮不显示等待、不禁用，store仅隔离旧结果，没有阻止重复请求。真实Pinia和组件回归在旧实现下6失败/13通过，包括连续点击两次调用后端两次、比较修订未加载完按钮仍可用。证据qa061-before-20261120.log。

新增每标签combinedLoading状态，开始请求立即置位，成功/失败且仍属于原代次时清除；刷新或交换左右版本使旧请求失效并重置等待，旧finally不干扰新请求。按钮加载时禁用并显示转圈，内容区显示有status角色的Loading combined diff…；初始比较加载期间也禁用。刷新/交换/关闭仍可操作，现有代次保护保留。

最初定向19项通过。另补不同标签独立加载，以及仓库切换、同路径重开、仓库身份变化和store释放的失败隔离回归，共新增11项；最终完整前端、构建、原生验证结果随后补记。取消后台计算未在此项新增，不将防重复写成后端取消。

原生fixture为test-results/repos/combined-loading-20261120，无remote，50个文件两次提交。基线、设置备份和验证证据在test-results/qa061-native-20261120。

最终完整前端154文件/1486项、类型检查、Vite生产构建、相关Oxlint和Windows原生构建通过；日志qa061-ui-final-20261120.log、qa061-build-20261120.log、qa061-native-build-20261120.log。本项仅前端产品变更，不重复整套Rust回归。

修复版原生：Show All Changes正常打开；点击Show Combined Diff后两次均观察到转圈、disabled按钮及Loading combined diff…，结束后恢复可用且显示正确差异。期间Refresh正常恢复，再次计算成功。截图与UIA存在不同采样时点，原生没有精确证明刷新点击瞬间旧计算尚未结束，因此旧finally与新请求并发隔离仍以自动回归为证据。旧程序对照截图在计算中没有反馈，但同次UIA已采到完成内容，不当作时长或并发请求证据。new-pending.txt/new-refresh.txt/new-completed.txt保存UIA；防重复后端调用计数来自真实store/组件回归。

最终二进制SHA256为AA337B59BFA37127EE0EE50C3FEE5EC4167DC32B4AC16FCE076037D6CDA7B91A，源码身份见new-build.json。两个测试主进程2536/5104已退出；50文件SHA256、HEAD、index tree和clean status一致，设置精确恢复备份，见cleanup.json。用户安装版未替换。提交前fetch成功，远端master efc2a8a和交付分支dee2722均已包含；提交推送随后补记。

9ae5fdfb413bb89168278a3ca29924fa9d1ed803已推送并经ls-remote核对一致，首次成功且无凭据提示。
