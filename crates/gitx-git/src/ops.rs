//! High-level git operations for M1 (status / stage / commit / log / init / diff sides).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use crate::status::parse_status_porcelain_v2;
use gitx_core::{
    AppError, BlameLine, BlameResult, BlobContent, BranchInfo, ChangedFile, CommitDetails,
    CommitResult, DiffSide, ErrorCode, HistoryCommit, HistoryPage, LogFilters, LogLocation,
    LogOrder, StatusSnapshot, TreeEntry,
};
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitRunner {
    pub async fn status_get(
        &self,
        cwd: &Path,
        repo_id: &str,
        version: u64,
        cancel: &CancellationToken,
    ) -> Result<StatusSnapshot, AppError> {
        let out = self.status_probe(cwd, cancel).await?;
        Ok(parse_status_porcelain_v2(&out.stdout, repo_id, version))
    }

    /// Write UTF-8 text into a worktree file. Does not stage the change.
    pub async fn file_write_worktree(
        &self,
        cwd: &Path,
        file_path: &str,
        content: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if cancel.is_cancelled() {
            return Err(AppError::new(ErrorCode::Cancelled, "operation cancelled"));
        }
        let full = crate::paths::resolve_worktree_file(cwd, file_path)?;
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::new(ErrorCode::FsError, format!("mkdir {}: {e}", parent.display()))
            })?;
        }
        std::fs::write(&full, content.as_bytes()).map_err(|e| {
            AppError::new(
                ErrorCode::FsError,
                format!("write {file_path}: {e}"),
            )
        })?;
        Ok(())
    }

    pub async fn init_repo(
        &self,
        dir: &Path,
        initial_branch: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if dir.join(".git").exists() {
            return Err(AppError::new(
                ErrorCode::AlreadyRepository,
                "directory is already a git repository",
            ));
        }
        std::fs::create_dir_all(dir).map_err(|e| {
            AppError::new(
                ErrorCode::FsError,
                format!("failed to create directory: {e}"),
            )
        })?;

        let mut inv_args: Vec<String> = vec!["init".into()];
        if let Some(b) = initial_branch {
            inv_args.push("-b".into());
            inv_args.push(b.to_string());
        }
        let inv = GitInvocation::new(dir, inv_args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn stage_paths(
        &self,
        cwd: &Path,
        paths: &[String],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if paths.is_empty() {
            return Ok(());
        }
        let stdin = pathspec_nul(paths);
        let inv = GitInvocation::new(
            cwd,
            ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
        )
        .kind(OpKind::Write)
        .git_bin(self.git_bin.clone())
        .stdin(stdin);
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn unstage_paths(
        &self,
        cwd: &Path,
        paths: &[String],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if paths.is_empty() {
            return Ok(());
        }
        // Prefer restore --staged; fall back to rm --cached for unborn HEAD.
        let stdin = pathspec_nul(paths);
        let inv = GitInvocation::new(
            cwd,
            [
                "restore",
                "--staged",
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
            ],
        )
        .kind(OpKind::Write)
        .git_bin(self.git_bin.clone())
        .stdin(stdin.clone());
        match self.run(inv, cancel).await {
            Ok(_) => Ok(()),
            Err(_) => {
                let inv = GitInvocation::new(
                    cwd,
                    [
                        "rm",
                        "--cached",
                        "-q",
                        "--ignore-unmatch",
                        "--pathspec-from-file=-",
                        "--pathspec-file-nul",
                    ],
                )
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone())
                .stdin(stdin);
                self.run(inv, cancel).await?;
                Ok(())
            }
        }
    }

    pub async fn add_paths(
        &self,
        cwd: &Path,
        paths: &[String],
        force: bool,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if paths.is_empty() {
            return Ok(());
        }
        let stdin = pathspec_nul(paths);
        let mut args = vec!["add".to_string()];
        if force {
            args.push("-f".into());
        }
        args.push("--pathspec-from-file=-".into());
        args.push("--pathspec-file-nul".into());
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone())
            .stdin(stdin);
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn read_blob_side(
        &self,
        cwd: &Path,
        path: &str,
        side: DiffSide,
        cancel: &CancellationToken,
    ) -> Result<Option<Vec<u8>>, AppError> {
        if cancel.is_cancelled() {
            return Err(AppError::new(ErrorCode::Cancelled, "operation cancelled"));
        }
        match side {
            DiffSide::Worktree => {
                let full = cwd.join(path);
                match std::fs::read(&full) {
                    Ok(bytes) => Ok(Some(bytes)),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                    Err(error) => Err(AppError::new(
                        ErrorCode::FsError,
                        format!("read worktree file: {error}"),
                    )),
                }
            }
            DiffSide::Index => self.read_git_blob(cwd, "", path, cancel).await,
            DiffSide::Head => self.read_git_blob(cwd, "HEAD", path, cancel).await,
        }
    }

    // Keep the successful read to one process. Only failed reads need a tree/index
    // lookup to prove that a file is absent; exit 128 alone is not that proof.
    async fn read_git_blob(
        &self,
        cwd: &Path,
        rev: &str,
        path: &str,
        cancel: &CancellationToken,
    ) -> Result<Option<Vec<u8>>, AppError> {
        let spec = if rev.is_empty() {
            format!(":0:{path}")
        } else {
            format!("{rev}:{path}")
        };
        let error = match self
            .run(
                GitInvocation::new(cwd, ["cat-file", "blob", "--", &spec]),
                cancel,
            )
            .await
        {
            Ok(out) => return Ok(Some(out.stdout)),
            Err(error) if error.exit_code == Some(128) => error,
            Err(error) => return Err(error),
        };
        let args = if rev.is_empty() {
            vec![
                "--literal-pathspecs",
                "ls-files",
                "--stage",
                "-z",
                "--",
                path,
            ]
        } else {
            vec!["--literal-pathspecs", "ls-tree", "-z", "--", rev, path]
        };
        match self.run(GitInvocation::new(cwd, args), cancel).await {
            Ok(out) if out.stdout.is_empty() => Ok(None),
            // Existing entries include unmerged index stages and non-blob
            // objects. Neither is a deleted file; retain the original error.
            Ok(_) => Err(error),
            Err(lookup) if rev == "HEAD" && lookup.exit_code == Some(128) => {
                if self.head_is_unborn(cwd, cancel).await? {
                    Ok(None)
                } else {
                    Err(lookup)
                }
            }
            Err(lookup) => Err(lookup),
        }
    }

    async fn head_is_unborn(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<bool, AppError> {
        let symbolic = match self
            .run(
                GitInvocation::new(cwd, ["symbolic-ref", "--quiet", "HEAD"]),
                cancel,
            )
            .await
        {
            Ok(out) => out,
            Err(error) if error.exit_code == Some(1) => return Ok(false),
            Err(error) => return Err(error),
        };
        let name = String::from_utf8_lossy(&symbolic.stdout);
        match self
            .run(
                GitInvocation::new(cwd, ["show-ref", "--verify", "--quiet", "--", name.trim()]),
                cancel,
            )
            .await
        {
            Ok(_) => Ok(false),
            Err(error) if error.exit_code == Some(1) => Ok(true),
            Err(error) => Err(error),
        }
    }

    pub async fn stage_hunk_text(
        &self,
        cwd: &Path,
        path: &str,
        new_index_text: &str,
        mode: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        // hash-object -w --stdin --path=<path> then update-index --cacheinfo
        let inv = GitInvocation::new(
            cwd,
            ["hash-object", "-w", "--stdin", &format!("--path={path}")],
        )
        .kind(OpKind::Write)
        .git_bin(self.git_bin.clone())
        .stdin(new_index_text.as_bytes().to_vec());
        let out = self.run(inv, cancel).await?;
        let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let cacheinfo = format!("{mode},{sha},{path}");
        let inv = GitInvocation::new(cwd, ["update-index", "--add", "--cacheinfo", &cacheinfo])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn file_mode_in_index(
        &self,
        cwd: &Path,
        path: &str,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let inv = GitInvocation::new(cwd, ["ls-files", "-s", "--", path])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(out) => {
                let line = String::from_utf8_lossy(&out.stdout);
                let mode = line.split_whitespace().next().unwrap_or("100644");
                Ok(mode.to_string())
            }
            Err(_) => Ok("100644".into()),
        }
    }

    pub async fn commit_create(
        &self,
        cwd: &Path,
        message: &str,
        amend: bool,
        no_verify: bool,
        cancel: &CancellationToken,
    ) -> Result<CommitResult, AppError> {
        self.commit_create_ex(cwd, message, amend, no_verify, None, None, cancel)
            .await
    }

    /// Commit with optional pathspec (`--only`) or partial line selections via temp index (#66).
    #[allow(clippy::too_many_arguments)]
    pub async fn commit_create_ex(
        &self,
        cwd: &Path,
        message: &str,
        amend: bool,
        no_verify: bool,
        paths: Option<&[String]>,
        partial: Option<&[gitx_core::PartialFileSelection]>,
        cancel: &CancellationToken,
    ) -> Result<CommitResult, AppError> {
        let trimmed = message.trim();
        if trimmed.is_empty() {
            return Err(AppError::new(
                ErrorCode::EmptyCommitMessage,
                "commit message is empty",
            ));
        }

        // Linked worktrees have a `.git` *file*; always resolve the real git dir.
        let gitx_dir = self.git_dir(cwd, cancel).await?.join("gitx");
        std::fs::create_dir_all(&gitx_dir)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("create gitx dir: {e}")))?;
        let msg_path = gitx_dir.join("COMMIT_EDITMSG");
        std::fs::write(&msg_path, format!("{trimmed}\n"))
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("write commit message: {e}")))?;

        // Partial line selections → temporary index.
        if let Some(partial) = partial {
            if !partial.is_empty() {
                let result = self
                    .commit_partial(cwd, &msg_path, amend, no_verify, partial, cancel)
                    .await;
                let _ = std::fs::remove_file(&msg_path);
                let result = result?;
                return Ok(self.restore_after_commit(cwd, result).await);
            }
        }

        let mut args = vec![
            "commit".to_string(),
            "-F".to_string(),
            msg_path.to_string_lossy().into_owned(),
            "--cleanup=strip".to_string(),
        ];
        if amend {
            args.push("--amend".into());
        }
        if no_verify {
            args.push("--no-verify".into());
        }
        if let Some(paths) = paths {
            if !paths.is_empty() {
                // Add untracked first, then commit --only.
                let _ = self.add_paths(cwd, paths, false, cancel).await;
                args.push("--only".into());
                args.push("--".into());
                args.extend(paths.iter().cloned());
            }
        }

        let result = self.run_commit_and_result(cwd, args, amend, cancel).await;
        let _ = std::fs::remove_file(&msg_path);
        Ok(self.restore_after_commit(cwd, result?).await)
    }

    async fn commit_partial(
        &self,
        cwd: &Path,
        msg_path: &Path,
        amend: bool,
        no_verify: bool,
        partial: &[gitx_core::PartialFileSelection],
        cancel: &CancellationToken,
    ) -> Result<CommitResult, AppError> {
        let git_dir = self.git_dir(cwd, cancel).await?;
        let gitx = git_dir.join("gitx");
        std::fs::create_dir_all(&gitx)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("create gitx dir: {e}")))?;
        let tmp_index = gitx.join("partial-index");
        let _ = std::fs::remove_file(&tmp_index);

        // Seed from HEAD (or an empty tree), not the live index — unrelated staged
        // files must stay out of the partial commit and remain staged afterward.
        let head_ok = self
            .run(
                GitInvocation::new(cwd, ["rev-parse", "--verify", "HEAD"])
                    .kind(OpKind::Read)
                    .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await
            .is_ok();
        self.run_with_index_env(
            cwd,
            &tmp_index,
            if head_ok {
                vec!["read-tree".into(), "HEAD".into()]
            } else {
                vec!["read-tree".into(), "--empty".into()]
            },
            cancel,
        )
        .await?;

        for sel in partial {
            let head_bytes = self
                .read_blob_side(cwd, &sel.path, DiffSide::Head, cancel)
                .await?;
            let work_bytes = self
                .read_blob_side(cwd, &sel.path, DiffSide::Worktree, cancel)
                .await?;
            let head_text = gitx_diff::decode_lossy(head_bytes.as_deref()).unwrap_or_default();
            let work_text = gitx_diff::decode_lossy(work_bytes.as_deref()).unwrap_or_default();
            let new_text = gitx_diff::apply_selected_lines_to_base(
                &head_text,
                &work_text,
                &sel.selected_lines,
            );
            let mode = self
                .file_mode_in_index(cwd, &sel.path, cancel)
                .await
                .unwrap_or_else(|_| "100644".into());
            self.stage_hunk_text_in_index(cwd, &tmp_index, &sel.path, &new_text, &mode, cancel)
                .await?;
        }

        let mut args = vec![
            "commit".to_string(),
            "-F".to_string(),
            msg_path.to_string_lossy().into_owned(),
            "--cleanup=strip".to_string(),
        ];
        if amend {
            args.push("--amend".into());
        }
        if no_verify {
            args.push("--no-verify".into());
        }

        // Run commit with GIT_INDEX_FILE via a wrapper script approach:
        // `git -c ...` cannot set env; use std::process with env for this one call.
        let result = self.run_with_index_env(cwd, &tmp_index, args, cancel).await;

        // Only on success: reset selected paths on the real index so remaining
        // worktree lines stay unstaged. Failed commits must leave the index alone.
        if result.is_ok() {
            let paths: Vec<String> = partial.iter().map(|p| p.path.clone()).collect();
            let _ = self
                .run(
                    GitInvocation::new(cwd, {
                        let mut a = vec!["reset".into(), "-q".into(), "--".into()];
                        a.extend(paths);
                        a
                    })
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone()),
                    cancel,
                )
                .await;
        }

        let _ = std::fs::remove_file(&tmp_index);
        result
    }

    async fn stage_hunk_text_in_index(
        &self,
        cwd: &Path,
        index_file: &Path,
        path: &str,
        new_index_text: &str,
        mode: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let inv = GitInvocation::new(
            cwd,
            ["hash-object", "-w", "--stdin", &format!("--path={path}")],
        )
        .kind(OpKind::Write)
        .git_bin(self.git_bin.clone())
        .stdin(new_index_text.as_bytes().to_vec());
        let out = self.run(inv, cancel).await?;
        let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let cacheinfo = format!("{mode},{sha},{path}");
        self.run_with_index_env(
            cwd,
            index_file,
            vec![
                "update-index".into(),
                "--add".into(),
                "--cacheinfo".into(),
                cacheinfo,
            ],
            cancel,
        )
        .await
        .map(|_| ())
    }

    async fn run_with_index_env(
        &self,
        cwd: &Path,
        index_file: &Path,
        args: Vec<String>,
        cancel: &CancellationToken,
    ) -> Result<CommitResult, AppError> {
        // For non-commit commands we only care about success; for commit we parse result.
        let is_commit = args.first().map(|s| s.as_str()) == Some("commit");
        let mut cmd = tokio::process::Command::new(&self.git_bin);
        cmd.args(&args)
            .current_dir(cwd)
            .env("GIT_INDEX_FILE", index_file)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        crate::process_win::hide_console_tokio(&mut cmd);
        if cancel.is_cancelled() {
            return Err(AppError::new(ErrorCode::Cancelled, "cancelled"));
        }
        let output = cmd
            .output()
            .await
            .map_err(|e| AppError::new(ErrorCode::GitCommandFailed, format!("spawn git: {e}")))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if stderr.contains("nothing to commit") {
                return Err(AppError::new(
                    ErrorCode::NothingToCommit,
                    "nothing to commit",
                ));
            }
            return Err(AppError::new(
                ErrorCode::GitCommandFailed,
                format!("git {} failed", args.first().unwrap_or(&"?".into())),
            )
            .with_stderr(stderr)
            .with_exit_code(output.status.code().unwrap_or(1)));
        }
        if !is_commit {
            return Ok(CommitResult {
                warning: None,
                sha: String::new(),
                subject: String::new(),
                amended: false,
            });
        }
        let amend = args.iter().any(|a| a == "--amend");
        self.commit_result_from_head(cwd, amend, cancel).await
    }

    async fn run_commit_and_result(
        &self,
        cwd: &Path,
        args: Vec<String>,
        amend: bool,
        cancel: &CancellationToken,
    ) -> Result<CommitResult, AppError> {
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone())
            .timeout(Some(std::time::Duration::from_secs(120)));

        match self.run(inv, cancel).await {
            Ok(_) => {}
            Err(err) => {
                let stderr = err.git_stderr.clone().unwrap_or_default();
                if stderr.contains("nothing to commit") {
                    return Err(AppError::new(
                        ErrorCode::NothingToCommit,
                        "nothing to commit",
                    ));
                }
                if stderr.to_lowercase().contains("hook")
                    || stderr.contains("pre-commit")
                    || stderr.contains("commit-msg")
                {
                    return Err(AppError::new(ErrorCode::HookFailed, err.message)
                        .with_stderr(stderr)
                        .with_command(err.command.unwrap_or_default())
                        .with_exit_code(err.exit_code.unwrap_or(1)));
                }
                return Err(err);
            }
        }
        self.commit_result_from_head(cwd, amend, cancel).await
    }

    async fn commit_result_from_head(
        &self,
        cwd: &Path,
        amend: bool,
        cancel: &CancellationToken,
    ) -> Result<CommitResult, AppError> {
        let sha_out = self
            .run(
                GitInvocation::new(cwd, ["rev-parse", "HEAD"])
                    .kind(OpKind::Read)
                    .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?;
        let sha = String::from_utf8_lossy(&sha_out.stdout).trim().to_string();
        let subj_out = self
            .run(
                GitInvocation::new(cwd, ["log", "-1", "--format=%s"])
                    .kind(OpKind::Read)
                    .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?;
        let subject = String::from_utf8_lossy(&subj_out.stdout).trim().to_string();
        Ok(CommitResult {
            warning: None,
            sha,
            subject,
            amended: amend,
        })
    }

    /// Locate using one hash-only walk, without loading every page's metadata or graph.
    pub async fn log_locate(
        &self,
        cwd: &Path,
        revision: &str,
        filters: &LogFilters,
        cancel: &CancellationToken,
    ) -> Result<LogLocation, AppError> {
        let revision = format!("{}^{{commit}}", revision.trim());
        let resolved = self
            .run(
                GitInvocation::new(
                    cwd,
                    ["rev-parse", "--verify", "--end-of-options", &revision],
                ),
                cancel,
            )
            .await?;
        let sha = String::from_utf8_lossy(&resolved.stdout).trim().to_string();
        let mut args = vec!["rev-list".to_string()];
        append_log_filters(&mut args, filters);
        let out = self
            .run(
                GitInvocation::new(cwd, args).timeout(Some(std::time::Duration::from_secs(60))),
                cancel,
            )
            .await?;
        let offset = out
            .stdout
            .split(|b| *b == b'\n')
            .position(|line| line == sha.as_bytes());
        Ok(LogLocation {
            sha,
            offset: offset.and_then(|n| u32::try_from(n).ok()),
        })
    }

    pub async fn log_page(
        &self,
        cwd: &Path,
        offset: u32,
        limit: u32,
        filters: &LogFilters,
        cancel: &CancellationToken,
    ) -> Result<(Vec<RawLogCommit>, bool), AppError> {
        let skip = offset.to_string();
        let max = (limit + 1).to_string();
        let mut args: Vec<String> = vec![
            "log".into(),
            format!("--skip={skip}"),
            format!("--max-count={max}"),
            "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D%x1e".into(),
            "--decorate-refs-exclude=refs/gitx/*".into(),
            "--decorate-refs-exclude=refs/stash".into(),
            "--decorate=short".into(),
            "--no-show-signature".into(),
            "--no-patch".into(),
            "--no-notes".into(),
        ];
        append_log_filters(&mut args, filters);

        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone())
            .timeout(Some(std::time::Duration::from_secs(60)));

        let out = match self.run(inv, cancel).await {
            Ok(o) => o,
            Err(err)
                if err.exit_code == Some(128)
                    && (err.message.contains("does not have any commits yet")
                        || err.message.contains("bad default revision")) =>
            {
                // Only an unborn repository is an empty result. Invalid filters remain errors.
                return Ok((Vec::new(), false));
            }
            Err(err) => return Err(err),
        };

        let text = String::from_utf8_lossy(&out.stdout);
        let mut commits = Vec::new();
        for record in text.split('\x1e') {
            let record = record.trim_matches('\n');
            if record.is_empty() {
                continue;
            }
            let fields: Vec<&str> = record.split('\0').collect();
            if fields.len() < 6 {
                continue;
            }
            let sha = fields[0].to_string();
            let parents = if fields[1].is_empty() {
                Vec::new()
            } else {
                fields[1]
                    .split_whitespace()
                    .map(|s| s.to_string())
                    .collect()
            };
            let refs = if fields.len() > 6 && !fields[6].is_empty() {
                fields[6]
                    .split(", ")
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            } else {
                Vec::new()
            };
            commits.push(RawLogCommit {
                sha,
                parents,
                author: fields[2].to_string(),
                author_email: fields[3].to_string(),
                author_time: fields[4].parse().unwrap_or(0),
                subject: fields[5].to_string(),
                refs,
            });
        }

        let truncated = commits.len() as u32 > limit;
        if truncated {
            commits.truncate(limit as usize);
        }
        Ok((commits, truncated))
    }

    pub async fn diff_refs_name_status(
        &self,
        cwd: &Path,
        left: &str,
        right: &str,
        cancel: &CancellationToken,
    ) -> Result<Vec<ChangedFile>, AppError> {
        let empty_tree = if left == "EMPTY" || right == "EMPTY" {
            Some(self.empty_tree(cwd, cancel).await?)
        } else {
            None
        };
        let left = if left == "EMPTY" {
            empty_tree.as_deref().unwrap()
        } else {
            left
        };
        let right = if right == "EMPTY" {
            empty_tree.as_deref().unwrap()
        } else {
            right
        };
        // right empty / WORKTREE → diff against working tree
        let mut args = vec![
            "diff".to_string(),
            "--name-status".into(),
            "-z".into(),
            "-M".into(),
        ];
        if right.eq_ignore_ascii_case("WORKTREE") || right.is_empty() {
            args.push(left.to_string());
        } else {
            args.push(left.to_string());
            args.push(right.to_string());
        }
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        Ok(parse_name_status_z(&out.stdout))
    }

    pub async fn empty_tree(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let out = self
            .run(
                GitInvocation::new(cwd, ["hash-object", "-w", "-t", "tree", "--stdin"])
                    .git_bin(self.git_bin.clone())
                    .stdin(Vec::<u8>::new()),
                cancel,
            )
            .await?;
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    pub async fn read_blob_at(
        &self,
        cwd: &Path,
        rev: &str,
        path: &str,
        cancel: &CancellationToken,
    ) -> Result<Option<Vec<u8>>, AppError> {
        if rev == "EMPTY" {
            return Ok(None);
        }
        if rev.eq_ignore_ascii_case("WORKTREE") || rev.is_empty() {
            return self
                .read_blob_side(cwd, path, DiffSide::Worktree, cancel)
                .await;
        }
        if rev.eq_ignore_ascii_case("INDEX") || rev == ":0" {
            return self
                .read_blob_side(cwd, path, DiffSide::Index, cancel)
                .await;
        }
        self.read_git_blob(cwd, rev, path, cancel).await
    }

    pub async fn file_history(
        &self,
        cwd: &Path,
        path: &str,
        offset: u32,
        limit: u32,
        all_branches: bool,
        cancel: &CancellationToken,
    ) -> Result<HistoryPage, AppError> {
        let skip = offset.to_string();
        let max = (limit + 1).to_string();
        let mut args: Vec<String> = vec![
            "--literal-pathspecs".into(),
            "log".into(),
            format!("--skip={skip}"),
            format!("--max-count={max}"),
            "--follow".into(),
            "--name-status".into(),
            "-z".into(),
            "--root".into(),
            "--no-color".into(),
            "--no-notes".into(),
            "--no-show-signature".into(),
            "--no-decorate".into(),
            "--encoding=UTF-8".into(),
            "--format=%x00%H%x00%P%x00%an%x00%ae%x00%at%x00%s".into(),
        ];
        if all_branches {
            args.push("--all".into());
        }
        args.push("--".into());
        args.push(path.to_string());

        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone())
            .timeout(Some(std::time::Duration::from_secs(120)));
        let out = match self.run(inv, cancel).await {
            Ok(o) => o,
            Err(err)
                if !all_branches
                    && err.exit_code == Some(128)
                    && self.head_is_unborn(cwd, cancel).await? =>
            {
                return Ok(HistoryPage {
                    commits: Vec::new(),
                    truncated: false,
                    next_offset: offset,
                });
            }
            Err(err) => return Err(err),
        };

        let mut commits = parse_file_history_z(&out.stdout, path)
            .map_err(|error| error.with_command(out.command))?;

        let truncated = commits.len() as u32 > limit;
        if truncated {
            commits.truncate(limit as usize);
        }
        Ok(HistoryPage {
            next_offset: offset + commits.len() as u32,
            truncated,
            commits,
        })
    }

    pub async fn blame_file(
        &self,
        cwd: &Path,
        path: &str,
        rev: &str,
        ignore_whitespace: bool,
        cancel: &CancellationToken,
    ) -> Result<BlameResult, AppError> {
        let mut args = vec!["blame".to_string(), "--line-porcelain".into()];
        if ignore_whitespace {
            args.push("-w".into());
        }
        if !rev.is_empty() && !rev.eq_ignore_ascii_case("WORKTREE") {
            args.push(rev.to_string());
        }
        args.push("--".into());
        args.push(path.to_string());

        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone())
            .timeout(Some(std::time::Duration::from_secs(120)));
        let out = self.run(inv, cancel).await?;

        Ok(BlameResult {
            path: path.to_string(),
            rev: if rev.is_empty() {
                "HEAD".into()
            } else {
                rev.to_string()
            },
            lines: parse_blame_porcelain(&out.stdout),
        })
    }

    pub async fn tree_list(
        &self,
        cwd: &Path,
        rev: &str,
        dir: &str,
        cancel: &CancellationToken,
    ) -> Result<Vec<TreeEntry>, AppError> {
        let prefix = if dir.is_empty() || dir == "/" {
            String::new()
        } else {
            let mut d = dir.trim_matches('/').to_string();
            if !d.ends_with('/') {
                d.push('/');
            }
            d
        };
        let spec = if prefix.is_empty() {
            rev.to_string()
        } else {
            let dir_no_slash = prefix.trim_end_matches('/');
            format!("{rev}:{dir_no_slash}")
        };
        let inv = GitInvocation::new(cwd, ["ls-tree", "-z", "--long", "--", &spec])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        Ok(parse_ls_tree_z(&out.stdout, &prefix))
    }

    pub async fn blob_read(
        &self,
        cwd: &Path,
        rev: &str,
        path: &str,
        cancel: &CancellationToken,
    ) -> Result<BlobContent, AppError> {
        let bytes = self
            .read_blob_at(cwd, rev, path, cancel)
            .await?
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::NotFound,
                    format!("file not found at {rev}: {path}"),
                )
            })?;
        let size = bytes.len() as u64;
        let binary = bytes.iter().take(8000).any(|&c| c == 0);
        let too_large = size > 5 * 1024 * 1024;
        let text = if binary || too_large {
            None
        } else {
            Some(String::from_utf8_lossy(&bytes).into_owned())
        };
        Ok(BlobContent {
            path: path.to_string(),
            rev: rev.to_string(),
            text,
            binary,
            too_large,
            size,
        })
    }

    pub async fn checkout_path_from_rev(
        &self,
        cwd: &Path,
        rev: &str,
        path: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let inv = GitInvocation::new(cwd, ["checkout", rev, "--", path])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn list_refs(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<String>, AppError> {
        let inv = GitInvocation::new(
            cwd,
            [
                "for-each-ref",
                "--format=%(refname:short)",
                "refs/heads",
                "refs/tags",
                "refs/remotes",
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        let out = match self.run(inv, cancel).await {
            Ok(o) => o,
            Err(_) => return Ok(Vec::new()),
        };
        Ok(String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect())
    }

    pub async fn git_common_dir(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<std::path::PathBuf, AppError> {
        let inv = GitInvocation::new(cwd, ["rev-parse", "--git-common-dir"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let path = std::path::PathBuf::from(&p);
        if path.is_absolute() {
            Ok(path)
        } else {
            Ok(cwd.join(path))
        }
    }

    pub async fn log_commit_details(
        &self,
        cwd: &Path,
        sha: &str,
        cancel: &CancellationToken,
    ) -> Result<CommitDetails, AppError> {
        let inv = GitInvocation::new(
            cwd,
            [
                "show",
                "-s",
                "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%b%x00%D",
                "--decorate-refs-exclude=refs/gitx/*",
                "--decorate-refs-exclude=refs/stash",
                "--decorate=short",
                "--no-show-signature",
                "--end-of-options",
                sha,
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let text = String::from_utf8_lossy(&out.stdout);
        let fields: Vec<&str> = text.trim_end_matches('\n').split('\0').collect();
        if fields.len() < 10 {
            return Err(AppError::new(
                ErrorCode::GitCommandFailed,
                "unexpected git show format",
            ));
        }
        let parents = if fields[1].is_empty() {
            Vec::new()
        } else {
            fields[1]
                .split_whitespace()
                .map(|s| s.to_string())
                .collect()
        };
        let refs = if fields.len() > 10 && !fields[10].is_empty() {
            fields[10]
                .split(", ")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        } else {
            Vec::new()
        };
        Ok(CommitDetails {
            sha: fields[0].to_string(),
            parents,
            author: fields[2].to_string(),
            author_email: fields[3].to_string(),
            author_time: fields[4].parse().unwrap_or(0),
            committer: fields[5].to_string(),
            committer_email: fields[6].to_string(),
            committer_time: fields[7].parse().unwrap_or(0),
            subject: fields[8].to_string(),
            body: fields[9].to_string(),
            refs,
        })
    }

    pub async fn commit_changed_files(
        &self,
        cwd: &Path,
        sha: &str,
        cancel: &CancellationToken,
    ) -> Result<Vec<ChangedFile>, AppError> {
        let commit = self.log_commit_details(cwd, sha, cancel).await?;
        // Match the Log's file diff: merges compare against their first parent,
        // and root commits compare against the empty tree. Plain diff-tree omits
        // both kinds; -m would instead duplicate files across all merge parents.
        let base = commit
            .parents
            .first()
            .map(String::as_str)
            .unwrap_or("EMPTY");
        self.diff_refs_name_status(cwd, base, &commit.sha, cancel)
            .await
    }

    pub async fn head_message(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let inv = GitInvocation::new(cwd, ["log", "-1", "--format=%B"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }

    pub async fn current_branch(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<BranchInfo, AppError> {
        let snap = self
            .status_get(cwd, &cwd.display().to_string(), 0, cancel)
            .await?;
        Ok(snap.branch)
    }
}

#[derive(Debug, Clone)]
pub struct RawLogCommit {
    pub sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub author_email: String,
    pub author_time: i64,
    pub subject: String,
    pub refs: Vec<String>,
}

pub(crate) fn pathspec_nul(paths: &[String]) -> Vec<u8> {
    let mut buf = Vec::new();
    for p in paths {
        buf.extend_from_slice(p.as_bytes());
        buf.push(0);
    }
    buf
}

fn looks_like_sha(s: &str) -> bool {
    let len = s.len();
    (7..=40).contains(&len) && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn parse_blame_porcelain(stdout: &[u8]) -> Vec<BlameLine> {
    let text = String::from_utf8_lossy(stdout);
    let mut lines = Vec::new();
    let mut current_sha = String::new();
    let mut author = String::new();
    let mut author_time: i64 = 0;
    let mut summary = String::new();
    let mut original_path = None;
    let mut line_no: u32 = 0;
    let mut not_committed = false;

    for raw in text.lines() {
        if raw.starts_with('\t') {
            lines.push(BlameLine {
                line: line_no,
                sha: current_sha.clone(),
                author: author.clone(),
                author_time,
                summary: summary.clone(),
                original_path: original_path.clone(),
                not_committed,
            });
            continue;
        }
        if raw.is_empty() {
            continue;
        }
        let mut parts = raw.split_whitespace();
        let first = parts.next().unwrap_or("");
        if looks_like_sha(first) && first.len() >= 40 {
            current_sha = first.to_string();
            // <sha> <orig> <final> [<num>]
            let _orig = parts.next();
            if let Some(final_line) = parts.next() {
                line_no = final_line.parse().unwrap_or(line_no + 1);
            } else {
                line_no += 1;
            }
            not_committed = current_sha.chars().all(|c| c == '0');
            continue;
        }
        if let Some(rest) = raw.strip_prefix("author ") {
            author = rest.to_string();
        } else if let Some(rest) = raw.strip_prefix("author-time ") {
            author_time = rest.parse().unwrap_or(0);
        } else if let Some(rest) = raw.strip_prefix("summary ") {
            summary = rest.to_string();
        } else if let Some(rest) = raw.strip_prefix("filename ") {
            original_path = Some(rest.to_string());
        }
    }
    lines
}

fn parse_ls_tree_z(stdout: &[u8], prefix: &str) -> Vec<TreeEntry> {
    let text = String::from_utf8_lossy(stdout);
    let mut out = Vec::new();
    for entry in text.split('\0') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        // format: <mode> <type> <object> <size>\t<name>
        let Some((meta, name)) = entry.split_once('\t') else {
            continue;
        };
        let parts: Vec<&str> = meta.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let mode = parts[0].to_string();
        let kind = parts[1].to_string();
        let sha = parts[2].to_string();
        let size = if parts.len() >= 4 && parts[3] != "-" {
            parts[3].parse().ok()
        } else {
            None
        };
        let path = format!("{prefix}{name}");
        out.push(TreeEntry {
            name: name.to_string(),
            path,
            kind,
            mode,
            size,
            sha: Some(sha),
        });
    }
    out
}

fn parse_file_history_z(stdout: &[u8], path: &str) -> Result<Vec<HistoryCommit>, AppError> {
    let invalid = || {
        AppError::new(
            ErrorCode::GitCommandFailed,
            "invalid file history output from Git",
        )
    };
    if !stdout.is_empty() && stdout.last() != Some(&0) {
        return Err(invalid());
    }
    let text = String::from_utf8_lossy(stdout);
    let fields = text.split('\0').collect::<Vec<_>>();
    let mut commits = Vec::new();
    let mut i = 0;
    // Each record starts with NUL and six header fields. Status records have
    // one path, or two for a rename/copy. Consume that arity before looking for
    // the next header; filenames may contain newlines, tabs and record separators.
    while i < fields.len() {
        while fields.get(i) == Some(&"") {
            i += 1;
        }
        if i == fields.len() {
            break;
        }
        let header = fields.get(i..i + 6).ok_or_else(invalid)?;
        if !matches!(header[0].len(), 40 | 64) || !header[0].bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(invalid());
        }
        let mut commit = HistoryCommit {
            sha: header[0].to_string(),
            short_sha: header[0].chars().take(7).collect(),
            parents: header[1].split_whitespace().map(str::to_string).collect(),
            author: header[2].to_string(),
            author_email: header[3].to_string(),
            author_time: header[4].parse().map_err(|_| invalid())?,
            subject: header[5].to_string(),
            path_at_commit: path.to_string(),
            status: None,
            orig_path: None,
        };
        i += 6;
        while let Some(raw) = fields.get(i).filter(|field| !field.is_empty()) {
            // The pretty-format/name-status boundary adds a newline. Only the
            // status token is trimmed; path and metadata bytes stay untouched.
            let status = raw.trim_start_matches('\n');
            let code = status.as_bytes().first().copied().ok_or_else(invalid)?;
            if !b"ACDMRTUXB".contains(&code)
                || !status.as_bytes()[1..].iter().all(u8::is_ascii_digit)
            {
                return Err(invalid());
            }
            i += 1;
            let first = fields
                .get(i)
                .filter(|path| !path.is_empty())
                .ok_or_else(invalid)?;
            i += 1;
            let (original, current) = if matches!(code, b'R' | b'C') {
                let second = fields
                    .get(i)
                    .filter(|path| !path.is_empty())
                    .ok_or_else(invalid)?;
                i += 1;
                (Some((*first).to_string()), *second)
            } else {
                (None, *first)
            };
            commit.status = Some(char::from(code).to_string());
            commit.path_at_commit = current.to_string();
            commit.orig_path = original;
        }
        commits.push(commit);
    }
    Ok(commits)
}

fn parse_name_status_z(stdout: &[u8]) -> Vec<ChangedFile> {
    let text = String::from_utf8_lossy(stdout);
    let parts: Vec<&str> = text.split('\0').filter(|s| !s.is_empty()).collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < parts.len() {
        let status = parts[i];
        i += 1;
        if status.starts_with('R') || status.starts_with('C') {
            if i + 1 >= parts.len() {
                break;
            }
            let orig = parts[i];
            let path = parts[i + 1];
            out.push(ChangedFile {
                path: path.to_string(),
                status: status.chars().next().unwrap_or('R').to_string(),
                orig_path: Some(orig.to_string()),
            });
            i += 2;
        } else {
            if i >= parts.len() {
                break;
            }
            out.push(ChangedFile {
                path: parts[i].to_string(),
                status: status.to_string(),
                orig_path: None,
            });
            i += 1;
        }
    }
    out
}

/// Keep pagination and navigation in exactly the same history and order.
fn append_log_filters(args: &mut Vec<String>, filters: &LogFilters) {
    match filters.order {
        LogOrder::Date => args.push("--date-order".into()),
        LogOrder::Topo => args.push("--topo-order".into()),
    }
    if filters.first_parent {
        args.push("--first-parent".into());
    }
    if filters.no_merges {
        args.push("--no-merges".into());
    }
    if let Some(since) = &filters.since {
        if !since.is_empty() {
            args.push(format!("--since={since}"));
        }
    }
    if let Some(until) = &filters.until {
        if !until.is_empty() {
            args.push(format!("--until={until}"));
        }
    }
    for author in &filters.authors {
        if !author.is_empty() {
            args.push(format!("--author={author}"));
        }
    }
    if let Some(text) = &filters.text {
        if !text.is_empty() {
            if filters.regex {
                args.push(format!("--grep={text}"));
                args.push("-E".into());
            } else {
                args.push(format!("--grep={text}"));
                args.push("-F".into());
            }
            if !filters.match_case {
                args.push("-i".into());
            }
        }
    }
    if filters.revisions.is_empty() {
        args.push("--exclude=refs/gitx/*".into());
        // Stash WIP commits (refs/stash + index/untracked parents) must not
        // pollute History — IDEA never shows them in the Log graph.
        args.push("--exclude=refs/stash".into());
        args.push("--all".into());
    }
    args.push("--end-of-options".into());
    for rev in &filters.revisions {
        if !rev.is_empty() {
            args.push(rev.clone());
        }
    }
    if !filters.paths.is_empty() {
        args.push("--".into());
        args.extend(filters.paths.iter().cloned());
    }
}
