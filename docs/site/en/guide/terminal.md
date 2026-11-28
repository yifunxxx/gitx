# Terminal, console & jobs

## Integrated terminal

Click **Terminal** or press `Ctrl+backtick` to toggle it. Open a folder first, then use **+** to create a session. Windows offers PowerShell and Command Prompt. This is a real shell that executes commands in its working directory.

1. Check the session's **Started in** directory.
2. Enter a command and press Enter.
3. Use the session selector to switch terminals. Hiding the panel retains sessions; closing a session stops its process.
4. Use **Open in Terminal** from a File directory's context menu to start in that directory.

Up to 16 sessions can remain open. After switching projects, do not infer an existing shell's directory from the new project name. Check it before running commands. Terminal scrollback is bounded, not unlimited log storage.

| Operation | Method |
| --- | --- |
| Copy a selection | `Ctrl+Shift+C` or Copy in the terminal menu |
| Paste | `Ctrl+Shift+V` or Paste; inspect commands before executing them |
| Interrupt a command | With no selection, `Ctrl+C` reaches the shell; with a selection, it copies the selected text |
| Select all or clear | Context menu → Select All / Clear |
| Close | Close terminal and stop its process |

Press `Shift+F10` or the menu key in terminal input to open the context menu. When a session tab has focus, use Left / Right to switch tabs or Home / End to reach the first or last tab. Holding a shortcut does not repeat copy, paste, or menu actions; extra modifiers such as Alt do not trigger those shortcuts.

If sending input fails partway through, GitX disables that session's input, discards queued text, and requests session closure so a queued Enter cannot execute incomplete input. Output and the error remain available. Check the original operation's actual outcome, then open a new terminal to continue. Input is never retried automatically.

The web demonstration backend does not provide an interactive terminal. Use the desktop app.

## Console

**Console** displays Git output, errors, and operation messages. It is not an interactive shell; selecting text there does not execute it. Inspect the entry for the relevant failed operation when troubleshooting authentication, hooks, paths, or Git errors.

Review paths, repository addresses, and personal information before sharing logs. Console retention is bounded; save needed logs separately for long-term records.

## Background jobs

Click **Background processes** in the status bar to inspect unfinished operations. Clone, Fetch, Push, comparisons, updates, and file reads may appear here. Completed tasks are removed; this queue does not retain history.

- Details show a phase message, progress, or **Running…**. Writes to the same repository may be waiting for another operation to finish.
- **Cancel**, when available, requests cancellation. The queue shows **Cancelling…** and disables the button until task completion is confirmed. Closing and reopening the queue preserves that state.
- A failed cancellation request reports an error and allows retry. Cancellation does not automatically roll back every effect. When a task fails, inspect its error notification and Console, and verify the actual state before retrying.

Writes to one repository may wait in sequence. Repeated clicking does not speed them up, and changing tabs does not cancel them. Operations such as creating tags or committing may finish their local stage before a remote stage fails. Follow the relevant feature's recovery instructions.
