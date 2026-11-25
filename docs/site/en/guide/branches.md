# Branches & tags

## Find and check out a branch

Click the current branch in the toolbar, or use Branches beside Log. Search by name; slash-separated names can be grouped into directories. Stars mark favorites, and recent branches make it easier to return. Settings controls grouping, recent branches, and tag visibility.

A single click selects or inspects a branch. **Double-click or choose Checkout to switch.** Afterward, check the toolbar and Log's HEAD marker. If local edits would be overwritten, save, commit, or stash/shelve them before switching.

## Create, rename, and delete

| Task | Steps | What to check |
| --- | --- | --- |
| Create a branch | Choose New Branch from a branch or commit menu, enter its name and starting point, and choose whether to Checkout | The branch appears; the current branch changes only if checkout was requested |
| Check out a remote branch | Select its full name, such as `origin/feature/search`, then Checkout | Verify the resulting local branch and upstream |
| Rename | Choose Rename on a local branch, enter the new name, and confirm | The local name changes; do not assume the remote name was also renamed |
| Delete a local branch | Select a noncurrent local branch, choose Delete, and confirm | Verify the name and any unmerged-work warning |
| Delete a remote branch | Choose Delete on a remote branch and confirm | This changes the remote and affects collaborators; check the remote and full path |

**Copy Branch Name** copies the complete name. A tree row may display only the final component, so keep the parent path in mind.

## Branch context-menu operations

- **Merge into Current** merges the selected branch into your current branch.
- **Rebase Current onto Selected** rebases the current branch onto the selected one.
- **Checkout and Rebase** first checks out the target, then rebases in the direction shown; inspect source and destination.
- **Push / Pull with Merge / Pull with Rebase** starts synchronization for the menu target; verify the dialog's branch and remote.
- **Compare with Current** lists commits unique to each side. **Swap** reverses the direction. Read each column's “in this branch, not in the other” heading.

A comparison does not merge code or switch branches. See [synchronization](./sync) and [merging](./conflicts).

## Create and use tags

1. Select the intended commit in Log and choose **New Tag / Create Tag**.
2. Enter a name such as `v1.2.0` and verify the target commit.
3. Enter a message for an annotated tag. Enable Force only when intentionally replacing an existing tag.
4. If pushing after creation, inspect the displayed remote. This entry point uses the first available remote in the list.
5. Check Tags afterward. A failed push may leave a successfully created local tag; the dialog explains this and lets you retry only the push.

Do not recreate a tag to fix a network-only failure. A Git tag does not by itself publish an installer or GitHub Release.

Checking out a tag normally produces a **detached HEAD**. Create a local branch from it before continuing development. Before deleting a tag, check whether the operation targets a local tag or a remote reference.
