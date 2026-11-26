# QA-112 File键盘操作与可见选择目标一致性

日期：2026-11-26。开始前读取台账，fetch及master/交付分支快进检查成功；基线`69a5df3db72b627401eb15d7779bbe8ca8d6ee0f`包含master`e2e33d96e3bc0aed8c206fe22562ab9432c8d27a`。全程主线程。

## 受控确认

File树的selectedPath表示焦点，selectedPaths表示多选集合，两者可以正常不同：选a，Ctrl点b加入，再Ctrl点b取消后，a仍选中而b仍有焦点。原F2只检查选择数量为1，却把焦点行传给rename；真实组件/真实fileTree与workspace stores测试确认实际传入b.txt，目标与高亮选择不符。

鼠标右键已有“未选中目标先单选，已选中目标保留多选”的规则，Shift+F10/ContextMenu键没有复用。焦点未选中时，键盘菜单的单文件操作使用焦点，批量操作却使用另一个选择集合。

筛选/外部刷新仅裁剪selectedPaths，未同步维护焦点和Shift范围起点。外部移除焦点后，组件可能回退到首行；筛选隐藏焦点后，创建工具栏可能选择无关的首目录；清除筛选再Shift点选会把旧范围起点重新带回。首批8项旧实现6失败/2正常对照通过。实际磁盘操作在受控测试中被替换为spy，不能宣称已误改用户文件。

## 修改

- F2使用唯一选中行，空选择/多选择不重命名，保持长按和IME保护。
- 两种键盘菜单入口与鼠标右键共享目标选择规则：未选中的焦点行先单选，已选中行保留整个集合；随后菜单显示与执行基于同一目标。
- 行可见性变化时裁剪失效焦点和范围起点；若其他选择仍存，焦点转到剩余选择，否则清空。保留可见但未选中的焦点，不强制取消Ctrl点击的正常行为。
- 折叠前先记录焦点是否在子项中，使同步裁剪之后仍能正确选中父目录。未修改树的24px行高、虚拟化或Git操作后端。

## 验证边界

新增最终11项测试使用真实FileToolWindow/VirtualList与真实workspace/fileTree stores；覆盖Ctrl取消后的F2、两个键盘菜单入口、外部删除、筛选创建、旧Shift起点、现有多选菜单、空选择、两个折叠入口及初始无选择菜单。首轮相关5文件57项通过/2既有probe跳过（当时新增10项）；最终完整前端199文件2048项通过/4既有probe跳过，类型/Vite、Windows debug/no-bundle构建与相关Oxlint通过。Rust/绑定/依赖未变，本轮不重复完整Rust套件。

原生复查使用独立identifier `app.gitx.qa112`、独立profile与普通非Git文件夹，无CDP。程序SHA256为`C7D18B7C291B705E5FD6E10187D555A832EAE50D6564A4416F37442B844E8ED6`，2026-11-26T05:40:31.5369130Z启动；构建源码哈希清单与验收后文件一致。

- GUI点选a.txt、Shift+Down选中a/b后，从测试脚本把b移出目录。自动刷新后按F2，Rename默认值为a.txt；取消后将b恢复，原文件哈希一致。
- GUI筛选为first后，使用New File新建qa112-created.txt。真实文件位于alpha根，first子目录中不存在同名文件；编辑器正确打开空文件，任务回到Idle。
- 原生Ctrl取消选择和两种键盘菜单校正未逐项操作，其结论来自上述真实组件回归；没有把这些自动证据写成原生全量验收。

证据目录：`E:/IDEAproject/gitx/test-results/qa112-file-keyboard-target-20261126`，包括rename-ready.ui.json、selection-filtered.ui.json、create-submitted.ui.json、created-location.json、source-hashes.json与verification.json。GUI关闭后，7个记录进程身份全部退出；原3文件保持，创建的空文件随fixture保留，独立settings归档移除。个人settings SHA256保持`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`，用户安装版未更新。

提交前再次fetch及两分支快进检查成功，master仍e2e33d9、交付仍69a5df3，无新远端提交。QA112修复验收完成，当前回到原11项已知未关闭；提交推送结果见统一台账。
