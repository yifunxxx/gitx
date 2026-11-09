use crate::{GitInvocation, GitRunner};
use gitx_core::{AppError, ErrorCode, RewriteHead, RewriteOutcome, RewriteResult};
use std::{future::Future, path::Path};
use tokio_util::sync::CancellationToken;

impl GitRunner {
    pub(crate) async fn same_snapshot_trees(
        &self,
        cwd: &Path,
        original: &str,
        current: &str,
        cancel: &CancellationToken,
    ) -> Result<bool, AppError> {
        for suffix in ["^{tree}", "^2^{tree}"] {
            let original_tree = self
                .rev_parse_public(cwd, &format!("{original}{suffix}"), cancel)
                .await?;
            let current_tree = self
                .rev_parse_public(cwd, &format!("{current}{suffix}"), cancel)
                .await?;
            if original_tree != current_tree {
                return Ok(false);
            }
        }
        Ok(true)
    }

    pub(crate) async fn rebase_target_head(
        &self,
        cwd: &Path,
        branch: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        if let Some(branch) = branch {
            // Match native rebase: a local branch wins over a same-named tag.
            let invocation = GitInvocation::new(
                cwd,
                [
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    "--end-of-options",
                    &format!("refs/heads/{branch}^{{commit}}"),
                ],
            )
            .git_bin(self.git_bin.clone());
            match self.run(invocation, cancel).await {
                Ok(output) => return Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned()),
                Err(error) if error.exit_code == Some(1) => {}
                Err(error) => return Err(error),
            }
        }
        let invocation = GitInvocation::new(
            cwd,
            [
                "rev-parse",
                "--verify",
                "--end-of-options",
                &format!("{}^{{commit}}", branch.unwrap_or("HEAD")),
            ],
        )
        .git_bin(self.git_bin.clone());
        Ok(
            String::from_utf8_lossy(&self.run(invocation, cancel).await?.stdout)
                .trim()
                .to_owned(),
        )
    }

    pub(crate) async fn same_snapshot_changes(
        &self,
        cwd: &Path,
        original: &str,
        current: &str,
        cancel: &CancellationToken,
    ) -> Result<bool, AppError> {
        // A rebase can start on one branch and finish on another. Its dirty
        // snapshot then has a different base tree even when all local edits
        // are already present. Compare staged and unstaged deltas separately
        // so reapplying the snapshot cannot duplicate those edits.
        for (from, to) in [("^1", "^2"), ("^2", "")] {
            let mut patches = Vec::new();
            for snapshot in [original, current] {
                let invocation = GitInvocation::new(
                    cwd,
                    [
                        "diff",
                        "--binary",
                        "--full-index",
                        "--no-renames",
                        "--no-ext-diff",
                        "--no-textconv",
                        "--no-color",
                        "--no-relative",
                        "--ignore-submodules=none",
                        "--submodule=short",
                        &format!("{snapshot}{from}"),
                        &format!("{snapshot}{to}"),
                        "--",
                    ],
                )
                .git_bin(self.git_bin.clone());
                patches.push(self.run(invocation, cancel).await?.stdout);
            }
            if patches[0] != patches[1] {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// Called inside the repository write permit, before another app operation
    /// can change HEAD. A failed follow-up read must not misreport a completed
    /// write as failed; in that case the response simply offers no Undo action.
    pub async fn with_rewrite_undo<F>(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
        operation: F,
    ) -> Result<RewriteResult, AppError>
    where
        F: Future<Output = Result<RewriteResult, AppError>>,
    {
        let mut result = operation.await?;
        result.undo_head = None;
        // Pending/staged and no-op results did not complete a history rewrite.
        // Restoring the same HEAD cannot undo their index-only changes.
        if result.backup_ref.is_some()
            && matches!(
                result.outcome,
                RewriteOutcome::Success | RewriteOutcome::FastForward
            )
        {
            if let Ok(head) = self.rewrite_head(cwd, cancel).await {
                if head.oid == result.new_head {
                    result.undo_head = Some(head);
                }
            }
        }
        Ok(result)
    }

    pub(crate) async fn check_undo_head(
        &self,
        cwd: &Path,
        expected: &RewriteHead,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let actual = self.rewrite_head(cwd, cancel).await?;
        if actual.oid != expected.oid || actual.symbolic_ref != expected.symbolic_ref {
            return Err(AppError::new(
                ErrorCode::StaleUndo,
                "HEAD or the checked-out branch changed after this operation; the old Undo action is no longer applicable. The backup is retained.",
            ));
        }
        Ok(())
    }
}
