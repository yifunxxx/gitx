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
        // %gd = stash@{n}, %H = sha, %gs = message, %ct = committer time
        let inv = GitInvocation::new(
            cwd,
            [
                "stash",
                "list",
                "-z",
                "--format=%gd%x00%H%x00%gs%x00%ct%x00%gd",
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let text = String::from_utf8_lossy(&out.stdout);
        let mut entries = Vec::new();
        for record in text.split('\0').filter(|s| !s.is_empty()) {
            // When using -z with format containing %x00, git still NUL-separates records.
            // Fallback: also support newline-separated if -z ignored.
            let _ = record;
        }
        // Prefer non -z parse for portability: stash list --format
        let inv = GitInvocation::new(cwd, ["stash", "list", "--format=%gd%x00%H%x00%gs%x00%ct"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let parts: Vec<&str> = line.split('\0').collect();
            if parts.len() < 4 {
                continue;
            }
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
            Ok(_) => Ok(()),
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

    /// Resolve stash@{n} or sha to a current stash refspec.
    async fn resolve_stash_ref(
        &self,
        cwd: &Path,
        stash_ref: &str,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        if stash_ref.starts_with("stash@{") {
            return Ok(stash_ref.to_string());
        }
        // Match by sha prefix against stash list.
        let list = self.stash_list(cwd, cancel).await?;
        if let Some(e) = list.iter().find(|e| e.sha.starts_with(stash_ref)) {
            return Ok(format!("stash@{{{}}}", e.index));
        }
        Ok(stash_ref.to_string())
    }

    pub async fn stash_apply(
        &self,
        cwd: &Path,
        stash_ref: &str,
        reinstate_index: bool,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let r = self.resolve_stash_ref(cwd, stash_ref, cancel).await?;
        let mut args = vec!["stash".into(), "apply".into()];
        if reinstate_index {
            args.push("--index".into());
        }
        args.push(r);
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(_) => Ok(()),
            Err(_e) if reinstate_index => {
                // Fall back without --index.
                let r = self.resolve_stash_ref(cwd, stash_ref, cancel).await?;
                let inv = GitInvocation::new(cwd, ["stash", "apply", &r])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                self.run(inv, cancel).await?;
                Ok(())
            }
            Err(e) => Err(e),
        }
    }

    pub async fn stash_pop(
        &self,
        cwd: &Path,
        stash_ref: &str,
        reinstate_index: bool,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let r = self.resolve_stash_ref(cwd, stash_ref, cancel).await?;
        let mut args = vec!["stash".into(), "pop".into()];
        if reinstate_index {
            args.push("--index".into());
        }
        args.push(r);
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn stash_drop(
        &self,
        cwd: &Path,
        stash_ref: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let list = self.stash_list(cwd, cancel).await?;
        let r = self.resolve_stash_ref(cwd, stash_ref, cancel).await?;
        if let Some(e) = list.iter().find(|e| format!("stash@{{{}}}", e.index) == r) {
            let backup = format!("refs/gitx/backup/stash-{}", &e.sha[..7.min(e.sha.len())]);
            let inv = GitInvocation::new(cwd, ["update-ref", &backup, &e.sha])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            let _ = self.run(inv, cancel).await;
        }
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
            let backup = format!("refs/gitx/backup/stash-{}", &e.sha[..7.min(e.sha.len())]);
            let inv = GitInvocation::new(cwd, ["update-ref", &backup, &e.sha])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            let _ = self.run(inv, cancel).await;
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
        let r = self.resolve_stash_ref(cwd, stash_ref, cancel).await?;
        let inv = GitInvocation::new(cwd, ["stash", "branch", branch, &r])
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
