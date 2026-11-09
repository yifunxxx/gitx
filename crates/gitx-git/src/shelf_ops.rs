//! Shelve / unshelve using gitx-meta shelf storage (#111).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode, ShelfEntry};
use std::collections::BTreeSet;
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
        reverse: bool,
        cancel: &CancellationToken,
    ) -> Result<Vec<String>, AppError> {
        if patch.is_empty() {
            return Ok(Vec::new());
        }
        // Derive metadata from the exact saved patch rather than a second diff
        // that may observe different working files. -z preserves unusual names.
        let mut args = vec!["apply", "--numstat", "-z"];
        if reverse {
            args.push("--reverse");
        }
        args.push("-");
        let out = self
            .run(GitInvocation::new(cwd, args).stdin(patch.to_vec()), cancel)
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
            let staged = self
                .shelf_patch_paths(cwd, &index_patch, false, cancel)
                .await?;
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
        let changed_paths = self.shelf_patch_paths(cwd, &patch, false, cancel).await?;
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
            GitInvocation::new(cwd, ["update-ref", "--no-deref", &keepalive, &base_sha])
                .kind(OpKind::Write),
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
        let inv = GitInvocation::new(cwd, ["update-ref", "--no-deref", &shelf_ref, &base_sha])
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
            gitx_meta::soft_delete_shelf(&common, shelf_id)?;
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
        let inv = GitInvocation::new(cwd, ["update-ref", "--no-deref", "-d", &shelf_ref])
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
        if patch.is_empty() {
            return Err(AppError::new(ErrorCode::NothingToCommit, "patch is empty"));
        }
        // Git parses binary/mode-only changes, deletions and quoted filenames.
        // Parse both directions: numstat reports only the destination of a
        // rename/copy, so its source needs validation and metadata too.
        let mut paths = self.shelf_patch_paths(cwd, &patch, false, cancel).await?;
        paths.extend(self.shelf_patch_paths(cwd, &patch, true, cancel).await?);
        paths.sort();
        paths.dedup();
        if paths.is_empty() {
            return Err(AppError::new(
                ErrorCode::NothingToCommit,
                "patch contains no file changes",
            ));
        }
        for path in &paths {
            validate_import_path(path)?;
        }
        // A normal `git diff` binary notice contains no bytes to restore.
        // Reject it even when other files in this patch have valid payloads.
        if patch.split(|&b| b == b'\n').any(|line| {
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            line.starts_with(b"Binary files ") && line.ends_with(b" differ")
        }) {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "binary patch data is missing; export the patch with git diff --binary",
            ));
        }
        let binary = patch
            .split(|&b| b == b'\n')
            .any(|line| line.strip_suffix(b"\r").unwrap_or(line) == b"GIT binary patch");
        let base_sha = self.shelf_base(cwd, cancel).await?;
        // Import validates syntax, not applicability to today's working files.
        // Keep both the current base and available patch preimages. The latter
        // may be unreachable blobs from a different revision. Publish their
        // refs together before metadata; deleted Shelves remain restorable.
        let preimages = self.shelf_import_preimages(cwd, &patch, cancel).await?;
        let mut refs = format!("update refs/gitx/shelf-base-{base_sha} {base_sha}\n");
        if let Some(tree) = preimages {
            refs.push_str(&format!("update refs/gitx/shelf-base-{tree} {tree}\n"));
        }
        self.run(
            GitInvocation::new(cwd, ["update-ref", "--no-deref", "--stdin"])
                .stdin(refs.into_bytes())
                .kind(OpKind::Write),
            cancel,
        )
        .await?;
        let entry = gitx_meta::create_shelf_entry(
            &common, message, &base_sha, &paths, &patch, None, binary, false,
        )?;
        let shelf_ref = format!("refs/gitx/shelf/{}", entry.id);
        self.run(
            GitInvocation::new(cwd, ["update-ref", "--no-deref", &shelf_ref, &base_sha])
                .kind(OpKind::Write),
            cancel,
        )
        .await?;
        Ok(entry)
    }

    /// Retain locally available old blobs without applying the patch or
    /// touching the index. Missing external objects are allowed: plain apply
    /// may still work, but three-way merging then needs the external base.
    async fn shelf_import_preimages(
        &self,
        cwd: &Path,
        patch: &[u8],
        cancel: &CancellationToken,
    ) -> Result<Option<String>, AppError> {
        let mut ids = BTreeSet::new();
        let mut header = false;
        for line in patch.split(|&byte| byte == b'\n') {
            if line.starts_with(b"diff --git ") {
                header = true;
            } else if line.starts_with(b"@@") || line.starts_with(b"GIT binary patch") {
                header = false;
            } else if header {
                let Some(index) = line.strip_prefix(b"index ") else {
                    continue;
                };
                let Some(end) = index.windows(2).position(|bytes| bytes == b"..") else {
                    continue;
                };
                let old = &index[..end];
                if (4..=64).contains(&old.len())
                    && old.iter().all(u8::is_ascii_hexdigit)
                    && old.iter().any(|&byte| byte != b'0')
                {
                    ids.insert(std::str::from_utf8(old).expect("hex object ID"));
                }
            }
        }
        if ids.is_empty() {
            return Ok(None);
        }
        let input = ids
            .into_iter()
            .map(|id| format!("{id}\n"))
            .collect::<String>();
        let out = self
            .run(
                GitInvocation::new(
                    cwd,
                    ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
                )
                .env("GIT_NO_LAZY_FETCH", "1")
                .stdin(input.into_bytes()),
                cancel,
            )
            .await?;
        let mut blobs = BTreeSet::new();
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Some(id) = line.strip_suffix(" blob") {
                blobs.insert(id.to_owned());
            }
        }
        if blobs.is_empty() {
            return Ok(None);
        }
        // Synthetic names make reachability independent of source paths,
        // renames, file modes and duplicate preimages in the imported patch.
        let tree = blobs
            .into_iter()
            .enumerate()
            .map(|(n, id)| format!("100644 blob {id}\tpreimage-{n}\0"))
            .collect::<String>();
        let out = self
            .run(
                GitInvocation::new(cwd, ["mktree", "-z"])
                    .stdin(tree.into_bytes())
                    .kind(OpKind::Write),
                cancel,
            )
            .await?;
        Ok(Some(String::from_utf8_lossy(&out.stdout).trim().to_owned()))
    }
}

fn validate_import_path(path: &str) -> Result<(), AppError> {
    if path.is_empty()
        || path.contains('\0')
        || path.starts_with(['/', '\\'])
        || path.split(['/', '\\']).any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || part
                    .trim_end_matches(['.', ' '])
                    .eq_ignore_ascii_case(".git")
                || (cfg!(windows) && part.contains(':'))
        })
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "imported patch requires repository-relative paths outside .git",
        ));
    }
    Ok(())
}
