//! Shelve / unshelve using gitx-meta shelf storage (#111).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode, ShelfEntry};
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitRunner {
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

        // Base revision sha (HEAD); empty tree for unborn.
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

        // Ensure base blobs stay reachable.
        let keepalive = format!("refs/gitx/shelf-base-{base_sha}");
        let inv = GitInvocation::new(cwd, ["update-ref", &keepalive, &base_sha])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        let _ = self.run(inv, cancel).await;

        // Binary-aware diff.
        let mut args = vec!["diff".into(), "--binary".into(), "HEAD".into(), "--".into()];
        args.extend(paths.iter().cloned());
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let diff_out = self.run(inv, cancel).await?;
        let binary = diff_out
            .stdout
            .windows(14)
            .any(|w| w == b"GIT binary patch")
            || String::from_utf8_lossy(&diff_out.stdout).contains("Binary files");

        // Also capture unstaged? For shelve we want worktree vs HEAD for tracked;
        // untracked are not shelved (IDEA).
        let entry = gitx_meta::create_shelf_entry(
            &common,
            message,
            &base_sha,
            paths,
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
        let _ = self.run(inv, cancel).await;

        if !keep_changes {
            // Rollback worktree for these paths to HEAD.
            let mut args = vec!["checkout".into(), "HEAD".into(), "--".into()];
            args.extend(paths.iter().cloned());
            let inv = GitInvocation::new(cwd, args)
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            let _ = self.run(inv, cancel).await;
            // Also reset index for those paths.
            let mut args = vec!["reset".into(), "-q".into(), "HEAD".into(), "--".into()];
            args.extend(paths.iter().cloned());
            let inv = GitInvocation::new(cwd, args)
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            let _ = self.run(inv, cancel).await;
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

        let patch_path = common
            .join("gitx")
            .join("shelf")
            .join(shelf_id)
            .join("changes.patch");
        // Write patch to temp if needed — already on disk.
        let inv = GitInvocation::new(
            cwd,
            [
                "apply",
                "--3way",
                "--whitespace=nowarn",
                &patch_path.to_string_lossy(),
            ],
        )
        .kind(OpKind::Write)
        .git_bin(self.git_bin.clone());

        let applied = meta.paths.clone();
        let failed: Vec<String> = Vec::new();
        match self.run(inv, cancel).await {
            Ok(_) => {}
            Err(e) => {
                let msg = e.message.clone();
                let stderr = e.git_stderr.clone().unwrap_or_default();
                let conflictish = msg.to_lowercase().contains("conflict")
                    || stderr.to_lowercase().contains("conflict");
                if conflictish {
                    // Leave conflict markers / conflicted state for M4 UI.
                } else {
                    // Fallback 1: plain apply (clean worktree matching preimage).
                    let plain = GitInvocation::new(
                        cwd,
                        [
                            "apply",
                            "--whitespace=nowarn",
                            &patch_path.to_string_lossy(),
                        ],
                    )
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                    if self.run(plain, cancel).await.is_ok() {
                        // ok
                    } else {
                        // Fallback 2: reconstruct shelved text from base + patch in a temp
                        // dir, then write over worktree (best-effort when local diverged).
                        if let Err(err) = self
                            .unshelve_via_temp(cwd, &meta.base_sha, &patch, &meta.paths, cancel)
                            .await
                        {
                            return Err(AppError::new(
                                ErrorCode::ShelfFailed,
                                format!("unshelve failed: {msg}"),
                            )
                            .with_stderr(format!("{stderr}\n{}", err.message)));
                        }
                    }
                }
            }
        }

        if remove_applied && !applied.is_empty() {
            let _ = gitx_meta::remove_paths_from_shelf(&common, shelf_id, &applied)?;
        }

        Ok((applied, failed))
    }

    async fn unshelve_via_temp(
        &self,
        cwd: &Path,
        base_sha: &str,
        patch: &[u8],
        paths: &[String],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let tmp = cwd.join(".git").join("gitx").join("unshelve-tmp");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("unshelve tmp: {e}")))?;
        for path in paths {
            let inv = GitInvocation::new(cwd, ["show", &format!("{base_sha}:{path}")])
                .kind(OpKind::Read)
                .git_bin(self.git_bin.clone());
            if let Ok(out) = self.run(inv, cancel).await {
                let dest = tmp.join(path);
                if let Some(parent) = dest.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(&dest, out.stdout);
            }
        }
        let patch_file = tmp.join("changes.patch");
        std::fs::write(&patch_file, patch)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("write temp patch: {e}")))?;
        let inv = GitInvocation::new(
            &tmp,
            [
                "apply",
                "--whitespace=nowarn",
                &patch_file.to_string_lossy(),
            ],
        )
        .kind(OpKind::Write)
        .git_bin(self.git_bin.clone());
        // `git apply` needs to run with cwd=tmp but git dir from repo — set GIT_DIR.
        let git_dir = self.git_dir(cwd, cancel).await?;
        let mut cmd = tokio::process::Command::new(&self.git_bin);
        cmd.args([
            "apply",
            "--whitespace=nowarn",
            &patch_file.to_string_lossy(),
        ])
        .current_dir(&tmp)
        .env("GIT_DIR", &git_dir)
        .env("GIT_WORK_TREE", &tmp)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
        crate::process_win::hide_console_tokio(&mut cmd);
        let _ = inv;
        let output = cmd.output().await.map_err(|e| {
            AppError::new(
                ErrorCode::GitCommandFailed,
                format!("unshelve temp apply: {e}"),
            )
        })?;
        if !output.status.success() {
            // Last resort: copy shelved intent by applying patch with --reverse on base
            // failed — write patch new-side via `git apply --cached` skip; just overwrite
            // from `git apply` using stdin against reconstructed files already at base.
            return Err(AppError::new(
                ErrorCode::ShelfFailed,
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }
        for path in paths {
            let src = tmp.join(path);
            if src.exists() {
                let dest = cwd.join(path);
                if let Some(parent) = dest.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::copy(&src, &dest).map_err(|e| {
                    AppError::new(ErrorCode::FsError, format!("copy unshelved file: {e}"))
                })?;
            }
        }
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
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
