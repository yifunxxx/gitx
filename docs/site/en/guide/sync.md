# Remotes & synchronization

## Configure a remote

Open **Manage Remotes** from the VCS menu or Find Action. Add a name, usually `origin`, and the repository URL, then save. You can edit or remove existing remotes. **Fetch on add remote** controls whether adding one immediately fetches it. Removing a remote configuration does not delete the server repository.

HTTPS and SSH use Git's authentication environment. For an HTTPS credential prompt, enter the username and password or access token required by the server; choose whether to remember it. Configure SSH keys and host access in your system first. gitx does not provide a complete GitHub account, PR Review, or GitLab MR management center.

## Know which operation you need

| Operation | Purpose | Effect on working files |
| --- | --- | --- |
| Refresh (`Ctrl+R`) | Reload local status | Does not integrate remote code |
| Fetch | Retrieve remote commits and references | Does not automatically merge the current branch |
| Pull / Update Project | Fetch and integrate using a strategy | Can change files, history, or enter a conflict state |
| Push (`Ctrl+Shift+K`) | Send local commits to a remote | Primarily changes remote references |

## Pull a specific branch

1. Open **Pull** and choose the remote and branch.
2. Choose Merge or Rebase according to your project's workflow.
3. Inspect options and the preview, then run the operation.
4. Check Log, Changes, and Console. Follow [conflict resolution](./conflicts) if it stops.

| Option | Meaning |
| --- | --- |
| `--rebase` | Replay local commits on top of the remote changes |
| `--ff-only` | Permit only a fast-forward; fail on divergence |
| `--no-ff` | Keep a merge commit even when a fast-forward is possible |
| `--squash` | Collect changes locally; a subsequent commit is usually needed |
| `--no-commit` | Stop before a merge commit; fast-forward cases follow Git's actual behavior |
| `--no-verify` | Skip applicable Git hooks; use only with a specific reason |

Avoid incompatible option combinations. Check the preview and Git's validation messages.

## Update Project

Press `Ctrl+T`. Choose **Merge remote changes**, **Rebase onto remote branch**, or **Reset to remote branch**. Reset removes local commits absent from the remote branch; preserve any history you need first.

When local changes exist, gitx can save them using the configured **Clean tree method**, Stash or Shelf, and restore them at the appropriate stage. Conflicts, pauses, or a pending merge commit may delay restoration. Follow the state banner, then check that local changes returned. The **Update Info** tab summarizes the update.

If you select “Do not show options next time,” subsequent updates use Settings. Turn **Show options before update** back on to restore the dialog.

## Preview and push

1. Press `Ctrl+Shift+K`.
2. Select the remote, local branch, and remote branch. If none exists, add a remote name and URL in the dialog.
3. Review the outgoing commits and destination. For a new branch, enable **Set upstream** when appropriate.
4. Choose no tags, all tags, or tags associated with the current commit as needed.
5. Use a normal Push by default. **Force with lease** is for intentionally replacing remote history and can still change history used by collaborators.

Protected-branch settings can prevent force pushes; defaults include main/master. Local tool protection does not replace server-side branch rules.

## Rejected pushes and authentication failures

Read the rejection reason first. If the remote is ahead, Fetch, then Pull/Update to integrate it, resolve conflicts, and retry a normal Push. Authentication errors require checking the URL, permissions, token, or SSH setup. Force pushing does not solve authentication failures.

If committing succeeded but pushing failed, the commit remains locally. Do not commit again just to retry the push. Inspect jobs and Console for network failures; verify the actual result after cancellation before retrying.

## Sync a fork

Add the parent repository as a remote, usually `upstream`, and configure **Fork parent remote** in Settings. Run **Sync Fork with Upstream** through Find Action. It fetches the parent, updates the default branch, and attempts to push to origin, so check the remote in the confirmation. This is a host-independent Git workflow, not a hosting-account authorization feature.
