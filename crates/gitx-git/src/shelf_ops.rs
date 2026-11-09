//! Shelve / unshelve using gitx-meta shelf storage (#111).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode, ShelfEntry};
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitRunner {
    async fn shelf_base(&self, cwd: &Path, cancel: &CancellationToken) -> Result<String, AppError> {
        match self
            .run(
                GitInvocation::new(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]),
                cancel,
            )
            .await
        {
            Ok(out) => Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned()),
            Err(error) if error.exit_code == Some(1) => {
                // Only an unborn symbolic HEAD may use an empty tree. Broken
                // refs, cancellation and process failures must remain errors.
                let head = self
                    .run(
                        GitInvocation::new(cwd, ["symbolic-ref", "--quiet", "HEAD"]),
                        cancel,
                    )
                    .await?;
                let head = String::from_utf8_lossy(&head.stdout);
                match self
                    .run(
                        GitInvocation::new(cwd, ["show-ref", "--verify", "--quiet", head.trim()]),
                        cancel,
                    )
                    .await
                {
                    Err(missing) if missing.exit_code == Some(1) => {
                        let out = self
                            .run(
                                GitInvocation::new(
                                    cwd,
                                    ["hash-object", "-t", "tree", "-w", "--stdin"],
                                )
                                .stdin(Vec::new())
                                .kind(OpKind::Write),
                                cancel,
                            )
                            .await?;
                        Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
                    }
                    Err(other) => Err(other),
                    Ok(_) => Err(error),
                }
            }
            Err(error) => Err(error),
        }
    }

    async fn shelf_diff(
        &self,
        cwd: &Path,
        base: Option<&str>,
        cached: bool,
        paths: &[String],
        cancel: &CancellationToken,
    ) -> Result<Vec<u8>, AppError> {
        let mut args: Vec<String> = [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--no-renames",
            "--no-relative",
            "--binary",
            "--full-index",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "--ignore-submodules=none",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();
        if cached {
            args.push("--cached".into());
        }
        if let Some(base) = base {
            args.push(base.into());
        }
        args.push("--".into());
        args.extend(paths.iter().map(|p| format!(":(top,literal){p}")));
        Ok(self
            .run(GitInvocation::new(cwd, args), cancel)
            .await?
            .stdout)
    }

    async fn shelf_patch_paths(
        &self,
        cwd: &Path,
        patch: &[u8],
        cancel: &CancellationToken,
    ) -> Result<Vec<String>, AppError> {
        if patch.is_empty() {
            return Ok(Vec::new());
        }
        // Derive metadata from the exact saved patch rather than a second diff
        // that may observe different working files. -z preserves unusual names.
        let out = self
            .run(
                GitInvocation::new(cwd, ["apply", "--numstat", "-z", "-"]).stdin(patch.to_vec()),
                cancel,
            )
            .await?;
        let text = std::str::from_utf8(&out.stdout).map_err(|_| {
            AppError::new(
                ErrorCode::InvalidArgument,
                "Shelf requires UTF-8 file paths",
            )
        })?;
        let mut paths = Vec::new();
        for record in text.split_terminator('\0') {
            let path = record
                .splitn(3, '\t')
                .nth(2)
                .filter(|p| !p.is_empty())
                .ok_or_else(|| AppError::new(ErrorCode::ShelfFailed, "invalid Shelf patch path"))?;
            paths.push(path.to_owned());
        }
        paths.sort();
        paths.dedup();
        Ok(paths)
    }

    async fn check_shelf_untracked(
        &self,
        cwd: &Path,
        paths: &[String],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let mut args: Vec<String> = ["ls-files", "--others", "-z", "--"]
            .into_iter()
            .map(str::to_owned)
            .collect();
        args.extend(paths.iter().map(|p| format!(":(top,literal){p}")));
        let out = self.run(GitInvocation::new(cwd, args), cancel).await?;
        // Include ignored files too. A staged deletion may have been replaced
        // by an untracked file or directory that restore would overwrite.
        if !out.stdout.is_empty() {
            return Err(AppError::new(ErrorCode::UntrackedWouldBeOverwritten,
                "An untracked file occupies a shelved path; keep local changes or move it before shelving"));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn shelve_changes(
        &self,
        cwd: &Path,
        message: &str,
        paths: &[String],
        keep_changes: bool,
        source_changelist: Option<&str>,
        system: bool,
        cancel: &CancellationToken,
    ) -> Result<ShelfEntry, AppError> {
        if paths.is_empty() {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "no paths to shelve",
            ));
        }
        for path in paths {
            if path.is_empty()
                || path.contains('\0')
                || Path::new(path)
                    .components()
                    .any(|p| !matches!(p, std::path::Component::Normal(_)))
            {
                return Err(AppError::new(
                    ErrorCode::InvalidArgument,
                    "Shelf requires repository-relative paths",
                ));
            }
        }
        let common = self.git_common_dir(cwd, cancel).await?;
        let base_sha = self.shelf_base(cwd, cancel).await?;
        let index_patch = self
            .shelf_diff(cwd, Some(&base_sha), true, paths, cancel)
            .await?;
        if !keep_changes && !index_patch.is_empty() {
            let staged = self.shelf_patch_paths(cwd, &index_patch, cancel).await?;
            let unstaged = self.shelf_diff(cwd, None, false, &staged, cancel).await?;
            if !unstaged.is_empty() {
                return Err(AppError::new(ErrorCode::ShelfFailed,
                    "Cannot remove partially staged changes: stage or unstage these files first, or keep local changes"));
            }
        }
        let patch = self
            .shelf_diff(cwd, Some(&base_sha), false, paths, cancel)
            .await?;
        if patch.is_empty() {
            return Err(AppError::new(
                ErrorCode::NothingToCommit,
                "no tracked changes to shelve",
            ));
        }
        let changed_paths = self.shelf_patch_paths(cwd, &patch, cancel).await?;
        if changed_paths.is_empty() {
            return Err(AppError::new(
                ErrorCode::ShelfFailed,
                "Shelf patch contains no file changes",
            ));
        }
        if !keep_changes {
            self.check_shelf_untracked(cwd, &changed_paths, cancel)
                .await?;
        }
        let binary = patch
            .windows(b"GIT binary patch".len())
            .any(|w| w == b"GIT binary patch");
        // Keep the base reachable before publishing the patch. Failures here
        // must not allow working files or staged content to be removed.
        let keepalive = format!("refs/gitx/shelf-base-{base_sha}");
        self.run(
            GitInvocation::new(cwd, ["update-ref", &keepalive, &base_sha]).kind(OpKind::Write),
            cancel,
        )
        .await?;
        let entry = gitx_meta::create_shelf_entry(
            &common,
            message,
            &base_sha,
            &changed_paths,
            &patch,
            source_changelist,
            binary,
            system,
        )?;

        // Keepalive ref per shelf id.
        let shelf_ref = format!("refs/gitx/shelf/{}", entry.id);
        let inv = GitInvocation::new(cwd, ["update-ref", &shelf_ref, &base_sha])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;

        if !keep_changes {
            // A hook/editor may have changed data while the Shelf was saved.
            // Keep both versions rather than clearing data absent from the patch.
            let saved = async {
                if self
                    .shelf_diff(cwd, Some(&base_sha), false, paths, cancel)
                    .await?
                    != patch
                    || self
                        .shelf_diff(cwd, Some(&base_sha), true, paths, cancel)
                        .await?
                        != index_patch
                {
                    return Err(AppError::new(
                        ErrorCode::ShelfFailed,
                        "local changes changed while saving the Shelf; nothing was removed",
                    ));
                }
                self.check_shelf_untracked(cwd, &changed_paths, cancel)
                    .await?;
                let literal_paths: Vec<_> = changed_paths
                    .iter()
                    .map(|p| format!(":(top,literal){p}"))
                    .collect();
                self.run(
                    GitInvocation::new(
                        cwd,
                        [
                            "restore",
                            &format!("--source={base_sha}"),
                            "--staged",
                            "--worktree",
                            "--pathspec-from-file=-",
                            "--pathspec-file-nul",
                        ],
                    )
                    .stdin(crate::ops::pathspec_nul(&literal_paths))
                    .kind(OpKind::Write),
                    cancel,
                )
                .await?;
                Ok::<_, AppError>(())
            }
            .await;
            saved.map_err(|mut error| {
                error.message = format!(
                    "Shelf {} was saved, but local changes could not be removed: {}",
                    entry.id, error.message
                );
                error
            })?;
        }

        Ok(entry)
    }

    pub async fn unshelve(
        &self,
        cwd: &Path,
        shelf_id: &str,
        remove_applied: bool,
        cancel: &CancellationToken,
    ) -> Result<(Vec<String>, Vec<String>), AppError> {
        let common = self.git_common_dir(cwd, cancel).await?;
        let meta = gitx_meta::load_shelf_meta(&common, shelf_id)?;
        let patch = gitx_meta::read_shelf_patch(&common, shelf_id)?;
        if patch.is_empty() {
            return Err(AppError::new(
                ErrorCode::NothingToCommit,
                "shelf patch is empty",
            ));
        }
        // Three-way apply either succeeds or leaves Git's conflict state for
        // resolution. Never overwrite local files through a reconstruction
        // fallback, and never consume the shelf after an unsuccessful apply.
        let inv = GitInvocation::new(cwd, ["apply", "--3way", "--whitespace=nowarn", "-"])
            .stdin(patch)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        let applied = meta.paths;
        if remove_applied && !applied.is_empty() {
            gitx_meta::remove_paths_from_shelf(&common, shelf_id, &applied)?;
        }
        Ok((applied, Vec::new()))
    }
    pub async fn shelf_list(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<ShelfEntry>, AppError> {
        let common = self.git_common_dir(cwd, cancel).await?;
        gitx_meta::list_shelf(&common)
    }

    pub async fn shelf_list_deleted(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<ShelfEntry>, AppError> {
        let common = self.git_common_dir(cwd, cancel).await?;
        gitx_meta::list_deleted_shelf(&common)
    }

    pub async fn shelf_delete(
        &self,
        cwd: &Path,
        id: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let common = self.git_common_dir(cwd, cancel).await?;
        gitx_meta::soft_delete_shelf(&common, id)?;
        let shelf_ref = format!("refs/gitx/shelf/{id}");
        let inv = GitInvocation::new(cwd, ["update-ref", "-d", &shelf_ref])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        let _ = self.run(inv, cancel).await;
        Ok(())
    }

    pub async fn shelf_restore(
        &self,
        cwd: &Path,
        id: &str,
        cancel: &CancellationToken,
    ) -> Result<ShelfEntry, AppError> {
        let common = self.git_common_dir(cwd, cancel).await?;
        gitx_meta::restore_shelf(&common, id)
    }

    pub async fn shelf_rename(
        &self,
        cwd: &Path,
        id: &str,
        message: &str,
        cancel: &CancellationToken,
    ) -> Result<ShelfEntry, AppError> {
        let common = self.git_common_dir(cwd, cancel).await?;
        gitx_meta::rename_shelf(&common, id, message)
    }

    pub async fn shelf_import_patch(
        &self,
        cwd: &Path,
        patch_file: &Path,
        message: &str,
        cancel: &CancellationToken,
    ) -> Result<ShelfEntry, AppError> {
        let common = self.git_common_dir(cwd, cancel).await?;
        let patch = std::fs::read(patch_file)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("read patch: {e}")))?;
        let base_sha = match self
            .run(
                GitInvocation::new(cwd, ["rev-parse", "HEAD"])
                    .kind(OpKind::Read)
                    .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await
        {
            Ok(out) => String::from_utf8_lossy(&out.stdout).trim().to_string(),
            Err(_) => "4b825dc642cb6eb9a060e54bf8d69257bf5ff90".into(),
        };
        // Best-effort path extraction from patch headers.
        let text = String::from_utf8_lossy(&patch);
        let mut paths = Vec::new();
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("+++ b/") {
                paths.push(rest.to_string());
            }
        }
        paths.sort();
        paths.dedup();
        gitx_meta::create_shelf_entry(
            &common,
            message,
            &base_sha,
            &paths,
            &patch,
            None,
            text.contains("GIT binary patch"),
            false,
        )
    }
}
