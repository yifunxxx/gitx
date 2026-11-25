# Installation & first commit

Follow this page to install gitx and create a local commit. Use a separate example folder for your first practice session.

## Install and prepare

1. Download a Windows installer from [GitHub Releases](https://github.com/yifunxxx/gitx/releases/latest). Choose either the NSIS `.exe` or the MSI package.
2. Run the installer and start gitx. Using the app does not require Node.js, pnpm, or Rust.
3. Git must be available on your computer. If gitx cannot find it, install [Git for Windows](https://git-scm.com/downloads/win), then select `git.exe` in **Settings → Git → Git executable** and click **Test**.
4. Before your first commit, configure your Git author identity. gitx uses Git's configuration. In a system terminal opened in the repository, run:

```sh
git config user.name "Your Name"
git config user.email "you@example.com"
```

Add `--global` only if you want the identity to apply to all your repositories.

## Choose the app language

Press `Ctrl+,`, open **Settings → Appearance → Language**, and choose **English** or **简体中文**. Save with **Apply** or **OK**. The language menu on this website changes documentation only; it is independent of the app setting.

## Open, clone, or create a repository

| Situation | Entry point | Steps and result |
| --- | --- | --- |
| The project is on your computer | Welcome → **Open Folder**, or `Ctrl+O` | Select its folder. gitx detects Git repositories; ordinary folders also support browsing and editing |
| The project is on a remote server | **Clone Repository** | Enter the URL, parent directory, and directory name. Check the final destination, then Clone; open the result when it finishes |
| You are starting a project | **Create Repository** | Select a directory and confirm initialization. Existing files remain and Git operations become available |
| An ordinary folder is already open | **Enable Version Control Integration / Init** | Confirm to initialize Git in that directory |

**Shallow clone** accepts a positive history depth to reduce downloads when only recent history is needed; complete history comparisons or rewriting may require a full clone. **Open after clone** controls opening on completion. You can cancel; inspect any partial destination, then retry into an empty directory. See [remotes and synchronization](./sync) for authentication.

## Make the first commit

1. Open the example repository and press `Alt+1` for **File**. Right-click a directory to create `README.md`, open it, and write a short project description.
2. Press `Ctrl+S`. Saving writes to disk; it does not create a Git commit.
3. Press `Alt+0` for **Commit**. New files appear under **Unversioned Files**; edits to tracked files appear in the changes list.
4. In the default **Changelist mode**, check the files you want to commit. Double-click a file or press `Ctrl+D` to review its diff. If you enabled staging mode, **Stage** the files first and review **Staged**.
5. Enter a useful message, such as `Add project introduction`. Leave **Run Git hooks** enabled and click **Commit**.
6. Check the new entry in **Log**, including its message and files. Committed changes leave the pending list; unrelated edits remain.

![Commit selection, side-by-side diff, and Log in the native app](/screenshots/commit-diff-en.jpg)

The left panel selects commit content, the center compares versions, and the bottom shows history.

## Push the commit

Press `Ctrl+Shift+K` for **Push**. Add a remote name and URL if none exists. Verify the local branch, remote branch, outgoing commits, and upstream option before pushing. See the [full synchronization workflow](./sync).

**A successful commit updates local history. A successful push sends commits to the remote.** Saving a file, committing, and pushing are separate steps.

## Next steps

- [Workspace & navigation](./workspace): locate panels and commands.
- [Commits & changelists](./commit): selections, staging, Amend, and ignored files.
- [Troubleshooting](./troubleshooting): unavailable actions, identity, authentication, and recovery.
