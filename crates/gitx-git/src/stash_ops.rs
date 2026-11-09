//! Stash list / create / apply / pop / drop / clear / branch (#112).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode, StashEntry};
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitRunner {
    pub async fn stash_list(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<StashEntry>, AppError> {
        // Four NUL-delimited fields per record, including Git's -z terminator.
        let inv = GitInvocation::new(
            cwd,
            [
                "stash",
                "list",
                "-z",
                "--no-patch",
                "--no-show-signature",
                "--no-notes",
                "--format=%gd%x00%H%x00%gs%x00%ct",
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let text = String::from_utf8_lossy(&out.stdout);
        let mut entries = Vec::new();
        let fields: Vec<_> = text.split_terminator('\0').collect();
        for parts in fields.chunks_exact(4) {
            let gd = parts[0]; // stash@{n}
            let sha = parts[1].to_string();
            let message = parts[2].to_string();
            let time: i64 = parts[3].parse().unwrap_or(0);
            let index = gd
                .trim_start_matches("stash@{")
                .trim_end_matches('}')
                .parse::<u32>()
                .unwrap_or(0);
            let branch = message
                .strip_prefix("WIP on ")
                .or_else(|| message.strip_prefix("On "))
                .and_then(|rest| rest.split(':').next())
                .map(|s| s.trim().to_string());
            entries.push(StashEntry {
                index,
                sha,
                message,
                branch,
                time,
            });
        }
        Ok(entries)
    }

    pub async fn stash_create(
        &self,
        cwd: &Path,
        message: &str,
        keep_index: bool,
        include_untracked: bool,
        paths: Option<&[String]>,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let mut args = vec![
            "stash".into(),
            "push".into(),
            "-m".into(),
            message.to_string(),
        ];
        if keep_index {
            args.push("--keep-index".into());
        }
        if include_untracked {
            args.push("--include-untracked".into());
        }
        if let Some(paths) = paths {
            if !paths.is_empty() {
                args.push("--".into());
                args.extend(paths.iter().cloned());
            }
        }
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(out) => {
                if String::from_utf8_lossy(&out.stdout).trim() == "No local changes to save" {
                    return Err(AppError::new(
                        ErrorCode::NothingToCommit,
                        "no local changes to stash",
                    ));
                }
                Ok(())
            }
            Err(e) => {
                let m = e.message.to_lowercase();
                if m.contains("no local changes") || m.contains("no changes") {
                    Err(AppError::new(
                        ErrorCode::NothingToCommit,
                        "no local changes to stash",
                    ))
                } else {
                    Err(e)
                }
            }
        }
    }

    /// Resolve a currently existing stash, rejecting stale or ambiguous inputs.
    async fn resolve_stash(
        &self,
        cwd: &Path,
        stash_ref: &str,
        cancel: &CancellationToken,
    ) -> Result<StashEntry, AppError> {
        let list = self.stash_list(cwd, cancel).await?;
        let is_sha = stash_ref.len() >= 4 && stash_ref.bytes().all(|b| b.is_ascii_hexdigit());
        let mut matches = list.into_iter().filter(|e| {
            format!("stash@{{{}}}", e.index) == stash_ref
                || (is_sha && e.sha.starts_with(&stash_ref.to_ascii_lowercase()))
        });
        if let Some(entry) = matches.next() {
            if matches.any(|other| other.sha != entry.sha) {
                return Err(AppError::new(
                    ErrorCode::InvalidArgument,
                    "ambiguous stash SHA",
                ));
            }
            return Ok(entry);
        }
        Err(AppError::new(
            ErrorCode::InvalidArgument,
            "stash no longer exists",
        ))
    }

    pub async fn stash_apply(
        &self,
        cwd: &Path,
        stash_ref: &str,
        reinstate_index: bool,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let entry = self.resolve_stash(cwd, stash_ref, cancel).await?;
        let mut args = vec!["stash".into(), "apply".into()];
        if reinstate_index {
            args.push("--index".into());
        }
        args.push(entry.sha);
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        // A failed apply may have changed the index/worktree. Never retry it.
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn stash_pop(
        &self,
        cwd: &Path,
        stash_ref: &str,
        reinstate_index: bool,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let entry = self.resolve_stash(cwd, stash_ref, cancel).await?;
        self.stash_apply(cwd, &entry.sha, reinstate_index, cancel)
            .await?;
        self.stash_drop(cwd, &entry.sha, cancel).await
    }

    pub async fn stash_drop(
        &self,
        cwd: &Path,
        stash_ref: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let entry = self.resolve_stash(cwd, stash_ref, cancel).await?;
        self.backup_stash(cwd, &entry, cancel).await?;
        let r = format!("stash@{{{}}}", entry.index);
        let inv = GitInvocation::new(cwd, ["stash", "drop", &r])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn stash_clear(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let list = self.stash_list(cwd, cancel).await?;
        for e in &list {
            self.backup_stash(cwd, e, cancel).await?;
        }
        let inv = GitInvocation::new(cwd, ["stash", "clear"])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn stash_branch(
        &self,
        cwd: &Path,
        branch: &str,
        stash_ref: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let entry = self.resolve_stash(cwd, stash_ref, cancel).await?;
        let inv = GitInvocation::new(cwd, ["stash", "branch", branch, &entry.sha])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        self.stash_drop(cwd, &entry.sha, cancel).await
    }

    async fn backup_stash(
        &self,
        cwd: &Path,
        entry: &StashEntry,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let backup = format!("refs/gitx/backup/stash-{}", entry.sha);
        let inv = GitInvocation::new(cwd, ["update-ref", &backup, &entry.sha])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn stash_restore_from_backup(
        &self,
        cwd: &Path,
        sha: &str,
        message: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let inv = GitInvocation::new(cwd, ["stash", "store", "-m", message, sha])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }
}
