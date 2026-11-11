//! Export the saved Shelf snapshot without recomputing a working-tree diff.

use crate::GitRunner;
use gitx_core::{AppError, ErrorCode, PatchCreateResult};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

fn fs_error(action: &str, error: std::io::Error) -> AppError {
    AppError::new(ErrorCode::FsError, format!("{action}: {error}"))
}

fn invalid(message: &str) -> AppError {
    AppError::new(ErrorCode::InvalidArgument, message)
}

fn check_target(output: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(output) {
        Ok(meta) => {
            #[cfg(windows)]
            let link = {
                use std::os::windows::fs::MetadataExt;
                meta.file_attributes() & 0x400 != 0
            };
            #[cfg(not(windows))]
            let link = meta.file_type().is_symlink();
            if link || !meta.is_file() || meta.permissions().readonly() {
                return Err(invalid("patch destination must be a writable regular file"));
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(fs_error("inspect patch destination", error)),
    }
}

fn export_snapshot(
    common: &Path,
    git_dir: &Path,
    id: &str,
    output: &Path,
    cancel: &CancellationToken,
) -> Result<PatchCreateResult, AppError> {
    if !output.is_absolute() {
        return Err(invalid("patch destination must be an absolute file path"));
    }
    let name = output
        .file_name()
        .ok_or_else(|| invalid("patch destination must name a file"))?;
    #[cfg(windows)]
    if name.to_string_lossy().contains(':') {
        return Err(invalid(
            "patch destination cannot be an alternate data stream",
        ));
    }
    let parent = fs::canonicalize(
        output
            .parent()
            .ok_or_else(|| invalid("patch destination must have a parent directory"))?,
    )
    .map_err(|e| fs_error("resolve patch destination", e))?;
    let target = parent.join(name);
    let common =
        fs::canonicalize(common).map_err(|e| fs_error("resolve Git common directory", e))?;
    let git_dir = fs::canonicalize(git_dir).map_err(|e| fs_error("resolve Git directory", e))?;
    // Resolve directory aliases before checking. This also protects linked
    // worktree metadata and repositories with a separate Git directory.
    if target.starts_with(&common)
        || target.starts_with(&git_dir)
        || target.components().any(|part| {
            part.as_os_str()
                .to_string_lossy()
                .trim_end_matches([' ', '.'])
                .eq_ignore_ascii_case(".git")
        })
    {
        return Err(invalid("patch destination cannot overwrite Git metadata"));
    }
    check_target(&target)?;
    let (_, patch) = gitx_meta::load_shelf_snapshot(&common, id)?;
    if cancel.is_cancelled() {
        return Err(AppError::new(ErrorCode::Cancelled, "cancelled"));
    }
    // Stage beside the output, flush, then replace it in one filesystem step.
    // Dropping a failed/cancelled export removes the temporary file.
    let mut temp = tempfile::Builder::new()
        .prefix(".gitx-patch-")
        .tempfile_in(&parent)
        .map_err(|e| fs_error("prepare patch export", e))?;
    temp.write_all(&patch)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| fs_error("write patch export", e))?;
    if cancel.is_cancelled() {
        return Err(AppError::new(ErrorCode::Cancelled, "cancelled"));
    }
    check_target(&target)?;
    temp.persist(&target)
        .map_err(|e| fs_error("publish patch export", e.error))?;
    Ok(PatchCreateResult {
        path: output.display().to_string(),
        bytes: patch.len() as u64,
    })
}

impl GitRunner {
    pub async fn shelf_preview(
        &self,
        cwd: &Path,
        id: &str,
        deleted: bool,
        cancel: &CancellationToken,
    ) -> Result<gitx_core::ShelfPreview, AppError> {
        let common = self.git_common_dir(cwd, cancel).await?;
        let id = id.to_owned();
        let cancel = cancel.clone();
        tokio::task::spawn_blocking(move || {
            if cancel.is_cancelled() {
                return Err(AppError::new(ErrorCode::Cancelled, "cancelled"));
            }
            gitx_meta::preview_shelf(&common, &id, deleted)
        })
        .await
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("Shelf preview task: {e}")))?
    }

    pub async fn shelf_export_patch(
        &self,
        cwd: &Path,
        id: &str,
        output: &Path,
        cancel: &CancellationToken,
    ) -> Result<PatchCreateResult, AppError> {
        let common = self.git_common_dir(cwd, cancel).await?;
        let git_dir = self.git_dir(cwd, cancel).await?;
        let id = id.to_owned();
        let output = PathBuf::from(output);
        let cancel = cancel.clone();
        tokio::task::spawn_blocking(move || {
            export_snapshot(&common, &git_dir, &id, &output, &cancel)
        })
        .await
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("patch export task: {e}")))?
    }
}
