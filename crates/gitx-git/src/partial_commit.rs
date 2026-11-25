//! Prepare partial commits without mutating the user's index on failure.
use crate::{
    ops::{classify_commit_error, CommitIndexLock},
    partial_ops::{decode_partial_text, partial_is_link, validate_partial_path, PartialSelection},
    GitInvocation, GitRunner, OpKind,
};
use gitx_core::{AppError, CommitResult, ErrorCode, PartialFileSelection};
use std::{collections::HashSet, fs, path::Path};
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

fn regular_worktree_file(cwd: &Path, path: &str) -> Result<Vec<u8>, AppError> {
    let full = cwd.join(path);
    let mut current = cwd.to_path_buf();
    for component in Path::new(path).components() {
        current.push(component);
        let meta = fs::symlink_metadata(&current).map_err(io)?;
        if partial_is_link(&meta) || (current == full && !meta.is_file()) {
            return Err(invalid("partial commits require a regular worktree file"));
        }
    }
    fs::read(full).map_err(io)
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
                "partial commits with WSL Git are not supported; use a whole-file commit",
            ));
        }
        let mut seen = HashSet::new();
        for selection in partial {
            validate_partial_path(&selection.path)?;
            let key = Path::new(&selection.path)
                .components()
                .filter(|component| !matches!(component, std::path::Component::CurDir))
                .collect::<std::path::PathBuf>()
                .to_string_lossy()
                .replace('\\', "/");
            #[cfg(windows)]
            let key = key.to_lowercase();
            if selection.selected_lines.is_empty() || !seen.insert(key) {
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
        let lock_path = git_dir.join("index.lock");
        let lock = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .map_err(io)?;
        let _lock = CommitIndexLock {
            path: lock_path,
            file: Some(lock),
        };
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
        for (number, selection) in partial.iter().enumerate() {
            let path = &selection.path;
            let base = match &head {
                Some(oid) => self.partial_revision_blob(cwd, path, oid, cancel).await?,
                None => None,
            };
            let staged = self.partial_index_blob(cwd, path, cancel).await?;
            if base.is_some() && staged.is_none() {
                return Err(invalid(
                    "a staged file deletion requires a whole-file commit",
                ));
            }
            let raw = regular_worktree_file(cwd, path)?;
            decode_partial_text(raw.clone())?;
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
                    .stdin(raw.clone()),
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
            PartialSelection::Lines(&selection.selected_lines).validate(&hunks)?;
            let selected = gitx_diff::apply_selected_lines_to_base(
                base_text,
                &work,
                &selection.selected_lines,
            );
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
            worktree_snapshots.push((path, raw));
        }
        // Also rejects unresolved entries outside the selected files.
        self.run(invocation(&result_index, vec!["write-tree".into()]), cancel)
            .await?;
        let planned_tree = self
            .run(invocation(&commit_index, vec!["write-tree".into()]), cancel)
            .await?
            .stdout;
        for (path, bytes) in &worktree_snapshots {
            if regular_worktree_file(cwd, path)? != *bytes {
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
