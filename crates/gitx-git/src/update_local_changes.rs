//! Update Project's automatic save/restore. Never pop an unrelated user stash.
use crate::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode};
use std::{
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;

static SAVE_ID: AtomicU64 = AtomicU64::new(0);

impl GitRunner {
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
            "gitx: Update Project {}-{}-{}",
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
            Some(self.stash_list(cwd, &recovery).await?.into_iter()
                .find(|entry| entry.message.ends_with(&format!(": {message}")))
                .ok_or_else(|| AppError::new(ErrorCode::StashFailed,
                    format!("Cannot identify saved local changes '{message}'. Update was not started; check Stash.")))?)
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
        let Some(stash) = stash else {
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
                .restore_update_changes(cwd, &stash.sha, &recovery)
                .await
            {
                error.message = format!("{} {}", error.message, restore.message);
            }
            return Err(error);
        }
        self.restore_update_changes(cwd, &stash.sha, &recovery)
            .await
    }

    async fn restore_update_changes(
        &self,
        cwd: &Path,
        sha: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        // --index preserves staged vs unstaged edits. Never retry a failed
        // application: Git may already have modified files or created conflicts.
        self.stash_apply(cwd, sha, true, cancel).await.map_err(|mut error| {
            error.message = format!("Local changes need attention while restoring after Update Project. The saved copy is kept in Stash ({sha}). Resolve conflicts, or finish recovery from that stash. {}", error.message);
            error
        })?;
        self.stash_drop(cwd, sha, cancel).await.map_err(|mut error| {
            error.message = format!("Local changes were restored, but the saved copy remains in Stash ({sha}); do not apply it again. {}", error.message);
            error
        })
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
