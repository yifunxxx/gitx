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
                // Only an unborn symbolic HEAD can use an empty tree. Do not
                // hide a broken ref, cancellation, timeout or process failure.
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
                        self.empty_tree(cwd, cancel).await
                    }
                    Err(other) => Err(other),
                    Ok(_) => Err(error),
                }
            }
            Err(error) => Err(error),
        }
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
        let common = self.git_common_dir(cwd, cancel).await?;

        let base_sha = self.shelf_base(cwd, cancel).await?;

        // Ensure base blobs stay reachable.
        let keepalive = format!("refs/gitx/shelf-base-{base_sha}");
        let inv = GitInvocation::new(cwd, ["update-ref", &keepalive, &base_sha])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;

        // Binary-aware diff.
        let mut args = vec![
            "diff".into(),
            "--no-ext-diff".into(),
            "--no-textconv".into(),
            "--binary".into(),
            "--full-index".into(),
            base_sha.clone(),
            "--".into(),
        ];
        args.extend(paths.iter().cloned());
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let diff_out = self.run(inv, cancel).await?;
        if diff_out.stdout.is_empty() {
            return Err(AppError::new(
                ErrorCode::NothingToCommit,
                "no tracked changes to shelve",
            ));
        }
        let mut args = vec![
            "diff".into(),
            "--name-only".into(),
            "-z".into(),
            "--no-renames".into(),
            base_sha.clone(),
            "--".into(),
        ];
        args.extend(paths.iter().cloned());
        let changed = self
            .run(
                GitInvocation::new(cwd, args).git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?;
        let changed_paths: Vec<String> = String::from_utf8_lossy(&changed.stdout)
            .split('\0')
            .filter(|path| !path.is_empty())
            .map(str::to_owned)
            .collect();
        let binary = diff_out
            .stdout
            .windows(b"GIT binary patch".len())
            .any(|w| w == b"GIT binary patch")
            || String::from_utf8_lossy(&diff_out.stdout).contains("Binary files");

        // Also capture unstaged? For shelve we want worktree vs HEAD for tracked;
        // untracked are not shelved (IDEA).
        let entry = gitx_meta::create_shelf_entry(
            &common,
            message,
            &base_sha,
            &changed_paths,
            &diff_out.stdout,
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
            // Restore only paths captured in the patch, including newly added
            // files. Untracked paths selected alongside them stay untouched.
            let mut args = vec![
                "restore".into(),
                format!("--source={base_sha}"),
                "--staged".into(),
                "--worktree".into(),
                "--".into(),
            ];
            args.extend(changed_paths);
            let inv = GitInvocation::new(cwd, args)
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            self.run(inv, cancel).await?;
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
        let base_sha = self.shelf_base(cwd, cancel).await?;
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
