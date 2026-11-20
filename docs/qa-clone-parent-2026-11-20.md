# QA-065 克隆父目录和仓库文件夹

用户截图中 URL 为 diss.git，浏览选择 E:/IDEAproject 后收到父目录非空错误。CloneDialog 把目录选择结果直接传给 cloneRun 的最终目标参数，与用户期望的父目录语义不符。

- 分开父目录和仓库文件夹两个字段；浏览与手输均选择父目录，实时显示最终克隆路径。
- 从 HTTPS/SSH/SCP/本地路径推断文件夹，移除 .git、URL 查询与片段，支持编码中文；自定义名字不被 URL 更改覆盖。
- 子目录限制为单个合法名字，拒绝路径穿越和 Windows 保留名称。后端原有目标非空保护继续有效。
- 默认深度仍为 null（完整克隆），克隆成功后打开后端返回的新子目录。
- 延迟到达的 homeDir 不覆盖用户已选择的父目录；保留已有取消、防重和凭据重试生命周期。

开始与提交前 fetch 成功，HEAD 8ed80c9 包含 origin/master efc2a8a 与远端交付分支。

验证：4 文件 57 项前端定向通过（包括真实原生目录选择接口的 mock、取消和 Escape），类型与 Vite 构建通过。已有真实 Git 浅克隆测试 1 项通过。原生界面将在主题返工组合程序中复核；用户安装版尚未更新，未对用户截图的实际仓库执行克隆。

本功能独立提交推送；完整 SHA 和远端核对结果在后续台账补记。

2026-11-20 原生补验：b507cef + 主题返工的专用程序从本地 diss.git 完整克隆到已含 keep-existing.txt 的父目录。GUI 创建 diss 子目录并自动打开；磁盘核实 HEAD 为75c64ae7bd4ad0bbd87b22114e3b74e129c76f2d，4个跟踪文件完整，工作区干净，is-shallow-repository=false；父目录已有文件SHA256仍为DD5F9CB45CA607E4C0C066EC7EB1C4E1CD9DF271F4848A5D39782AFD6D73E5D8。证据目录qa062-064-native-20261120，fixture为clone-parent-glass-20261120/diss。本功能b507cef0a950ac5f871db6e401311d2e2951c516已推送且远端核对一致；后续仅补控制字符正则的lint说明，无行为变化。用户安装版未替换，线上diss未实际克隆。
