# QA-042：弹窗 Escape 输入边界

日期：2026-11-20。接续QA-041独立审阅；本项处理Confirm、Prompt、Credential和DialogHost的Escape，不与Enter行为混为同一交付。

## 复现及影响

此前组件自身的`@keydown.esc`直接关闭弹窗，DialogHost到达时才过滤组合输入或已处理事件，无法挽回已丢弃的草稿。真实DialogHost栈与Confirm/Credential组件的首批9项回归在修改前7失败、2通过：两组件的isComposing、keyCode229、defaultPrevented均提前取消；Host本身也缺少229判断。

扩展Prompt和长按测试后，共20项，在第一阶段修复上11失败、9通过。Prompt四类事件均误关，Confirm/Credential/Host的repeat也误关。四种真实父层分别验证：子Confirm被第一次普通Escape关闭、焦点回到父层后，操作系统后续repeat事件仍继续关闭父层。该路径可直接丢弃凭据或名称草稿。

修改前证据：`E:/IDEAproject/gitx/test-results/qa042-dialog-escape-before-20261120.log`和`qa042-prompt-repeat-before-20261120.log`。以上为真实组件事件回归；没有声称已原生复现输入法候选框或物理长按。

## 修改

Confirm、Prompt、Credential新增Escape处理函数，忽略已处理、组合输入、229和重复事件；有效事件才preventDefault、stopPropagation并取消。Confirm保留false，其余保留null。DialogHost补齐229/repeat，保留固定dialogId校验，避免同一事件连关父层。

忽略事件不新增preventDefault，保留输入法默认处理。未引入capture监听或stopImmediatePropagation，也没有新全局监听和清理负担。App快捷键入口与Clone文档兜底已检查同类过滤，不为理论上的传播风险扩大改动。

## 验证与交付

新增20项真实栈测试，包含三类组件及Host的四种忽略事件、草稿保留、正常取消返回值、只关子层和四种父层的repeat保护。定向5文件47项、类型检查、相关Oxlint和diff-check通过；独立审阅无阻塞项。日志为`qa042-prompt-repeat-{targeted,typecheck,lint}-20261120.log`，与上述证据同目录。

完整前端142文件/1268项、类型检查及Vite生产构建通过，日志`qa042-final-tests-20261120.log`和`qa042-final-web-20261120.log`。已有chunk体积/动态导入警告保留。本项没有Rust改动，没有重复计算此前490项回归。

随本次独立提交推送，随后补记完整SHA及远端核对。原生输入法/长按尚未验证，用户安装版未更新；原生构建和界面基础路径将在后续Enter修复完成后对同一最终版本补验。Enter另登记QA-043，已真实组件复现，下一步独立修复。
