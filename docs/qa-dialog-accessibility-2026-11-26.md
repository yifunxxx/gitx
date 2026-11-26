# QA-108 共享确认和输入窗口的键盘核对

日期：2026-11-26。开始前读取统一台账，fetch及主分支/交付分支快进检查成功；基线`79ad8ae8888c245082570e593c720c8668f5995a`包含master`e2e33d96e3bc0aed8c206fe22562ab9432c8d27a`（0.1.48）。本轮仅主线程。

## 问题与修改

大批量文件回收和移动等流程使用共享ConfirmDialog。消息已有256px滚动上限，原实现不会无限撑高；但消息没有显式键盘焦点入口，DialogHost的Tab循环只包含取消/确认按钮，键盘用户无法滚动核对清单末尾。共享确认/输入窗口未将标题关联为可访问名称，Prompt输入框也没有名称和帮助说明关联。

真实DialogHost/ConfirmDialog/PromptDialog加生产CSS的Chromium受控验证：1000个路径的内容高度16032px、视口256px，5次Tab只在Cancel/OK之间循环，End后scrollTop仍0；可访问树中的两个dialog和textbox名称均为空。新增4项组件回归全部失败。最初浏览器测试壳使用运行时模板，生产Vue无编译器导致入口未挂载；改为render函数后重新构建并得到上述正式结果，该测试壳失败不计作产品缺陷。

修复给确认消息增加可聚焦的命名区域和键盘焦点轮廓，利用浏览器原生滚动按键核对全部内容；Cancel显式保留初始焦点。以Vue useId生成每个实例独立的标题/说明关联，给两种窗口和Prompt输入框补齐名称，输入框在有说明时关联说明。保持原顺序、取消结果、输入选中、嵌套恢复以及IME/已处理/长按按键保护。

## 自动与浏览器验证

- 新增4项回归通过，相关DialogHost、Escape、Enter、Clone嵌套确认合计5文件72项通过。
- 完整前端195文件2015项通过，4个既有性能probe默认跳过；类型/Vite生产构建、相关Oxlint和文档检查通过，保留既有chunk大小提示。Rust、依赖、绑定未变。
- 同一浏览器测试修后：初始焦点Cancel，Tab经OK进入消息，End后scrollTop15776、达到清单末尾；Escape后焦点回到打开按钮。确认、Prompt窗口及文本框均可按名称找到，输入初始焦点和全选保持。
- 900×600视口下深浅主题分别验证Shift+Tab进入消息、End到末尾、鼠标滚轮向上、完整窗口及操作按钮不出视口；截图人工复核文字、焦点框与按钮可辨。没有将浏览器CSS检查当作屏幕阅读器朗读或Windows原生交互实测。

证据目录为`E:/IDEAproject/gitx/test-results/qa108-dialog-accessibility-20261126`，包含before/after/after-final.json、tests-before/after/full-test.log、浏览器截图和测试壳源文件；临时测试壳已归档并从项目目录移除，不进入产品提交。源文件/dist清单及产品补丁已保存。

## 原生与交付

Windows独立profile构建通过（2分32秒），identifier为app.gitx.qa108，程序SHA256为`7C736EFF116D001B56EB68CDE4B1AF4D924DA952E3F64C9F7AA1EA557151FD32`。使用QA104的2000文件目录加README和独立settings/WebView profile，完成以下原生检查：

1. 从首文件到README范围多选，Delete仅打开回收确认。清单记录含2000个唯一文件路径及README，标题和命名区域出现在Windows无障碍树；初始Cancel有清晰焦点框。
2. Shift+Tab进入清单，End滚到file-1999和README，Home回到说明及file-0000；焦点框、窗口标题和操作按钮始终可见。Escape取消后File新建按钮恢复、状态Idle；没有执行回收或其他磁盘变更。
3. 切换深色，原多选右键Copy To输入框正常打开，无障碍树分别将窗口和输入框命名为Copy To；输入具有初始焦点，说明/文字可见。点击Cancel恢复，未提交复制。

原生截图/文本为native-confirm-start、native-confirm-end、native-prompt-dark和native-cancel-recovered。深浅主题完整最小窗口几何及鼠标滚轮由浏览器测试覆盖；原生为上述具体路径，不声称运行了屏幕阅读器或物理IME。

7个记录PID/启动时间的进程正常退出；2001个原文件、HEAD、index tree及status保持，用户settings SHA256保持`1CE741747AEA8FBDDEB9542177A5B86028C7854F0B9B20EDC3D7B7A8D919A910`。测试settings归档移除，用户安装版未替换。

提交前fetch及两分支快进检查成功，master仍e2e33d9、交付仍79ad8ae，无新增提交需要整合。新增并解决QA108，回到11项已知未关闭。本项属于QA009的具体交互缺陷，不将共享窗口修复等同于全部UI控件验收，也不关闭持续滚轮或长期资源边界。提交和推送状态以统一台账为准。
