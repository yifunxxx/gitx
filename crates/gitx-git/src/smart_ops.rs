use crate::runner::{GitInvocation, GitRunner};
use gitx_core::{AppError, ErrorCode, RepoOpKind};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Deserialize)]
struct SmartStash {
    operation: String,
    sha: String,
    #[serde(default)]
    restoration: Restoration,
}

#[derive(Default, PartialEq, Serialize, Deserialize)]
enum Restoration {
    #[default]
    Saved,
    Applying,
    Applied,
}

fn save_marker(path: &Path, stash: &SmartStash) -> Result<(), AppError> {
    let bytes = serde_json::to_vec(stash)
        .map_err(|error| AppError::new(ErrorCode::Internal, error.to_string()))?;
    let mut file = tempfile::NamedTempFile::new_in(path.parent().expect("gitx directory"))
        .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string()))?;
    file.write_all(&bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string()))?;
    file.persist(path)
        .map_err(|error| AppError::new(ErrorCode::FsError, error.error.to_string()))?;
    Ok(())
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
                match stash.restoration {
                    Restoration::Saved => format!("; local changes remain in Stash {} until the operation finishes", stash.sha),
                    Restoration::Applying => format!("; local restoration needs attention; Stash {} is retained. Inspect local changes before applying it again", stash.sha),
                    Restoration::Applied => format!("; local changes were restored; the saved Stash {} remains and must not be applied again", stash.sha),
                }
            })
            .unwrap_or_default())
    }

    /// Restore only this operation's snapshot, never whichever stash is newest.
    pub(crate) async fn finish_smart_stash(
        &self,
        cwd: &Path,
        operation: &str,
        _cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        // Once restoration starts it must not be interrupted by job cancellation.
        let recovery = CancellationToken::new();
        let Some(mut stash) = self.pending_smart_stash(cwd, &recovery).await? else {
            return Ok(());
        };
        if stash.operation != operation {
            return Ok(());
        }
        let state = self.repo_op_state(cwd, &recovery).await?;
        if state.kind != RepoOpKind::Normal || state.conflict_count > 0 {
            return Ok(());
        }
        let marker = self.smart_stash_path(cwd, &recovery).await?;
        if self
            .stash_list(cwd, &recovery)
            .await?
            .iter()
            .any(|entry| entry.sha == stash.sha)
        {
            if stash.restoration == Restoration::Applying {
                return Err(AppError::new(ErrorCode::MergeConflict,
                    format!("Local restoration needs attention. Stash {} is retained; inspect local changes before applying it again.", stash.sha)));
            }
            if stash.restoration == Restoration::Saved {
                stash.restoration = Restoration::Applying;
                save_marker(&marker, &stash)?;
                self.stash_apply(cwd, &stash.sha, true, &recovery).await.map_err(|error| {
                    AppError::new(ErrorCode::MergeConflict,
                        format!("Operation finished, but local changes could not be restored. Stash {} is retained; inspect local changes before retrying: {}", stash.sha, error.message))
                        .with_stderr(error.git_stderr.unwrap_or_default())
                })?;
                stash.restoration = Restoration::Applied;
                save_marker(&marker, &stash).map_err(|error| AppError::new(ErrorCode::FsError,
                    format!("Local changes were restored; do not apply Stash {} again. Could not record restoration: {}", stash.sha, error.message)))?;
            }
            self.stash_drop(cwd, &stash.sha, &recovery).await.map_err(|error|
                AppError::new(ErrorCode::FsError, format!("Local changes were restored; do not apply Stash {} again. Could not remove the saved copy: {}", stash.sha, error.message)))?;
        }
        fs::remove_file(marker)
            .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string()))
    }

    pub(crate) async fn with_clean_tree_inv(
        &self,
        cwd: &Path,
        operation: &str,
        inv: GitInvocation,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if cancel.is_cancelled() {
            return Err(AppError::new(
                ErrorCode::Cancelled,
                "Smart operation cancelled",
            ));
        }
        let marker = self.smart_stash_path(cwd, cancel).await?;
        if let Some(pending) = self.pending_smart_stash(cwd, cancel).await? {
            if self
                .stash_list(cwd, cancel)
                .await?
                .iter()
                .any(|entry| entry.sha == pending.sha)
            {
                let guidance = match pending.restoration {
                    Restoration::Saved => "Restore it with its index and drop it before another smart operation.",
                    Restoration::Applying => "Inspect local changes and finish recovery before another smart operation; do not blindly apply it again.",
                    Restoration::Applied => "Local changes were already restored. Remove the saved copy without applying it again.",
                };
                return Err(AppError::new(
                    ErrorCode::OperationInProgress,
                    format!(
                        "Local changes from {} remain in Stash {}. {guidance}",
                        pending.operation, pending.sha
                    ),
                ));
            }
            fs::remove_file(&marker)
                .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string()))?;
        }
        fs::create_dir_all(marker.parent().expect("gitx directory"))
            .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string()))?;
        // Save and recovery complete even if the actual operation is cancelled.
        let recovery = CancellationToken::new();
        let message = format!("gitx: {operation} {}", uuid::Uuid::new_v4());
        let stashed = match self
            .stash_create(cwd, &message, false, true, None, &recovery)
            .await
        {
            Ok(()) => {
                let sha = self.stash_list(cwd, &recovery).await?.into_iter()
                    .find(|entry| entry.message.ends_with(&format!(": {message}")))
                    .ok_or_else(|| AppError::new(ErrorCode::StashFailed,
                        format!("Cannot identify local changes saved as '{message}'. Operation was not started; check Stash.")))?.sha;
                let pending = SmartStash {
                    operation: operation.into(),
                    sha,
                    restoration: Restoration::Saved,
                };
                save_marker(&marker, &pending).map_err(|error| AppError::new(ErrorCode::FsError,
                    format!("Local changes saved in Stash {}; operation was not started because restoration could not be recorded: {}", pending.sha, error.message)))?;
                true
            }
            Err(error) if error.code == ErrorCode::NothingToCommit => false,
            Err(mut error) => {
                error.message = format!("Could not save local changes; operation was not started. Check Stash for '{message}'. {}", error.message);
                return Err(error);
            }
        };
        let result = self.run(inv, cancel).await;
        if stashed && self.repo_op_state(cwd, &recovery).await?.kind == RepoOpKind::Normal {
            self.finish_smart_stash(cwd, operation, &recovery).await?;
        }
        // Edit/conflict pauses keep the saved work separate from the sequencer's
        // index. Continue/Skip/Abort restore it only once the operation is over.
        result.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gitx_testkit::FixtureBuilder;

    #[tokio::test]
    async fn interrupted_restoration_never_reapplies_saved_work() {
        for phase in ["Applying", "Applied"] {
            let repo = FixtureBuilder::new().build("clean").unwrap();
            let cwd = repo.path();
            let runner = GitRunner::new("git");
            let cancel = CancellationToken::new();
            runner
                .run(
                    GitInvocation::new(cwd, ["config", "core.autocrlf", "false"]),
                    &cancel,
                )
                .await
                .unwrap();
            fs::write(cwd.join("README.md"), "saved work\n").unwrap();
            runner
                .stash_create(cwd, "saved", false, false, None, &cancel)
                .await
                .unwrap();
            let sha = runner.stash_list(cwd, &cancel).await.unwrap()[0]
                .sha
                .clone();
            runner.stash_apply(cwd, &sha, true, &cancel).await.unwrap();
            fs::write(cwd.join("README.md"), "user's later edits\n").unwrap();
            let marker = runner.smart_stash_path(cwd, &cancel).await.unwrap();
            fs::create_dir_all(marker.parent().unwrap()).unwrap();
            fs::write(
                &marker,
                serde_json::to_vec(&serde_json::json!({
                    "operation": "merge", "sha": sha, "restoration": phase,
                }))
                .unwrap(),
            )
            .unwrap();
            let result = runner.finish_smart_stash(cwd, "merge", &cancel).await;
            if phase == "Applying" {
                assert!(result
                    .unwrap_err()
                    .message
                    .contains("inspect local changes"));
                assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap().len(), 1);
                assert!(marker.exists());
            } else {
                result.unwrap();
                assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
                assert!(!marker.exists());
            }
            assert_eq!(
                fs::read_to_string(cwd.join("README.md")).unwrap(),
                "user's later edits\n"
            );
        }
    }

    #[tokio::test]
    async fn legacy_pending_stash_marker_still_restores() {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        runner
            .run(
                GitInvocation::new(cwd, ["config", "core.autocrlf", "false"]),
                &cancel,
            )
            .await
            .unwrap();
        fs::write(cwd.join("draft.txt"), "saved draft\n").unwrap();
        runner
            .stash_create(cwd, "saved", false, true, None, &cancel)
            .await
            .unwrap();
        let sha = runner.stash_list(cwd, &cancel).await.unwrap()[0]
            .sha
            .clone();
        let marker = runner.smart_stash_path(cwd, &cancel).await.unwrap();
        fs::create_dir_all(marker.parent().unwrap()).unwrap();
        fs::write(
            &marker,
            serde_json::to_vec(&serde_json::json!({"operation": "rebase", "sha": sha})).unwrap(),
        )
        .unwrap();
        runner
            .finish_smart_stash(cwd, "rebase", &cancel)
            .await
            .unwrap();
        assert_eq!(
            fs::read_to_string(cwd.join("draft.txt")).unwrap(),
            "saved draft\n"
        );
        assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
        assert!(!marker.exists());
    }
}
