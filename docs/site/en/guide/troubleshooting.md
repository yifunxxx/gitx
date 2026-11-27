# Troubleshooting & recovery

## Git is missing or the author identity is unknown

Select `git.exe` in Settings → Git, Test it, and save. For an unknown author, configure `git config user.name` and `git config user.email` in the repository as described in [getting started](./getting-started). Installing gitx does not configure Git identity or remote permissions for you.

## A command is missing or disabled

Search with `Ctrl+Shift+A`, then check context: is a Git repository open, is the required file/commit selected, is another write running, or is a merge/rebase in progress? Different actions require different selections; comparing commits needs two, while Squash needs at least two.

F4 opens an editor in Changes but an applicable diff in File. Backend capabilities without UI controls do not become available by searching for their names. See the [feature index](./features).

## A list is empty or a file/search result is missing

Clear filters, inspect the active repository, and refresh. File's inline filter covers only loaded nodes; use `Ctrl+P` for filenames and `Ctrl+Shift+R` for content. To select the active editor file in the tree, use File's locate toolbar icon. Check hidden/ignored settings, truncation messages, and text-reading limits. Verify the disk path before concluding a file was deleted.

For empty Log results, Clear filters, inspect branch/path scope, and check loading or Git errors. A repository with no first commit legitimately has no history.

## Editing or saving fails, or edits are absent from a commit

Diff and history are read-only; open the current file from File. Preserve the draft while checking permissions, file locks, path changes, conflicts, UTF-8 encoding, or size limits. Saving must still be followed by staging/checking and Commit, then Push. A closed tab or pressed Save button does not prove all those steps succeeded.

## An update, merge, or rebase is paused

Read jobs and the repository-state banner. For conflicts, Resolve Conflicts, Save and mark resolved, then Continue. For a planned edit, finish editing/committing and continue. Skip omits the current replayed commit; Abort stops the operation.

Smart restoration of local changes can happen after the merge itself. Keep Stash/Shelf records when restoration fails and inspect the working tree. Do not remove protective system records prematurely.

## Push fails or credentials are requested repeatedly

Check the remote URL and port, account permissions, token, or SSH setup; read the specific Console error. A “remember credentials” failure means storage may not have succeeded. Fetch and Pull/Update when the remote is ahead. Force pushing does not fix authentication. If the local commit succeeded, retry only the push.

## Should I repeat an operation after an error?

Identify the completed stage first. A tag may exist locally despite push failure; a commit may exist despite refresh failure; a batch file operation may partly succeed. Inspect Log, Tags, disk files, job output, and stage messages before retrying unfinished work.

## Recover from a mistake

| Situation | Check first |
| --- | --- |
| Deleted in File | Windows Recycle Bin; restore and refresh |
| Deleted Shelf | Show deleted → Restore, then Unshelve if needed |
| Applied Stash | Apply retains the record; Pop/Drop/Clear differ, so inspect the actual list |
| Recent supported history rewrite | Undo Last History Rewrite, backup branches, Git reflog |
| Historical file replaced local content | Earlier commits, Stash/Shelf, or other backups |
| Published changes need reversal | Prefer Revert to retain shared history |

Recycle Bin, Recently Deleted shelves, and Git reflog cover different objects. Uncommitted, unsaved, and unbacked-up data is not guaranteed to be recoverable.

## An update downloaded but the installed version is unchanged

The download only prepares an installer. Save work, complete Update Center's restart/update workflow, then restart and check About. If checking/downloading fails, open Releases manually; failure is not proof that you are up to date.

## Report a problem

Include app version, operating system, entry point, minimal steps, expected and actual behavior, and reviewed screenshots/logs. Distinguish automated checks, native UI verification, and updating the installed app. Report at [GitHub Issues](https://github.com/yifunxxx/gitx/issues).
