use crate::runner::{GitInvocation, GitRunner};
use gitx_core::{AppError, CommitResult, ErrorCode, RepoOpKind, RepoOpState, SmartRecovery};
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
    #[serde(default)]
    wait_for_commit: bool,
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
    pub(crate) async fn smart_index_changed(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<bool, AppError> {
        match self
            .run(
                GitInvocation::new(cwd, ["diff", "--cached", "--quiet", "HEAD", "--"])
                    .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await
        {
            Ok(_) => Ok(false),
            Err(error) if error.exit_code == Some(1) => Ok(true),
            Err(error) => Err(error),
        }
    }

    pub(crate) async fn smart_recovery_status(
        &self,
        cwd: &Path,
        state: &RepoOpState,
        cancel: &CancellationToken,
    ) -> Result<Option<SmartRecovery>, AppError> {
        let Some(saved) = self.pending_smart_stash(cwd, cancel).await? else {
            return Ok(None);
        };
        if !self
            .stash_list(cwd, cancel)
            .await?
            .iter()
            .any(|entry| entry.sha == saved.sha)
        {
            return Ok(None);
        }
        let pending_commit = saved.restoration == Restoration::Saved
            && saved.wait_for_commit
            && self.smart_index_changed(cwd, cancel).await?;
        let can_restore = state.kind == RepoOpKind::Normal
            && state.conflict_count == 0
            && !pending_commit
            && saved.restoration != Restoration::Applying;
        Ok(Some(SmartRecovery {
            sha: saved.sha,
            operation: saved.operation,
            phase: match saved.restoration {
                Restoration::Saved => "saved",
                Restoration::Applying => "attention",
                Restoration::Applied => "applied",
            }
            .into(),
            can_restore,
            pending_commit,
        }))
    }

    /// Explicit recovery after another client completes/aborts the operation.
    /// The expected object prevents a stale banner from recovering newer work.
    pub async fn restore_smart_changes(
        &self,
        cwd: &Path,
        expected_sha: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if cancel.is_cancelled() {
            return Err(AppError::new(ErrorCode::Cancelled, "Recovery cancelled"));
        }
        let state = self.repo_op_state_raw(cwd, cancel).await?;
        let pending = self
            .smart_recovery_status(cwd, &state, cancel)
            .await?
            .filter(|saved| saved.sha == expected_sha)
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::InvalidArgument,
                    "Saved local changes have changed; refresh before recovery",
                )
            })?;
        if !pending.can_restore {
            return Err(AppError::new(ErrorCode::OperationInProgress, "Finish the current operation or staged merge, and inspect any restoration conflict before recovering saved changes"));
        }
        self.finish_smart_stash(cwd, &pending.operation, cancel)
            .await
    }

    pub(crate) async fn restore_after_commit(
        &self,
        cwd: &Path,
        mut result: CommitResult,
    ) -> CommitResult {
        let recovery = CancellationToken::new();
        let restore = async {
            if let Some(saved) = self.pending_smart_stash(cwd, &recovery).await? {
                self.finish_smart_stash(cwd, &saved.operation, &recovery)
                    .await?;
            }
            Ok::<(), AppError>(())
        }
        .await;
        if let Err(error) = restore {
            // The commit already exists. Do not return a commit failure or
            // encourage another commit because local recovery needs attention.
            result.warning = Some(format!(
                "Commit succeeded. Local changes need attention: {}",
                error.message
            ));
        }
        result
    }

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
        let state = self.repo_op_state_raw(cwd, &recovery).await?;
        if state.kind != RepoOpKind::Normal || state.conflict_count > 0 {
            return Ok(());
        }
        if stash.restoration == Restoration::Saved
            && stash.wait_for_commit
            && self.smart_index_changed(cwd, &recovery).await?
        {
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

    /// Returns whether a squash changed the index before local work is restored.
    pub(crate) async fn run_rewrite_inv(
        &self,
        cwd: &Path,
        inv: GitInvocation,
        cancel: &CancellationToken,
    ) -> Result<bool, AppError> {
        let squash = inv.args.first().is_some_and(|arg| arg == "merge")
            && inv.args.iter().any(|arg| arg == "--squash");
        let before = if squash {
            Some(self.rev_parse_index_tree(cwd, cancel).await?)
        } else {
            None
        };
        self.run(inv, cancel).await?;
        if let Some(before) = before {
            return Ok(before != self.rev_parse_index_tree(cwd, cancel).await?);
        }
        Ok(false)
    }

    async fn rev_parse_index_tree(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<u8>, AppError> {
        Ok(self
            .run(
                GitInvocation::new(cwd, ["write-tree"]).git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?
            .stdout)
    }

    pub(crate) async fn with_clean_tree_inv(
        &self,
        cwd: &Path,
        operation: &str,
        inv: GitInvocation,
        cancel: &CancellationToken,
    ) -> Result<bool, AppError> {
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
        let wait_for_commit = operation == "merge"
            && inv
                .args
                .iter()
                .any(|arg| arg == "--squash" || arg == "--no-commit");
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
                    wait_for_commit,
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
        let result = self.run_rewrite_inv(cwd, inv, cancel).await;
        if stashed && self.repo_op_state_raw(cwd, &recovery).await?.kind == RepoOpKind::Normal {
            self.finish_smart_stash(cwd, operation, &recovery).await?;
        }
        // Edit/conflict pauses keep the saved work separate from the sequencer's
        // index. Continue/Skip/Abort restore it only once the operation is over.
        result
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
