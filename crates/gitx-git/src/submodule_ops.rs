use crate::{GitInvocation, GitRunner, OpKind};
use gitx_core::{
    AppError, ErrorCode, SubmoduleUpdateItem, SubmoduleUpdatePolicy, SubmoduleUpdateResult,
};
use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

impl GitRunner {
    /// Update each module separately so nested modules get the same branch and
    /// dirty-worktree protection as top-level modules. The caller holds the
    /// scheduler's superproject scope for this complete operation.
    pub async fn submodule_update(
        &self,
        cwd: &Path,
        policy: SubmoduleUpdatePolicy,
        changed_paths: Option<&[String]>,
        cancel: &CancellationToken,
    ) -> Result<SubmoduleUpdateResult, AppError> {
        if cancel.is_cancelled() {
            return Err(AppError::new(ErrorCode::Cancelled, "operation cancelled"));
        }
        if matches!(policy, SubmoduleUpdatePolicy::Never) {
            return Ok(SubmoduleUpdateResult {
                items: Vec::new(),
                message: "Submodule update skipped (Never)".into(),
            });
        }
        let root = PathBuf::from(self.resolve_repo_root(cwd, 0, cancel).await?.worktree_root);
        let paths = self.submodule_paths(&root, cancel).await?;
        let mut pending = paths
            .into_iter()
            .filter(|path| {
                !matches!(policy, SubmoduleUpdatePolicy::Auto)
                    || changed_paths.is_none_or(|changed| {
                        changed
                            .iter()
                            .any(|item| item == path || item.starts_with(&format!("{path}/")))
                    })
            })
            .rev()
            .map(|path| (root.clone(), path.clone(), path))
            .collect::<Vec<_>>();
        let mut items = Vec::new();
        let mut visited = HashSet::new();
        while let Some((parent, path, display)) = pending.pop() {
            if cancel.is_cancelled() {
                return Err(AppError::new(ErrorCode::Cancelled, "operation cancelled"));
            }
            let sub = parent.join(&path);
            let before = match self.submodule_state(&sub, cancel).await {
                Ok(state) => state,
                Err(error) if error.code == ErrorCode::Cancelled => return Err(error),
                Err(error) => {
                    items.push(failure(display, None, None, error.message));
                    continue;
                }
            };
            let (old_sha, branch) =
                before.map_or((None, None), |(sha, branch)| (Some(sha), branch));
            if let Some(branch) = branch {
                items.push(SubmoduleUpdateItem {
                    path: display.clone(),
                    old_sha: old_sha.clone(),
                    new_sha: old_sha,
                    on_branch: Some(branch.clone()),
                    updated: false,
                    skipped: true,
                    message: format!(
                        "Submodule '{display}' is on branch '{branch}'; checkout skipped"
                    ),
                });
                continue;
            }
            let update = async {
                validate_child_path(&parent, &path).await?;
                self.run(
                    GitInvocation::new(
                        &parent,
                        [
                            "submodule",
                            "update",
                            "--init",
                            "--checkout",
                            "--progress",
                            "--",
                            &path,
                        ],
                    )
                    .kind(OpKind::NetworkWrite)
                    .timeout(Some(Duration::from_secs(300))),
                    cancel,
                )
                .await?;
                self.submodule_state(&sub, cancel).await?.ok_or_else(|| {
                    AppError::new(ErrorCode::NotARepository, "submodule was not initialized")
                })
            }
            .await;
            match update {
                Ok((new_sha, _)) => {
                    items.push(SubmoduleUpdateItem {
                        path: display.clone(),
                        old_sha,
                        new_sha: Some(new_sha),
                        on_branch: None,
                        updated: true,
                        skipped: false,
                        message: format!("Updated submodule '{display}'"),
                    });
                    let identity = tokio::fs::canonicalize(&sub).await.map_err(fs_error)?;
                    if !visited.insert(identity) {
                        continue;
                    }
                    match self.submodule_paths(&sub, cancel).await {
                        Ok(children) => {
                            for child in children.into_iter().rev() {
                                pending.push((
                                    sub.clone(),
                                    child.clone(),
                                    format!("{display}/{child}"),
                                ));
                            }
                        }
                        Err(error) if error.code == ErrorCode::Cancelled => return Err(error),
                        Err(error) => items.push(failure(
                            format!("{display}/.gitmodules"),
                            None,
                            None,
                            error.message,
                        )),
                    }
                }
                Err(error) if error.code == ErrorCode::Cancelled => return Err(error),
                Err(error) => {
                    let after = self
                        .submodule_state(&sub, cancel)
                        .await
                        .ok()
                        .flatten()
                        .map(|(sha, _)| sha);
                    items.push(failure(display, old_sha, after, error.message));
                }
            }
        }
        let updated = items.iter().filter(|item| item.updated).count();
        let skipped = items.iter().filter(|item| item.skipped).count();
        let failed = items.len() - updated - skipped;
        Ok(SubmoduleUpdateResult {
            items,
            message: format!("Submodules: {updated} updated, {skipped} skipped, {failed} failed"),
        })
    }

    async fn submodule_paths(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<String>, AppError> {
        match tokio::fs::metadata(cwd.join(".gitmodules")).await {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(fs_error(error)),
        }
        let output = match self
            .run(
                GitInvocation::new(
                    cwd,
                    [
                        "config",
                        "-z",
                        "-f",
                        ".gitmodules",
                        "--get-regexp",
                        r"^submodule\..*\.path$",
                    ],
                ),
                cancel,
            )
            .await
        {
            Ok(output) => output,
            Err(error)
                if error.exit_code == Some(1)
                    && error.git_stderr.as_deref().unwrap_or("").trim().is_empty() =>
            {
                return Ok(Vec::new())
            }
            Err(error) => return Err(error),
        };
        let text = std::str::from_utf8(&output.stdout)
            .map_err(|_| AppError::new(ErrorCode::FsError, "submodule paths are not UTF-8"))?;
        let mut seen = HashSet::new();
        let mut paths = Vec::new();
        for entry in text.split('\0').filter(|entry| !entry.is_empty()) {
            let (_, path) = entry
                .split_once('\n')
                .ok_or_else(|| AppError::new(ErrorCode::Internal, "invalid Git config output"))?;
            validate_child_path(cwd, path).await?;
            if seen.insert(path.to_owned()) {
                paths.push(path.to_owned());
            }
        }
        Ok(paths)
    }

    async fn submodule_state(
        &self,
        path: &Path,
        cancel: &CancellationToken,
    ) -> Result<Option<(String, Option<String>)>, AppError> {
        // rev-parse from an uninitialized module would otherwise walk upward
        // and return the superproject's HEAD and branch.
        match tokio::fs::symlink_metadata(path.join(".git")).await {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(fs_error(error)),
        }
        self.ensure_not_busy(path, cancel).await?;
        let output = self
            .run(
                GitInvocation::new(path, ["rev-parse", "--verify", "HEAD"]),
                cancel,
            )
            .await?;
        let sha = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let name = self.rev_parse_abbrev_public(path, "HEAD", cancel).await?;
        Ok(Some((sha, (name != "HEAD").then_some(name))))
    }
}

fn failure(
    path: String,
    old_sha: Option<String>,
    new_sha: Option<String>,
    message: String,
) -> SubmoduleUpdateItem {
    SubmoduleUpdateItem {
        path,
        old_sha,
        new_sha,
        on_branch: None,
        updated: false,
        skipped: false,
        message,
    }
}

fn fs_error(error: std::io::Error) -> AppError {
    AppError::new(ErrorCode::FsError, format!("read submodule: {error}"))
}

async fn validate_child_path(root: &Path, path: &str) -> Result<(), AppError> {
    if path.is_empty()
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            format!("invalid submodule path: {path}"),
        ));
    }
    let canonical_root = tokio::fs::canonicalize(root).await.map_err(fs_error)?;
    let target = root.join(path);
    let mut ancestor = target.clone();
    let resolved = loop {
        match tokio::fs::canonicalize(&ancestor).await {
            Ok(resolved) => break resolved,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && ancestor.pop() => {}
            Err(error) => return Err(fs_error(error)),
        }
    };
    if !resolved.starts_with(&canonical_root) || (resolved == canonical_root && ancestor == target)
    {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            format!("submodule path leaves its worktree: {path}"),
        ));
    }
    Ok(())
}
