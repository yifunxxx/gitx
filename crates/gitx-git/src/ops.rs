//! High-level git operations for M1 (status / stage / commit / log / init / diff sides).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use crate::status::parse_status_porcelain_v2;
use gitx_core::{
    AppError, BranchInfo, ChangedFile, CommitDetails, CommitResult, DiffSide, ErrorCode,
    StatusSnapshot,
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
        match side {
            DiffSide::Worktree => {
                let full = cwd.join(path);
                if !full.exists() {
                    return Ok(None);
                }
                let bytes = std::fs::read(&full).map_err(|e| {
                    AppError::new(ErrorCode::FsError, format!("read worktree file: {e}"))
                })?;
                Ok(Some(bytes))
            }
            DiffSide::Index => {
                let inv = GitInvocation::new(cwd, ["show", &format!(":{path}")])
                    .kind(OpKind::Read)
                    .git_bin(self.git_bin.clone());
                match self.run(inv, cancel).await {
                    Ok(out) => Ok(Some(out.stdout)),
                    Err(err) if err.exit_code == Some(128) => Ok(None),
                    Err(err) => Err(err),
                }
            }
            DiffSide::Head => {
                let inv = GitInvocation::new(cwd, ["show", &format!("HEAD:{path}")])
                    .kind(OpKind::Read)
                    .git_bin(self.git_bin.clone());
                match self.run(inv, cancel).await {
                    Ok(out) => Ok(Some(out.stdout)),
                    Err(err) if err.exit_code == Some(128) => Ok(None),
                    Err(err) => Err(err),
                }
            }
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
        let inv = GitInvocation::new(cwd, ["update-index", "--cacheinfo", &cacheinfo])
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
        let trimmed = message.trim();
        if trimmed.is_empty() {
            return Err(AppError::new(
                ErrorCode::EmptyCommitMessage,
                "commit message is empty",
            ));
        }

        let gitx_dir = cwd.join(".git").join("gitx");
        let _ = std::fs::create_dir_all(&gitx_dir);
        let msg_path = gitx_dir.join("COMMIT_EDITMSG");
        std::fs::write(&msg_path, format!("{trimmed}\n"))
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("write commit message: {e}")))?;

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
            sha,
            subject,
            amended: amend,
        })
    }

    pub async fn log_page(
        &self,
        cwd: &Path,
        offset: u32,
        limit: u32,
        cancel: &CancellationToken,
    ) -> Result<(Vec<RawLogCommit>, bool), AppError> {
        let skip = offset.to_string();
        let max = (limit + 1).to_string();
        // Record separator = \x1e, field sep = \x00
        let inv = GitInvocation::new(
            cwd,
            [
                "log",
                &format!("--skip={skip}"),
                &format!("--max-count={max}"),
                "--date-order",
                "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D%x1e",
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone())
        .timeout(Some(std::time::Duration::from_secs(60)));

        let out = match self.run(inv, cancel).await {
            Ok(o) => o,
            Err(err) if err.exit_code == Some(128) => {
                // unborn / no commits
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
        let inv = GitInvocation::new(
            cwd,
            [
                "diff-tree",
                "--no-commit-id",
                "--name-status",
                "-r",
                "-z",
                "-M",
                sha,
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        Ok(parse_name_status_z(&out.stdout))
    }

    pub async fn head_message(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let inv = GitInvocation::new(cwd, ["log", "-1", "--format=%B"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(out) => Ok(String::from_utf8_lossy(&out.stdout).to_string()),
            Err(_) => Ok(String::new()),
        }
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

fn pathspec_nul(paths: &[String]) -> Vec<u8> {
    let mut buf = Vec::new();
    for p in paths {
        buf.extend_from_slice(p.as_bytes());
        buf.push(0);
    }
    buf
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
