//! Prepare partial commits without mutating the user's index on failure.
use crate::{
    ops::{classify_commit_error, CommitIndexLock},
    partial_ops::{decode_partial_text, partial_is_link, validate_partial_path, PartialSelection},
    GitInvocation, GitRunner, OpKind,
};
use gitx_core::{AppError, ChangelistsState, CommitResult, ErrorCode, PartialFileSelection};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::InvalidArgument, message)
}

fn io(error: std::io::Error) -> AppError {
    AppError::new(ErrorCode::FsError, error.to_string())
}

fn index_bytes(path: &Path) -> Result<Option<Vec<u8>>, AppError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io(error)),
    }
}

fn regular_worktree_file(cwd: &Path, path: &str) -> Result<Option<Vec<u8>>, AppError> {
    let full = cwd.join(path);
    let mut current = cwd.to_path_buf();
    for component in Path::new(path).components() {
        current.push(component);
        let meta = match fs::symlink_metadata(&current) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(io(error)),
        };
        if partial_is_link(&meta) || (current == full && !meta.is_file()) {
            return Err(invalid("partial commits require a regular worktree file"));
        }
    }
    fs::read(full).map(Some).map_err(io)
}

#[derive(PartialEq)]
enum WholeFileSnapshot {
    Missing,
    File(Vec<u8>, bool),
    Link(PathBuf),
    Gitlink(Vec<u8>),
}

enum SelectionSnapshot {
    Partial(Option<Vec<u8>>),
    Whole(Vec<(String, WholeFileSnapshot)>),
}

pub(crate) enum CommitSelection {
    Lines(PartialFileSelection),
    Hunks {
        path: String,
        indexes: Vec<u32>,
        token: String,
    },
    Whole {
        path: String,
    },
}
impl CommitSelection {
    fn path(&self) -> &str {
        match self {
            Self::Lines(selection) => &selection.path,
            Self::Hunks { path, .. } | Self::Whole { path } => path,
        }
    }
    fn empty(&self) -> bool {
        match self {
            Self::Lines(selection) => selection.selected_lines.is_empty(),
            Self::Hunks { indexes, .. } => indexes.is_empty(),
            Self::Whole { .. } => false,
        }
    }
}

impl GitRunner {
    async fn partial_commit_reference(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Option<String>, AppError> {
        match self
            .run(
                GitInvocation::new(cwd, ["symbolic-ref", "--quiet", "HEAD"]),
                cancel,
            )
            .await
        {
            Ok(output) => Ok(Some(String::from_utf8_lossy(&output.stdout).trim().into())),
            Err(error) if error.exit_code == Some(1) => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// None means a genuinely unborn symbolic branch, never an unreadable HEAD.
    async fn partial_commit_head(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Option<String>, AppError> {
        match self
            .run(
                GitInvocation::new(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]),
                cancel,
            )
            .await
        {
            Ok(out) => Ok(Some(String::from_utf8_lossy(&out.stdout).trim().into())),
            Err(error) if error.exit_code == Some(1) => {
                let branch = self
                    .run(
                        GitInvocation::new(cwd, ["symbolic-ref", "--quiet", "HEAD"]),
                        cancel,
                    )
                    .await?;
                let branch = String::from_utf8_lossy(&branch.stdout);
                match self
                    .run(
                        GitInvocation::new(cwd, ["show-ref", "--verify", "--quiet", branch.trim()]),
                        cancel,
                    )
                    .await
                {
                    Err(missing) if missing.exit_code == Some(1) => Ok(None),
                    Err(other) => Err(other),
                    Ok(_) => Err(error),
                }
            }
            Err(error) => Err(error),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn commit_partial(
        &self,
        cwd: &Path,
        message: &str,
        amend: bool,
        no_verify: bool,
        partial: &[PartialFileSelection],
        cancel: &CancellationToken,
    ) -> Result<CommitResult, AppError> {
        let selected = partial
            .iter()
            .cloned()
            .map(CommitSelection::Lines)
            .collect::<Vec<_>>();
        self.commit_selections(cwd, message, amend, no_verify, &selected, None, cancel)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn commit_selections(
        &self,
        cwd: &Path,
        message: &str,
        amend: bool,
        no_verify: bool,
        partial: &[CommitSelection],
        expected_state: Option<&ChangelistsState>,
        cancel: &CancellationToken,
    ) -> Result<CommitResult, AppError> {
        self.validate_partial_commit_backend(cwd)?;
        let mut seen = HashSet::new();
        for selection in partial {
            validate_partial_path(selection.path())?;
            let key = Path::new(selection.path())
                .components()
                .filter(|component| !matches!(component, std::path::Component::CurDir))
                .collect::<std::path::PathBuf>()
                .to_string_lossy()
                .replace('\\', "/");
            #[cfg(windows)]
            let key = key.to_lowercase();
            if selection.empty() || !seen.insert(key) {
                return Err(invalid("select changed lines once per file"));
            }
        }
        let git_dir = self.git_dir(cwd, cancel).await?;
        for state in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"] {
            if git_dir.join(state).exists() {
                return Err(AppError::new(
                    ErrorCode::OperationInProgress,
                    "finish the current operation before a partial commit",
                ));
            }
        }
        let index = git_dir.join("index");
        let _lock = CommitIndexLock::acquire(&git_dir)?;
        let gitx = git_dir.join("gitx");
        fs::create_dir_all(&gitx).map_err(io)?;
        let temporary = tempfile::Builder::new()
            .prefix("partial-commit-")
            .tempdir_in(&gitx)
            .map_err(io)?;
        let commit_index = temporary.path().join("commit-index");
        let result_index = tempfile::Builder::new()
            .prefix("result-index-")
            .tempfile_in(temporary.path())
            .map_err(io)?
            .into_temp_path();
        let message_path = temporary.path().join("message");
        fs::write(&message_path, format!("{message}\n")).map_err(io)?;
        let original_index = index_bytes(&index)?;
        if let Some(bytes) = &original_index {
            fs::write(temporary.path().join("original-index"), bytes).map_err(io)?;
            fs::write(&result_index, bytes).map_err(io)?;
        } else {
            fs::remove_file(&result_index).map_err(io)?;
        }
        let invocation = |index: &Path, args: Vec<String>| {
            GitInvocation::new(cwd, args)
                .kind(OpKind::Write)
                .env("GIT_INDEX_FILE", index.to_string_lossy())
                .env("GIT_LITERAL_PATHSPECS", "1")
        };
        let head = self.partial_commit_head(cwd, cancel).await?;
        let reference = self.partial_commit_reference(cwd, cancel).await?;
        self.run(
            invocation(
                &commit_index,
                vec![
                    "read-tree".into(),
                    head.as_deref().unwrap_or("--empty").into(),
                ],
            ),
            cancel,
        )
        .await?;
        if original_index.is_none() {
            self.run(
                invocation(&result_index, vec!["read-tree".into(), "--empty".into()]),
                cancel,
            )
            .await?;
        }

        let mut worktree_snapshots = Vec::new();
        let whole_paths = partial
            .iter()
            .filter_map(|selection| match selection {
                CommitSelection::Whole { path } => Some(path.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>();
        for path in &whole_paths {
            let snapshot = self.whole_worktree_snapshot(cwd, path, cancel).await?;
            worktree_snapshots.push((*path, SelectionSnapshot::Whole(snapshot)));
        }
        if !whole_paths.is_empty() {
            self.stage_whole_commit_selections(
                cwd,
                &whole_paths,
                &commit_index,
                &result_index,
                cancel,
            )
            .await?;
        }
        for (number, selection) in partial.iter().enumerate() {
            let path = selection.path();
            if matches!(selection, CommitSelection::Whole { .. }) {
                continue;
            }
            let raw = regular_worktree_file(cwd, path)?;
            if let CommitSelection::Hunks { token, .. } = selection {
                let state = gitx_meta::load_changelists(&git_dir)?;
                if self
                    .changelist_preview(cwd, path, &state, cancel)
                    .await?
                    .state
                    .content_token
                    != *token
                {
                    return Err(invalid("file or block ownership changed while preparing commit; refresh and review"));
                }
            }
            let base = match &head {
                Some(oid) => self.partial_revision_blob(cwd, path, oid, cancel).await?,
                None => None,
            };
            let staged = self.partial_index_blob(cwd, path, cancel).await?;
            if base.is_some() && staged.is_none() && raw.is_some() {
                return Err(invalid(
                    "a staged file deletion requires a whole-file commit",
                ));
            }
            if raw.is_none() && matches!(selection, CommitSelection::Lines(_)) {
                return Err(invalid("line selections require an existing worktree file"));
            }
            decode_partial_text(raw.clone().unwrap_or_default())?;
            self.validate_partial_commit_attributes(cwd, path, cancel)
                .await?;
            if base.is_none() && staged.is_none() {
                match self
                    .run(
                        GitInvocation::new(cwd, ["check-ignore", "-q", "--", path]),
                        cancel,
                    )
                    .await
                {
                    Ok(_) => return Err(invalid("ignored files cannot be partially committed")),
                    Err(error) if error.exit_code == Some(1) => {}
                    Err(error) => return Err(error),
                }
            }
            let clean = self
                .run(
                    GitInvocation::new(
                        cwd,
                        ["hash-object", "-w", "--stdin", &format!("--path={path}")],
                    )
                    .kind(OpKind::Write)
                    .stdin(raw.clone().unwrap_or_default()),
                    cancel,
                )
                .await?;
            let oid = String::from_utf8_lossy(&clean.stdout);
            let work = self
                .run(
                    GitInvocation::new(cwd, ["cat-file", "blob", oid.trim()]),
                    cancel,
                )
                .await?;
            let work = decode_partial_text(work.stdout)?;
            let base_text = base.as_ref().map_or("", |blob| blob.text.as_str());
            let hunks = gitx_diff::compute_hunks(
                Some(base_text),
                Some(&work),
                &gitx_diff::DiffComputeOptions::default(),
            );
            let selected = match selection {
                CommitSelection::Lines(selection) => {
                    PartialSelection::Lines(&selection.selected_lines).validate(&hunks)?;
                    gitx_diff::apply_selected_lines_to_base(
                        base_text,
                        &work,
                        &selection.selected_lines,
                    )
                }
                CommitSelection::Hunks { indexes, .. } => {
                    PartialSelection::Hunks(indexes, None).validate(&hunks)?;
                    gitx_diff::apply_selected_hunks_to_base(base_text, &work, indexes)
                }
                CommitSelection::Whole { .. } => unreachable!(),
            };
            if selected == base_text {
                return Err(AppError::new(
                    ErrorCode::NothingToCommit,
                    "no selected changed lines to commit",
                ));
            }
            let mode = base
                .as_ref()
                .or(staged.as_ref())
                .map(|blob| blob.mode.as_str())
                .unwrap_or_else(|| {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        if fs::metadata(cwd.join(path))
                            .is_ok_and(|meta| meta.permissions().mode() & 0o111 != 0)
                        {
                            return "100755";
                        }
                    }
                    "100644"
                });
            let staged_text = staged.as_ref().map_or("", |blob| blob.text.as_str());
            let merged = if staged_text == base_text || staged_text == selected {
                selected.clone()
            } else {
                let ours = temporary.path().join(format!("{number}-staged"));
                let ancestor = temporary.path().join(format!("{number}-base"));
                let theirs = temporary.path().join(format!("{number}-selected"));
                fs::write(&ours, staged_text).map_err(io)?;
                fs::write(&ancestor, base_text).map_err(io)?;
                fs::write(&theirs, &selected).map_err(io)?;
                let out = self.run(GitInvocation::new(cwd, vec!["merge-file".into(), "-p".into(), "--".into(), ours.into_os_string(), ancestor.into_os_string(), theirs.into_os_string()]), cancel).await.map_err(|error| {
                    if error.exit_code.is_some_and(|code| code > 0 && code < 128) {
                        invalid(format!("selected lines overlap other staged content in {path}; review the staged changes before committing"))
                    } else { error }
                })?;
                decode_partial_text(out.stdout)?
            };
            if raw.is_none() {
                if !merged.is_empty() {
                    return Err(invalid(
                        "file deletion overlaps staged changes; review staged content",
                    ));
                }
                for index in [commit_index.as_path(), result_index.as_ref()] {
                    self.run(
                        invocation(
                            index,
                            vec![
                                "update-index".into(),
                                "--force-remove".into(),
                                "--".into(),
                                path.into(),
                            ],
                        ),
                        cancel,
                    )
                    .await?;
                }
            } else {
                self.partial_commit_put(cwd, &commit_index, path, mode, &selected, cancel)
                    .await?;
                self.partial_commit_put(
                    cwd,
                    &result_index,
                    path,
                    staged.as_ref().map_or(mode, |blob| blob.mode.as_str()),
                    &merged,
                    cancel,
                )
                .await?;
            }
            worktree_snapshots.push((path, SelectionSnapshot::Partial(raw)));
        }
        // Also rejects unresolved entries outside the selected files.
        self.run(invocation(&result_index, vec!["write-tree".into()]), cancel)
            .await?;
        let planned_tree = self
            .run(invocation(&commit_index, vec!["write-tree".into()]), cancel)
            .await?
            .stdout;
        for (path, snapshot) in &worktree_snapshots {
            let changed = match snapshot {
                SelectionSnapshot::Partial(bytes) => regular_worktree_file(cwd, path)? != *bytes,
                SelectionSnapshot::Whole(before) => {
                    self.whole_worktree_snapshot(cwd, path, cancel).await? != *before
                }
            };
            if changed {
                return Err(invalid(
                    "file changed while preparing commit; refresh and review the selection",
                ));
            }
        }
        if self.partial_commit_head(cwd, cancel).await? != head
            || self.partial_commit_reference(cwd, cancel).await? != reference
            || index_bytes(&index)? != original_index
        {
            return Err(invalid(
                "HEAD or index changed while preparing commit; refresh and retry",
            ));
        }
        if let Some(expected) = expected_state {
            let actual = gitx_meta::load_changelists(&git_dir)?;
            if actual.lists != expected.lists || actual.assignments != expected.assignments {
                return Err(invalid(
                    "changelist assignments changed before commit; refresh and review",
                ));
            }
        }
        let mut args = vec![
            "commit".into(),
            "-F".into(),
            message_path.to_string_lossy().into_owned(),
            "--cleanup=strip".into(),
        ];
        if amend {
            args.push("--amend".into());
        }
        if no_verify {
            args.push("--no-verify".into());
        }
        let outcome = self
            .run(
                invocation(&commit_index, args).timeout(Some(std::time::Duration::from_secs(120))),
                cancel,
            )
            .await;
        let recovery = CancellationToken::new();
        if let Err(error) = outcome {
            let current_head = self.partial_commit_head(cwd, &recovery).await;
            if current_head.is_err() {
                let _ = result_index.keep();
                let retained = temporary.keep();
                return Err(AppError::new(ErrorCode::GitCommandFailed, format!("Git did not finish successfully and its commit result could not be determined: {}. The original index was kept; inspect HEAD and recovery files at {} before retrying.", error.message, retained.display())));
            }
            if current_head.as_ref().is_ok_and(|current| *current == head) {
                return Err(classify_commit_error(error));
            }
            // A cancelled/failed post-commit hook can report failure after Git
            // advanced HEAD. Retain evidence and do not invite another commit.
            let mut result = self
                .commit_result_from_head(cwd, amend, &recovery)
                .await
                .unwrap_or_else(|_| CommitResult {
                    sha: current_head.ok().flatten().unwrap_or_default(),
                    subject: message.lines().next().unwrap_or_default().into(),
                    amended: amend,
                    warning: None,
                });
            let _ = result_index.keep();
            let retained = temporary.keep();
            result.warning = Some(format!("HEAD advanced but Git did not finish successfully: {}. The original index was kept; review HEAD and recovery files at {} before another commit.", error.message, retained.display()));
            return Ok(result);
        }
        let mut result = match self.commit_result_from_head(cwd, amend, &recovery).await {
            Ok(result) => result,
            Err(error) => {
                let _ = result_index.keep();
                let retained = temporary.keep();
                return Ok(CommitResult {
                    sha: self.partial_commit_head(cwd, &recovery).await.ok().flatten().unwrap_or_default(),
                    subject: message.lines().next().unwrap_or_default().into(),
                    amended: amend,
                    warning: Some(format!("Git reported a successful commit, but its details could not be read: {}. The original index was kept; review recovery files at {} before another commit.", error.message, retained.display())),
                });
            }
        };
        let committed_tree = self
            .run(
                GitInvocation::new(cwd, ["rev-parse", "HEAD^{tree}"]),
                &recovery,
            )
            .await;
        let problem = match committed_tree {
            Ok(tree) if tree.stdout != planned_tree => {
                Some("a hook changed the prepared commit tree".to_string())
            }
            Err(error) => Some(format!(
                "could not verify the committed tree: {}",
                error.message
            )),
            _ => match index_bytes(&index) {
                Ok(current) if current == original_index => None,
                Ok(_) => Some("the real index changed outside its lock".to_string()),
                Err(error) => Some(format!(
                    "could not verify the original index: {}",
                    error.message
                )),
            },
        };
        if let Some(problem) = problem {
            let _ = result_index.keep();
            let retained = temporary.keep();
            result.warning = Some(format!("Commit succeeded, but {problem}. The original index was kept; review recovery files at {}.", retained.display()));
            return Ok(result);
        }
        if let Err(error) = result_index.persist(&index) {
            let detail = error.error.to_string();
            let _ = error.path.keep();
            let retained = temporary.keep();
            result.warning = Some(format!("Commit succeeded, but the index could not be updated: {detail}. Recovery files retained at {}.", retained.display()));
        }
        Ok(result)
    }

    async fn whole_worktree_snapshot(
        &self,
        cwd: &Path,
        path: &str,
        cancel: &CancellationToken,
    ) -> Result<Vec<(String, WholeFileSnapshot)>, AppError> {
        let full = cwd.join(path);
        let mut paths = if fs::symlink_metadata(&full)
            .is_ok_and(|meta| meta.is_dir() && !partial_is_link(&meta))
            && !full.join(".git").exists()
        {
            // Folder selections snapshot the same tracked/unignored candidates
            // that Git can add, including deleted paths and nested gitlinks.
            let entries = self
                .run(
                    GitInvocation::new(
                        cwd,
                        [
                            "ls-files",
                            "-z",
                            "--cached",
                            "--others",
                            "--exclude-standard",
                            "--",
                            path,
                        ],
                    )
                    .env("GIT_LITERAL_PATHSPECS", "1"),
                    cancel,
                )
                .await?;
            entries
                .stdout
                .split(|byte| *byte == 0)
                .filter(|entry| !entry.is_empty())
                .map(|entry| {
                    String::from_utf8(entry.to_vec())
                        .map_err(|_| invalid("selected paths must be valid UTF-8"))
                })
                .collect::<Result<Vec<_>, _>>()?
        } else {
            vec![path.to_owned()]
        };
        paths.sort();
        paths.dedup();
        let mut snapshots = Vec::with_capacity(paths.len());
        for path in paths {
            let full = cwd.join(&path);
            let snapshot = match fs::symlink_metadata(&full) {
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                    ) =>
                {
                    WholeFileSnapshot::Missing
                }
                Err(error) => return Err(io(error)),
                Ok(meta) if partial_is_link(&meta) => {
                    WholeFileSnapshot::Link(fs::read_link(&full).map_err(io)?)
                }
                Ok(meta) if meta.is_file() => {
                    #[cfg(unix)]
                    let executable = {
                        use std::os::unix::fs::PermissionsExt;
                        meta.permissions().mode() & 0o111 != 0
                    };
                    #[cfg(not(unix))]
                    let executable = false;
                    WholeFileSnapshot::File(fs::read(&full).map_err(io)?, executable)
                }
                Ok(meta) if meta.is_dir() && full.join(".git").exists() => {
                    // A gitlink records the nested repository's HEAD, never the
                    // contents of its working directory.
                    let head = self
                        .run(
                            GitInvocation::new(&full, ["rev-parse", "--verify", "HEAD^{commit}"]),
                            cancel,
                        )
                        .await?;
                    WholeFileSnapshot::Gitlink(head.stdout)
                }
                // A previously tracked file can now be a regular directory.
                // Its old index entry is deleted; its children are separate
                // candidates collected above.
                Ok(meta) if meta.is_dir() => WholeFileSnapshot::Missing,
                Ok(_) => {
                    return Err(invalid(
                        "selected paths must be files, symlinks, or submodules",
                    ))
                }
            };
            snapshots.push((path, snapshot));
        }
        Ok(snapshots)
    }

    async fn stage_whole_commit_selections(
        &self,
        cwd: &Path,
        paths: &[&str],
        commit_index: &Path,
        result_index: &Path,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let invocation = |index: &Path, args: Vec<String>| {
            GitInvocation::new(cwd, args)
                .kind(OpKind::Write)
                .env("GIT_INDEX_FILE", index.to_string_lossy())
                .env("GIT_LITERAL_PATHSPECS", "1")
        };
        let mut pathspecs = Vec::new();
        for path in paths {
            pathspecs.extend_from_slice(path.as_bytes());
            pathspecs.push(0);
        }
        self.run(
            invocation(
                commit_index,
                vec![
                    "add".into(),
                    "-A".into(),
                    "--pathspec-from-file=-".into(),
                    "--pathspec-file-nul".into(),
                ],
            )
            .stdin(pathspecs),
            cancel,
        )
        .await?;
        // Convert worktree contents exactly once. A second add may run a clean
        // filter again or skip an assume-unchanged entry in the original index.
        // Publish the exact entries used for the commit, including deletions.
        let path_key = |path: &[u8]| {
            #[cfg(windows)]
            {
                String::from_utf8_lossy(path).to_lowercase().into_bytes()
            }
            #[cfg(not(windows))]
            {
                path.to_vec()
            }
        };
        let selected_paths = paths
            .iter()
            .map(|path| {
                Path::new(path)
                    .components()
                    .filter_map(|component| match component {
                        std::path::Component::Normal(name) => Some(name.to_string_lossy()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("/")
                    .into_bytes()
            })
            .map(|path| path_key(&path))
            .collect::<HashSet<_>>();
        let mut canonical_paths: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
        let mut select_entries = |entries: Vec<u8>| -> Result<Vec<u8>, AppError> {
            let mut selected = Vec::new();
            for entry in entries
                .split(|byte| *byte == 0)
                .filter(|entry| !entry.is_empty())
            {
                let tab = entry
                    .iter()
                    .position(|byte| *byte == b'\t')
                    .ok_or_else(|| invalid("invalid Git index entry"))?;
                let normalized = path_key(&entry[tab + 1..]);
                let path = normalized.as_slice();
                if selected_paths.contains(&Vec::new())
                    || selected_paths.contains(path)
                    || path.iter().enumerate().any(|(offset, byte)| {
                        *byte == b'/' && selected_paths.contains(&path[..offset])
                    })
                {
                    // Case-insensitive filesystems can still contain an index
                    // with distinct case-sensitive entries. Never combine their
                    // staging, including collisions at a selected directory.
                    let original_path = &entry[tab + 1..];
                    for end in original_path
                        .iter()
                        .enumerate()
                        .filter_map(|(offset, byte)| (*byte == b'/').then_some(offset))
                        .chain(std::iter::once(original_path.len()))
                    {
                        let original_prefix = &original_path[..end];
                        if let Some(previous) = canonical_paths
                            .insert(path_key(original_prefix), original_prefix.to_vec())
                        {
                            if previous != original_prefix {
                                return Err(invalid("selected paths have ambiguous casing in the index; resolve the path collision before committing"));
                            }
                        }
                    }
                    selected.extend_from_slice(entry);
                    selected.push(0);
                }
            }
            Ok(selected)
        };
        // Two index reads for the whole request, without exceeding Windows'
        // argv limit or spawning a Git process for every selected file.
        let list = vec!["ls-files".into(), "--stage".into(), "-z".into()];
        let selected = select_entries(
            self.run(invocation(commit_index, list.clone()), cancel)
                .await?
                .stdout,
        )?;
        let original = select_entries(
            self.run(invocation(result_index, list), cancel)
                .await?
                .stdout,
        )?;
        let mut updates = Vec::new();
        for entry in original
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
        {
            let tab = entry
                .iter()
                .position(|byte| *byte == b'\t')
                .ok_or_else(|| invalid("invalid Git index entry"))?;
            let oid = entry[..tab]
                .split(|byte| *byte == b' ')
                .nth(1)
                .ok_or_else(|| invalid("invalid Git index object"))?;
            updates.extend_from_slice(b"0 ");
            updates.extend(std::iter::repeat_n(b'0', oid.len()));
            updates.push(b'\t');
            updates.extend_from_slice(&entry[tab + 1..]);
            updates.push(0);
        }
        updates.extend_from_slice(&selected);
        self.run(
            invocation(
                result_index,
                vec!["update-index".into(), "-z".into(), "--index-info".into()],
            )
            .stdin(updates),
            cancel,
        )
        .await?;
        Ok(())
    }

    pub(crate) fn validate_partial_commit_backend(&self, cwd: &Path) -> Result<(), AppError> {
        // WSL invocation currently forwards native paths/env to wsl.exe, not
        // translated Linux paths and GIT_INDEX_FILE. Never risk a real-index
        // commit when a private index cannot be guaranteed.
        if self.wsl_distro.is_some()
            || crate::detect::parse_wsl_unc_path(&cwd.to_string_lossy()).is_some()
            || self
                .git_bin
                .split_whitespace()
                .next()
                .is_some_and(|bin| bin.eq_ignore_ascii_case("wsl.exe"))
        {
            return Err(invalid(
                "selected-file or partial commits with WSL Git are not supported; use native Git or commit the full staged index",
            ));
        }
        Ok(())
    }

    pub(crate) async fn validate_partial_commit_attributes(
        &self,
        cwd: &Path,
        path: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        // Arbitrary filters/encoding transformations do not have a reliable
        // line mapping. Normal Git EOL cleaning is handled before selection.
        let attrs = self
            .run(
                GitInvocation::new(
                    cwd,
                    [
                        "check-attr",
                        "-z",
                        "filter",
                        "working-tree-encoding",
                        "ident",
                        "--",
                        path,
                    ],
                ),
                cancel,
            )
            .await?;
        for attr in attrs
            .stdout
            .split(|byte| *byte == 0)
            .collect::<Vec<_>>()
            .chunks(3)
        {
            if attr.len() == 3 && !matches!(attr[2], b"unspecified" | b"unset") {
                return Err(invalid(
                    "filtered or encoded files require a whole-file commit",
                ));
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn partial_commit_put(
        &self,
        cwd: &Path,
        index: &Path,
        path: &str,
        mode: &str,
        content: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        // Both base and selected text are already clean blob bytes.
        let out = self
            .run(
                GitInvocation::new(cwd, ["hash-object", "-w", "--stdin", "--no-filters"])
                    .kind(OpKind::Write)
                    .stdin(content.as_bytes()),
                cancel,
            )
            .await?;
        let oid = String::from_utf8_lossy(&out.stdout);
        self.run(
            GitInvocation::new(
                cwd,
                [
                    "update-index",
                    "--add",
                    "--cacheinfo",
                    &format!("{mode},{},{path}", oid.trim()),
                ],
            )
            .kind(OpKind::Write)
            .env("GIT_INDEX_FILE", index.to_string_lossy())
            .env("GIT_LITERAL_PATHSPECS", "1"),
            cancel,
        )
        .await?;
        Ok(())
    }
}
