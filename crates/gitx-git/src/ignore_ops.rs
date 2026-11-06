//! Ignore / exclude / stop-tracking (#115 #116 #59 #49).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode, IgnoreAddResult};
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

impl GitRunner {
    /// Status including ignored matching entries (#49).
    pub async fn status_get_with_ignored(
        &self,
        cwd: &Path,
        repo_id: &str,
        version: u64,
        include_ignored: bool,
        cancel: &CancellationToken,
    ) -> Result<gitx_core::StatusSnapshot, AppError> {
        let mut args: Vec<String> = vec![
            "-c".into(),
            "core.quotepath=false".into(),
            "-c".into(),
            "color.ui=false".into(),
            "--no-optional-locks".into(),
            "status".into(),
            "--porcelain=v2".into(),
            "-z".into(),
            "--branch".into(),
            "--show-stash".into(),
            "--untracked-files=all".into(),
        ];
        if include_ignored {
            args.push("--ignored=matching".into());
        }
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        Ok(crate::status::parse_status_porcelain_v2(
            &out.stdout, repo_id, version,
        ))
    }

    pub async fn ignore_add(
        &self,
        cwd: &Path,
        ignore_file: &Path,
        patterns: &[String],
        cancel: &CancellationToken,
    ) -> Result<IgnoreAddResult, AppError> {
        let _ = cancel;
        if patterns.is_empty() {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "no ignore patterns",
            ));
        }
        if let Some(parent) = ignore_file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::new(ErrorCode::FsError, format!("create ignore dir: {e}"))
            })?;
        }
        let mut existing = if ignore_file.exists() {
            std::fs::read_to_string(ignore_file)
                .map_err(|e| AppError::new(ErrorCode::FsError, format!("read ignore file: {e}")))?
        } else {
            String::new()
        };
        let needs_nl = !existing.is_empty() && !existing.ends_with('\n');
        if needs_nl {
            existing.push('\n');
        }
        for p in patterns {
            existing.push_str(p);
            if !p.ends_with('\n') {
                existing.push('\n');
            }
        }
        std::fs::write(ignore_file, &existing)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("write ignore file: {e}")))?;

        // Verify first pattern with check-ignore -v when possible.
        let mut verified = true;
        if let Some(first) = patterns.first() {
            // Strip leading / for a sample path check is hard; just run check-ignore on a synthetic.
            let sample = first.trim_start_matches('/').trim_end_matches('/');
            if !sample.is_empty() && !sample.contains('*') {
                let inv = GitInvocation::new(cwd, ["check-ignore", "-q", "--", sample])
                    .kind(OpKind::Read)
                    .git_bin(self.git_bin.clone());
                verified = self.run(inv, cancel).await.is_ok();
            }
        }

        Ok(IgnoreAddResult {
            ignore_file: ignore_file.display().to_string(),
            patterns: patterns.to_vec(),
            verified,
        })
    }

    pub async fn exclude_path(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<PathBuf, AppError> {
        let common = self.git_common_dir(cwd, cancel).await?;
        Ok(common.join("info").join("exclude"))
    }

    pub async fn open_or_create_exclude(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<PathBuf, AppError> {
        let path = self.exclude_path(cwd, cancel).await?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::new(ErrorCode::FsError, format!("create info dir: {e}"))
            })?;
        }
        if !path.exists() {
            std::fs::write(&path, "# git exclude — managed by gitx\n").map_err(|e| {
                AppError::new(ErrorCode::FsError, format!("create exclude: {e}"))
            })?;
        }
        Ok(path)
    }

    /// `git rm --cached` — stop tracking, keep local file (#59).
    pub async fn rm_cached(
        &self,
        cwd: &Path,
        paths: &[String],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if paths.is_empty() {
            return Ok(());
        }
        let stdin = crate::ops::pathspec_nul(paths);
        let inv = GitInvocation::new(
            cwd,
            [
                "rm",
                "-r",
                "--cached",
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

    /// Escape a path for use as a .gitignore pattern (relative to ignore file dir).
    pub fn escape_ignore_pattern(relative: &str, as_directory: bool) -> String {
        let mut out = String::new();
        // Anchor to root of the ignore file's directory with leading /
        if !relative.starts_with('/') {
            out.push('/');
        }
        for ch in relative.chars() {
            match ch {
                '#' | '!' | '[' | ']' | '*' | '?' | '\\' => {
                    out.push('\\');
                    out.push(ch);
                }
                _ => out.push(ch),
            }
        }
        if as_directory && !out.ends_with('/') {
            out.push('/');
        }
        out
    }
}
