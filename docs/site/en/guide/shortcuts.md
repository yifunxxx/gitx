# Keyboard shortcuts

The table is generated from the registered default bindings. Windows/Linux use Ctrl for Mod; macOS uses Cmd where defined. These definitions do not imply that native installers are published for every platform. Custom Keymap settings override the defaults.

| Action | Windows | macOS |
| --- | --- | --- |
| [Commit](./commit) | `Ctrl+K` | `Cmd+K` |
| [Show Diff](./diff) | `Ctrl+D` | `Cmd+D` |
| [Find in Files…](./search) | `Ctrl+Shift+F` | `Cmd+Shift+F` |
| [Go to File…](./search) | `Ctrl+P` | `Cmd+P` |
| [Open…](./getting-started) | `Ctrl+O` | `Cmd+O` |
| [Save](./files) | `Ctrl+S` | `Cmd+S` |
| [Add to VCS](./commit) | `Ctrl+Alt+A` | `Cmd+Option+A` |
| [Commit and Push…](./commit) | `Ctrl+Alt+K` | `Cmd+Option+K` |
| [Push…](./sync) | `Ctrl+Shift+K` | `Cmd+Shift+K` |
| [Refresh Status](./workspace) | `Ctrl+R` | `Cmd+R` |
| [Edit Commit Message…](./rewrite) | `F2` | `F2` |
| [Settings…](./settings) | `Ctrl+,` | `Cmd+,` |
| [Show Commit Tool Window](./workspace) | `Alt+0` | `Option+0` |
| [Show File Tool Window](./workspace) | `Alt+1` | `Option+1` |
| [Show Repository at Revision](./history) | `Ctrl+Shift+O` | `Cmd+Shift+O` |
| [Update Project…](./sync) | `Ctrl+T` | `Cmd+T` |

## Fixed and context-specific keys

| Context | Keys | Result |
| --- | --- | --- |
| Global | Ctrl+Shift+A / Cmd+Shift+A | Find Action |
| Global | Ctrl+backtick / Cmd+backtick | Toggle Terminal |
| Changes | F4 | Open working-file editor |
| File | Enter / double-click | Open file editor; expand a directory |
| File | F4 | Open an applicable Git diff |
| File | F2 / Delete | Rename / recycle selected item(s) |
| Trees/lists | Arrows, Home/End, PageUp/PageDown | Navigate; Left/Right collapse/expand |
| Changes | Space | Toggle commit checkbox |
| Supported lists | Shift+F10 | Open context menu |
| Merge editor | F7 / Shift+F7 | Next / previous conflict |
| Editable text | Ctrl+Z / Ctrl+Shift+Z | Undo / redo (Cmd on macOS) |
| Terminal | Ctrl+Shift+C / Ctrl+Shift+V | Copy selection / paste |
| Menus/dialogs | Escape | Close or cancel when available; busy operations may retain the dialog |

Focus matters: F2 in Log edits a commit message, while F2 in File renames a file. Close modal input dialogs before invoking global commands. To rebind, open [Settings → Keymap](./settings), record a combination, resolve conflicts, and Apply.
