use crate::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode, MultiRootOpResult, MultiRootOpStep, RewriteHead};
use std::{collections::HashSet, path::Path};
use tokio_util::sync::CancellationToken;

fn same_head(a: &RewriteHead, b: &RewriteHead) -> bool {
    a.oid == b.oid && a.symbolic_ref == b.symbolic_ref
}

fn initial_step(path: &str) -> MultiRootOpStep {
    MultiRootOpStep {
        repo_id: path.into(),
        path: path.into(),
        ok: false,
        previous_ref: None,
        error: None,
        skipped: false,
        previous_head: None,
        checkout_head: None,
        rolled_back: false,
        rollback_error: None,
    }
}

impl GitRunner {
    /// The caller holds every repository permit until checkout and recovery
    /// finish. Each step retains both exact HEAD identities for safe retries.
    pub async fn multi_root_checkout(
        &self,
        roots: &[String],
        target: &str,
        mode: &str,
        rollback_on_fail: bool,
        cancel: &CancellationToken,
    ) -> Result<MultiRootOpResult, AppError> {
        if cancel.is_cancelled() {
            return Err(AppError::new(ErrorCode::Cancelled, "operation cancelled"));
        }
        let target = if mode == "local" {
            target.strip_prefix("refs/heads/").unwrap_or(target)
        } else {
            target
        };
        if !matches!(mode, "local" | "remote" | "revision")
            || target.is_empty()
            || target.starts_with('-')
        {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "invalid checkout target or mode",
            ));
        }
        let mut steps = Vec::new();
        let mut seen = HashSet::new();
        for path in roots {
            let mut step = initial_step(path);
            let operation = async {
                let root = self.resolve_repo_root(Path::new(path), 0, cancel).await?;
                // Worktree identity, rather than common-dir: linked worktrees
                // have separate HEADs, while repeated paths must run once.
                let identity = tokio::fs::canonicalize(&root.worktree_root)
                    .await
                    .map_err(|e| AppError::new(ErrorCode::FsError, e.to_string()))?;
                let identity = gitx_core::host_path_key(&identity.to_string_lossy());
                if !seen.insert(identity) {
                    return Ok(false);
                }
                step.path = root.worktree_root;
                step.repo_id = root.id;
                let cwd = Path::new(&step.path);
                let before = self.rewrite_head(cwd, cancel).await?;
                step.previous_ref = Some(
                    before
                        .symbolic_ref
                        .as_deref()
                        .and_then(|name| name.strip_prefix("refs/heads/"))
                        .unwrap_or(&before.oid)
                        .to_owned(),
                );
                step.previous_head = Some(before.clone());
                step.checkout_head = Some(before);
                if mode == "local" {
                    let branch = format!("refs/heads/{target}");
                    let check = self
                        .run(
                            GitInvocation::new(cwd, ["show-ref", "--verify", "--quiet", &branch]),
                            cancel,
                        )
                        .await;
                    match check {
                        Ok(_) => {}
                        Err(error)
                            if error.exit_code == Some(1)
                                && error.git_stderr.as_deref().unwrap_or("").trim().is_empty() =>
                        {
                            step.ok = true;
                            step.skipped = true;
                            step.error = Some(format!("skipped — branch '{target}' not present"));
                            return Ok(true);
                        }
                        Err(error) => return Err(error),
                    }
                }
                self.ensure_not_busy(cwd, cancel).await?;
                let checkout = self
                    .branch_checkout_single_root(cwd, target, mode, cancel)
                    .await;
                // A post-checkout hook can fail after Git has moved HEAD.
                // Observe that result even when the operation was cancelled.
                let recovery = CancellationToken::new();
                step.checkout_head = self.rewrite_head(cwd, &recovery).await.ok();
                checkout?;
                if step.checkout_head.is_none() {
                    return Err(AppError::new(
                        ErrorCode::MultiRootFailed,
                        "checkout finished but its HEAD could not be verified",
                    ));
                }
                step.ok = true;
                Ok(true)
            }
            .await;
            match operation {
                Ok(false) => continue,
                Ok(true) => steps.push(step),
                Err(error) => {
                    step.error = Some(error.message);
                    steps.push(step);
                    let mut rolled_back = false;
                    if rollback_on_fail {
                        // Cancellation stops new checkouts, but recovery of
                        // completed steps still gets its own bounded commands.
                        let recovery = CancellationToken::new();
                        let recovery_result = self.multi_root_rollback(&steps, &recovery).await?;
                        rolled_back = recovery_result.rolled_back;
                        steps = recovery_result.steps;
                    }
                    return Ok(MultiRootOpResult {
                        ok: false,
                        steps,
                        rolled_back,
                    });
                }
            }
        }
        Ok(MultiRootOpResult {
            ok: true,
            steps,
            rolled_back: false,
        })
    }

    /// Roll back only changed roots, without overriding later user actions.
    /// Original checkout errors are retained separately from recovery errors.
    pub async fn multi_root_rollback(
        &self,
        steps: &[MultiRootOpStep],
        cancel: &CancellationToken,
    ) -> Result<MultiRootOpResult, AppError> {
        let mut out = steps.to_vec();
        let mut complete = true;
        for step in out.iter_mut().rev() {
            if step.skipped
                || step.rolled_back
                || step
                    .error
                    .as_deref()
                    .is_some_and(|e| e.starts_with("skipped"))
            {
                continue;
            }
            step.rollback_error = None;
            if step.previous_head.is_none()
                && step.checkout_head.is_none()
                && step.previous_ref.is_none()
            {
                // Discovery or initial HEAD capture failed before any checkout.
                continue;
            }
            match self.restore_checkout_step(step, cancel).await {
                Ok(()) => step.rolled_back = true,
                Err(error) => {
                    complete = false;
                    step.rollback_error = Some(error.message);
                }
            }
        }
        Ok(MultiRootOpResult {
            ok: complete,
            steps: out,
            rolled_back: complete,
        })
    }

    async fn restore_checkout_step(
        &self,
        step: &MultiRootOpStep,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let before = step.previous_head.as_ref().ok_or_else(|| {
            AppError::new(
                ErrorCode::MultiRootFailed,
                "rollback requires the original HEAD identity",
            )
        })?;
        let after = step.checkout_head.as_ref().ok_or_else(|| {
            AppError::new(
                ErrorCode::MultiRootFailed,
                "checkout HEAD is unknown; inspect the repository before recovery",
            )
        })?;
        let cwd = Path::new(&step.path);
        let current = self.rewrite_head(cwd, cancel).await?;
        if same_head(&current, before) {
            return Ok(());
        }
        if !same_head(&current, after) {
            return Err(AppError::new(
                ErrorCode::StaleUndo,
                "HEAD or the current branch changed after checkout; rollback refused",
            ));
        }
        self.ensure_not_busy(cwd, cancel).await?;
        let args = if let Some(reference) = &before.symbolic_ref {
            let branch = reference.strip_prefix("refs/heads/").ok_or_else(|| {
                AppError::new(
                    ErrorCode::InvalidArgument,
                    "rollback requires a local branch",
                )
            })?;
            let tip = self.rev_parse_public(cwd, reference, cancel).await?;
            if tip != before.oid {
                return Err(AppError::new(
                    ErrorCode::StaleUndo,
                    "the original branch changed after checkout; rollback refused",
                ));
            }
            vec![
                "checkout",
                "--no-recurse-submodules",
                "--no-guess",
                branch,
                "--",
            ]
        } else {
            vec![
                "checkout",
                "--no-recurse-submodules",
                "--detach",
                &before.oid,
                "--",
            ]
        };
        self.run(GitInvocation::new(cwd, args).kind(OpKind::Write), cancel)
            .await?;
        if !same_head(&self.rewrite_head(cwd, cancel).await?, before) {
            return Err(AppError::new(
                ErrorCode::MultiRootFailed,
                "rollback completed but the original HEAD was not restored",
            ));
        }
        Ok(())
    }
}
