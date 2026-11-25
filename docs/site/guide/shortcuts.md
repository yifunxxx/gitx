# 快捷键速查

下表从动作注册中的默认绑定生成。Windows/Linux 的 Mod 为 Ctrl，macOS 按定义使用 Cmd；快捷键定义不代表每个平台都已提供安装包。自定义 Keymap 会覆盖默认键。

| 动作 | Windows | macOS |
| --- | --- | --- |
| [提交](./commit) | `Ctrl+K` | `Cmd+K` |
| [显示 Diff](./diff) | `Ctrl+D` | `Cmd+D` |
| [在文件中查找…](./search) | `Ctrl+Shift+F` | `Cmd+Shift+F` |
| [跳转到文件…](./search) | `Ctrl+P` | `Cmd+P` |
| [打开…](./getting-started) | `Ctrl+O` | `Cmd+O` |
| [保存](./files) | `Ctrl+S` | `Cmd+S` |
| [添加到版本控制](./commit) | `Ctrl+Alt+A` | `Cmd+Option+A` |
| [提交并推送…](./commit) | `Ctrl+Alt+K` | `Cmd+Option+K` |
| [Push…](./sync) | `Ctrl+Shift+K` | `Cmd+Shift+K` |
| [刷新状态](./workspace) | `Ctrl+R` | `Cmd+R` |
| [编辑提交说明…](./rewrite) | `F2` | `F2` |
| [设置…](./settings) | `Ctrl+,` | `Cmd+,` |
| [显示提交工具窗](./workspace) | `Alt+0` | `Option+0` |
| [显示文件工具窗](./workspace) | `Alt+1` | `Option+1` |
| [在修订版浏览仓库](./history) | `Ctrl+Shift+O` | `Cmd+Shift+O` |
| [更新项目…](./sync) | `Ctrl+T` | `Cmd+T` |

## 固定与上下文按键

| 位置 | 按键 | 用途 |
| --- | --- | --- |
| 全局 | Ctrl+Shift+A / Cmd+Shift+A | 查找动作 |
| 全局 | Ctrl+反引号 / Cmd+反引号 | 切换终端 |
| Changes | F4 | 打开工作文件编辑器 |
| File | Enter / 双击 | 编辑文件或展开目录 |
| File | F4 | 打开适用 Git Diff |
| File | F2 / Delete | 重命名 / 移入回收站 |
| 树/列表 | 方向键、Home/End、PageUp/PageDown | 导航；左右展开/折叠 |
| Changes | 空格 | 切换提交复选框 |
| 支持的列表 | Shift+F10 | 右键菜单 |
| 合并编辑器 | F7 / Shift+F7 | 下一处 / 上一处冲突 |
| 可编辑文本 | Ctrl+Z / Ctrl+Shift+Z | 撤销 / 重做（macOS 使用 Cmd） |
| 终端 | Ctrl+Shift+C / Ctrl+Shift+V | 复制选择 / 粘贴 |
| 菜单/对话框 | Esc | 允许时关闭或取消；执行中可能保持窗口 |

焦点会改变按键含义：Log 中 F2 编辑提交说明，File 中 F2 改文件名。输入弹窗打开时先处理弹窗，再执行全局动作。自定义绑定请到[Settings → Keymap](./settings)，记录组合、解决冲突后 Apply。
