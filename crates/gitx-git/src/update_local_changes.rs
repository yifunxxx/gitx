//! Update Project's automatic save/restore. Never pop an unrelated user stash.
use crate::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;

static SAVE_ID: AtomicU64 = AtomicU64::new(0);

const MESSAGE_PREFIX: &str = "gitx: Update Project ";

#[derive(Serialize, Deserialize)]
struct UpdateStashMarker {
    sha: String,
    message: String,
    #[serde(default)]
    phase: UpdateStashPhase,
}

#[derive(Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum UpdateStashPhase {
    /// Saved before merge/rebase/reset; not yet applied.
    #[default]
    Saved,
    /// `stash apply` conflicted; worktree already has the restore attempt.
    /// Drop once conflicts are cleared (IDEA Update Project behavior).
    AppliedNeedsDrop,
}

fn save_marker(path: &Path, marker: &UpdateStashMarker) -> Result<(), AppError> {
    let bytes = serde_json::to_vec(marker)
        .map_err(|error| AppError::new(ErrorCode::Internal, error.to_string()))?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new(ErrorCode::FsError, "missing gitx directory"))?;
    fs::create_dir_all(parent)
        .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string()))?;
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string()))?;
    file.write_all(&bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string()))?;
    file.persist(path)
        .map_err(|error| AppError::new(ErrorCode::FsError, error.error.to_string()))?;
    Ok(())
}

impl GitRunner {
    async fn update_stash_marker_path(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<PathBuf, AppError> {
        Ok(self
            .git_dir(cwd, cancel)
            .await?
            .join("gitx/update-project-stash.json"))
    }

    async fn read_update_stash_marker(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Option<(PathBuf, UpdateStashMarker)>, AppError> {
        let path = self.update_stash_marker_path(cwd, cancel).await?;
        match fs::read(&path) {
            Ok(bytes) => {
                let marker = serde_json::from_slice(&bytes)
                    .map_err(|error| AppError::new(ErrorCode::FsError, error.to_string()))?;
                Ok(Some((path, marker)))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(AppError::new(ErrorCode::FsError, error.to_string())),
        }
    }

    /// Drop an Update Project stash that was already applied with conflicts once
    /// the index is clean. Never touches user stashes or unapplied Saved markers.
    pub async fn finish_update_project_stash(
        &self,
        cwd: &Path,
        _cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let recovery = CancellationToken::new();
        let Some((path, marker)) = self.read_update_stash_marker(cwd, &recovery).await? else {
            return Ok(());
        };
        if marker.phase != UpdateStashPhase::AppliedNeedsDrop {
            return Ok(());
        }
        if !self.unmerged_paths(cwd, &recovery).await?.is_empty() {
            return Ok(());
        }
        let still_present = self
            .stash_list(cwd, &recovery)
            .await?
            .iter()
            .any(|entry| entry.sha == marker.sha);
        if still_present {
            self.stash_drop(cwd, &marker.sha, &recovery).await.map_err(|mut error| {
                error.message = format!(
                    "Conflicts are resolved, but the Update Project stash ({}) could not be removed. {}",
                    marker.sha, error.message
                );
                error
            })?;
        }
        let _ = fs::remove_file(path);
        Ok(())
    }

    pub(crate) async fn update_preserving_changes(
        &self,
        cwd: &Path,
        args: &[&str],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if cancel.is_cancelled() {
            return Err(AppError::new(ErrorCode::Cancelled, "Update cancelled"));
        }
        // Finish each save/restore even if the update is cancelled. A cancelled
        // token must not interrupt recovery after files have left the worktree.
        let recovery = CancellationToken::new();
        let message = format!(
            "{MESSAGE_PREFIX}{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            SAVE_ID.fetch_add(1, Ordering::Relaxed)
        );
        let saved = match self
            .stash_create(cwd, &message, false, true, None, &recovery)
            .await
        {
            Ok(()) => true,
            Err(error) if error.code == ErrorCode::NothingToCommit => false,
            Err(mut error) => {
                // A failed stash may still have saved a recovery copy. Do not
                // apply it over a partially cleaned worktree or run the update.
                error.message = format!("Could not save local changes; update was not started. Check Stash for '{message}'. {}", error.message);
                return Err(error);
            }
        };
        let stash = if saved {
            let entry = self.stash_list(cwd, &recovery).await?.into_iter()
                .find(|entry| entry.message.ends_with(&format!(": {message}")))
                .ok_or_else(|| AppError::new(ErrorCode::StashFailed,
                    format!("Cannot identify saved local changes '{message}'. Update was not started; check Stash.")))?;
            let marker_path = self.update_stash_marker_path(cwd, &recovery).await?;
            save_marker(
                &marker_path,
                &UpdateStashMarker {
                    sha: entry.sha.clone(),
                    message: message.clone(),
                    phase: UpdateStashPhase::Saved,
                },
            )?;
            Some((entry, marker_path))
        } else {
            None
        };
        let result = self
            .run(
                GitInvocation::new(cwd, args.iter().copied())
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await;
        let Some((stash, marker_path)) = stash else {
            return result.map(|_| ());
        };

        if let Err(mut error) = result {
            // Conflicting merge/rebase must be resolved or aborted before local
            // changes can be restored. Leave the exact saved object accessible.
            if self.ensure_not_busy(cwd, &recovery).await.is_err() {
                error.message = format!("{} Local changes are saved in Stash ({}, '{}'). Finish or abort the update, then apply that stash with Restore index enabled.", error.message, stash.sha, message);
                return Err(error);
            }
            if let Err(restore) = self
                .restore_update_changes(cwd, &stash.sha, &marker_path, &message, &recovery)
                .await
            {
                error.message = format!("{} {}", error.message, restore.message);
            }
            return Err(error);
        }
        self.restore_update_changes(cwd, &stash.sha, &marker_path, &message, &recovery)
            .await
    }

    async fn restore_update_changes(
        &self,
        cwd: &Path,
        sha: &str,
        marker_path: &Path,
        message: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        // --index preserves staged vs unstaged edits. Never retry a failed
        // application: Git may already have modified files or created conflicts.
        if let Err(mut error) = self.stash_apply(cwd, sha, true, cancel).await {
            // Apply already mutated the worktree; keep the stash until conflicts clear.
            let _ = save_marker(
                marker_path,
                &UpdateStashMarker {
                    sha: sha.into(),
                    message: message.into(),
                    phase: UpdateStashPhase::AppliedNeedsDrop,
                },
            );
            error.message = format!("Local changes need attention while restoring after Update Project. The saved copy is kept in Stash ({sha}). Resolve conflicts, or finish recovery from that stash. {}", error.message);
            return Err(error);
        }
        match self.stash_drop(cwd, sha, cancel).await {
            Ok(()) => {
                let _ = fs::remove_file(marker_path);
                Ok(())
            }
            Err(mut error) => {
                let _ = save_marker(
                    marker_path,
                    &UpdateStashMarker {
                        sha: sha.into(),
                        message: message.into(),
                        phase: UpdateStashPhase::AppliedNeedsDrop,
                    },
                );
                error.message = format!("Local changes were restored, but the saved copy remains in Stash ({sha}); do not apply it again. {}", error.message);
                Err(error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gitx_testkit::FixtureBuilder;

    #[tokio::test]
    async fn failed_command_restores_saved_changes() {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let runner = GitRunner::new("git");
        let token = CancellationToken::new();
        runner
            .run(
                GitInvocation::new(repo.path(), ["config", "core.autocrlf", "false"]),
                &token,
            )
            .await
            .unwrap();
        std::fs::write(repo.path().join("README.md"), "local draft\n").unwrap();
        assert!(runner
            .update_preserving_changes(repo.path(), &["not-a-git-command"], &token)
            .await
            .is_err());
        assert_eq!(
            std::fs::read_to_string(repo.path().join("README.md")).unwrap(),
            "local draft\n"
        );
        assert!(runner
            .stash_list(repo.path(), &token)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn cancellation_after_save_still_restores_changes() {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let runner = GitRunner::new("git");
        let token = CancellationToken::new();
        runner
            .run(
                GitInvocation::new(repo.path(), ["config", "core.autocrlf", "false"]),
                &token,
            )
            .await
            .unwrap();
        std::fs::write(repo.path().join("README.md"), "cancelled draft\n").unwrap();
        let marker = repo.path().join(".git/update-started");
        let interrupt = async {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            while !marker.exists() && std::time::Instant::now() < deadline {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
            token.cancel();
            assert!(
                marker.exists(),
                "operation must have started after saving changes"
            );
        };
        let (result, _) = tokio::join!(
            runner.update_preserving_changes(
                repo.path(),
                &[
                    "-c",
                    "alias.wait-for-cancel=!echo ready > .git/update-started; sleep 30",
                    "wait-for-cancel"
                ],
                &token
            ),
            interrupt
        );
        assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
        assert_eq!(
            std::fs::read_to_string(repo.path().join("README.md")).unwrap(),
            "cancelled draft\n"
        );
        assert!(runner
            .stash_list(repo.path(), &CancellationToken::new())
            .await
            .unwrap()
            .is_empty());
    }
}
