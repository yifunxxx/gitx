//! Create / apply patch files (#101).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode, PatchCreateResult};
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

impl GitRunner {
    pub async fn patch_create(
        &self,
        cwd: &Path,
        paths: &[String],
        output: &Path,
        base: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<PatchCreateResult, AppError> {
        let base = base.unwrap_or("HEAD");
        let mut args = vec!["diff".into(), "--binary".into(), base.to_string(), "--".into()];
        if paths.is_empty() {
            // All local changes vs base.
        } else {
            args.extend(paths.iter().cloned());
        }
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::new(ErrorCode::FsError, format!("create patch dir: {e}")))?;
        }
        std::fs::write(output, &out.stdout)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("write patch: {e}")))?;
        Ok(PatchCreateResult {
            path: output.display().to_string(),
            bytes: out.stdout.len() as u64,
        })
    }

    pub async fn patch_apply(
        &self,
        cwd: &Path,
        patch_file: &Path,
        three_way: bool,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let mut args = vec!["apply".into(), "--whitespace=nowarn".into()];
        if three_way {
            args.push("--3way".into());
        }
        args.push(patch_file.display().to_string());
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(_) => Ok(()),
            Err(e) => Err(AppError::new(
                ErrorCode::PatchFailed,
                format!("apply patch failed: {}", e.message),
            )
            .with_stderr(e.git_stderr.unwrap_or_default())
            .with_exit_code(e.exit_code.unwrap_or(1))),
        }
    }

    pub async fn patch_apply_clipboard(
        &self,
        cwd: &Path,
        patch_text: &str,
        three_way: bool,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let git_dir = self.git_dir(cwd, cancel).await?;
        let tmp = git_dir.join("gitx").join("clipboard.patch");
        if let Some(parent) = tmp.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(&tmp, patch_text)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("write clipboard patch: {e}")))?;
        let result = self.patch_apply(cwd, &tmp, three_way, cancel).await;
        let _ = std::fs::remove_file(&tmp);
        result
    }

    pub async fn default_patch_path(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<PathBuf, AppError> {
        let git_dir = self.git_dir(cwd, cancel).await?;
        Ok(git_dir.join("gitx").join("changes.patch"))
    }
}
