use crate::runner::{GitInvocation, GitRunner};
use gitx_core::{AppError, ErrorCode, RepoOpKind};
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Deserialize)]
struct SmartStash {
    operation: String,
    sha: String,
}

impl GitRunner {
    async fn smart_stash_path(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<PathBuf, AppError> {
        Ok(self
            .git_dir(cwd, cancel)
            .await?
            .join("gitx/smart-stash.json"))
    }

    async fn pending_smart_stash(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Option<SmartStash>, AppError> {
        match fs::read(self.smart_stash_path(cwd, cancel).await?) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string())),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(AppError::new(ErrorCode::FsError, error.to_string())),
        }
    }

    pub(crate) async fn smart_stash_note(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        Ok(self
            .pending_smart_stash(cwd, cancel)
            .await?
            .map(|stash| {
                format!(
                    "; local changes remain in Stash {} until the operation finishes",
                    stash.sha
                )
            })
            .unwrap_or_default())
    }

    /// Restore only this operation's snapshot, never whichever stash is newest.
    pub(crate) async fn finish_smart_stash(
        &self,
        cwd: &Path,
        operation: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let Some(stash) = self.pending_smart_stash(cwd, cancel).await? else {
            return Ok(());
        };
        if stash.operation != operation {
            return Ok(());
        }
        if self
            .stash_list(cwd, cancel)
            .await?
            .iter()
            .any(|entry| entry.sha == stash.sha)
        {
            self.stash_pop(cwd, &stash.sha, true, cancel).await.map_err(|error| {
                AppError::new(ErrorCode::MergeConflict,
                    format!("Operation finished, but local changes could not be restored. Stash {} is retained: {}", stash.sha, error.message))
                    .with_stderr(error.git_stderr.unwrap_or_default())
            })?;
        }
        fs::remove_file(self.smart_stash_path(cwd, cancel).await?)
            .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string()))
    }

    pub(crate) async fn with_clean_tree_inv(
        &self,
        cwd: &Path,
        operation: &str,
        inv: GitInvocation,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let marker = self.smart_stash_path(cwd, cancel).await?;
        if let Some(pending) = self.pending_smart_stash(cwd, cancel).await? {
            if self
                .stash_list(cwd, cancel)
                .await?
                .iter()
                .any(|entry| entry.sha == pending.sha)
            {
                return Err(AppError::new(ErrorCode::OperationInProgress,
                    format!("Local changes from {} remain in Stash {}. Restore and drop that stash before another smart operation.", pending.operation, pending.sha)));
            }
            fs::remove_file(&marker)
                .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string()))?;
        }
        let stashed = match self
            .stash_create(
                cwd,
                &format!("gitx: {operation}"),
                false,
                true,
                None,
                cancel,
            )
            .await
        {
            Ok(()) => {
                let sha = self.rev_parse_public(cwd, "refs/stash", cancel).await?;
                let pending = SmartStash {
                    operation: operation.into(),
                    sha,
                };
                fs::create_dir_all(marker.parent().expect("gitx directory"))
                    .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string()))?;
                fs::write(&marker, serde_json::to_vec(&pending)
                    .map_err(|error| AppError::new(ErrorCode::Internal, error.to_string()))?)
                    .map_err(|error| AppError::new(ErrorCode::FsError,
                        format!("Local changes saved in Stash {}; could not record restoration: {error}", pending.sha)))?;
                true
            }
            Err(error) if error.code == ErrorCode::NothingToCommit => false,
            Err(error) => return Err(error),
        };
        let result = self.run(inv, cancel).await;
        if stashed
            && !cancel.is_cancelled()
            && self.repo_op_state(cwd, cancel).await?.kind == RepoOpKind::Normal
        {
            self.finish_smart_stash(cwd, operation, cancel).await?;
        }
        // Edit/conflict pauses keep the saved work separate from the sequencer's
        // index. Continue/Skip/Abort restore it only once the operation is over.
        result.map(|_| ())
    }
}
