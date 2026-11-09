//! Partial index edits must preserve blob bytes and reject ambiguous targets.

use crate::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, DiffHunk, ErrorCode};
use std::{collections::HashSet, path::Path};
use tokio_util::sync::CancellationToken;

pub(crate) enum PartialSelection<'a> {
    Lines(&'a [u32]),
    Hunks(&'a [u32]),
}

impl PartialSelection<'_> {
    pub(crate) fn is_empty(&self) -> bool {
        match self {
            Self::Lines(items) | Self::Hunks(items) => items.is_empty(),
        }
    }

    pub(crate) fn validate(&self, hunks: &[DiffHunk]) -> Result<(), AppError> {
        let (items, valid) = match self {
            Self::Hunks(items) => (*items, hunks.iter().map(|hunk| hunk.index).collect()),
            Self::Lines(items) => {
                let mut valid = HashSet::new();
                for hunk in hunks {
                    let mut number = hunk.new_start;
                    for line in &hunk.lines {
                        if line.starts_with('+') {
                            valid.insert(number);
                        }
                        if line.starts_with('+') || line.starts_with(' ') {
                            number += 1;
                        }
                    }
                }
                (*items, valid)
            }
        };
        if items.iter().any(|item| !valid.contains(item)) {
            return Err(partial_error(
                "select existing changed lines or hunks; refresh the diff if the file changed",
            ));
        }
        Ok(())
    }
}

pub(crate) struct PartialBlob {
    pub mode: String,
    pub text: String,
}

pub(crate) fn validate_partial_path(path: &str) -> Result<(), AppError> {
    if path.is_empty()
        || path.contains('\0')
        || Path::new(path).components().any(|part| {
            !matches!(
                part,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        })
    {
        return Err(partial_error(
            "partial changes require a repository-relative file path",
        ));
    }
    Ok(())
}

pub(crate) fn decode_partial_text(bytes: Vec<u8>) -> Result<String, AppError> {
    if bytes.contains(&0) || gitx_diff::too_large(Some(&bytes)) {
        return Err(partial_error(
            "binary or oversized files require whole-file operations",
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| partial_error("non-UTF-8 files require whole-file operations"))
}

fn partial_error(message: &str) -> AppError {
    AppError::new(ErrorCode::GitCommandFailed, message)
}

impl GitRunner {
    pub async fn revert_lines(
        &self,
        cwd: &Path,
        path: &str,
        lines: &[u32],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if lines.is_empty() {
            return Ok(());
        }
        validate_partial_path(path)?;
        if cancel.is_cancelled() {
            return Err(AppError::new(ErrorCode::Cancelled, "cancelled"));
        }
        let full = cwd.join(path);
        // Do not follow a replaced directory/symlink while overwriting a file.
        let mut current = cwd.to_path_buf();
        for component in Path::new(path).components() {
            current.push(component);
            let metadata = std::fs::symlink_metadata(&current).map_err(|error| {
                AppError::new(ErrorCode::FsError, format!("read path metadata: {error}"))
            })?;
            if metadata.file_type().is_symlink() {
                return Err(partial_error("symlinks require whole-file operations"));
            }
        }
        let metadata = std::fs::symlink_metadata(&full).map_err(|error| {
            AppError::new(ErrorCode::FsError, format!("read file metadata: {error}"))
        })?;
        if !metadata.is_file() || metadata.permissions().readonly() {
            return Err(partial_error(
                "partial rollback requires a writable regular file",
            ));
        }
        let work_bytes = std::fs::read(&full).map_err(|error| {
            AppError::new(ErrorCode::FsError, format!("read worktree file: {error}"))
        })?;
        let work_text = decode_partial_text(work_bytes.clone())?;
        let base = match self.partial_index_blob(cwd, path, cancel).await? {
            Some(blob) => Some(blob),
            None => self.partial_head_blob(cwd, path, cancel).await?,
        };
        let base_text = base.as_ref().map_or("", |blob| blob.text.as_str());
        let hunks = gitx_diff::compute_hunks(
            Some(base_text),
            Some(&work_text),
            &gitx_diff::DiffComputeOptions::default(),
        );
        PartialSelection::Lines(lines).validate(&hunks)?;
        let content = gitx_diff::revert_selected_lines_to_base(base_text, &work_text, lines);
        if content == work_text {
            return Err(AppError::new(
                ErrorCode::NothingToCommit,
                "no selected changes to roll back",
            ));
        }
        // Prepare complete content beside the destination. A failed write or
        // rename must leave the original file intact, and cleanup is automatic.
        use std::io::Write;
        let mut temporary = tempfile::NamedTempFile::new_in(
            full.parent().expect("relative file parent"),
        )
        .map_err(|error| AppError::new(ErrorCode::FsError, format!("prepare rollback: {error}")))?;
        temporary
            .write_all(content.as_bytes())
            .and_then(|_| temporary.as_file().set_permissions(metadata.permissions()))
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|error| {
                AppError::new(ErrorCode::FsError, format!("write rollback: {error}"))
            })?;
        if cancel.is_cancelled() {
            return Err(AppError::new(ErrorCode::Cancelled, "cancelled"));
        }
        let current_metadata = std::fs::symlink_metadata(&full).map_err(|error| {
            AppError::new(
                ErrorCode::FsError,
                format!("recheck rollback target: {error}"),
            )
        })?;
        if !current_metadata.file_type().is_file()
            || current_metadata.permissions().readonly()
            || std::fs::read(&full).map_err(|error| {
                AppError::new(
                    ErrorCode::FsError,
                    format!("recheck rollback content: {error}"),
                )
            })? != work_bytes
        {
            return Err(partial_error(
                "file changed while preparing rollback; refresh and retry",
            ));
        }
        temporary.persist(&full).map_err(|error| {
            AppError::new(
                ErrorCode::FsError,
                format!("replace rollback target: {error}"),
            )
        })?;
        Ok(())
    }

    pub async fn stage_hunks(
        &self,
        cwd: &Path,
        path: &str,
        hunks: &[u32],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        self.stage_selection(cwd, path, PartialSelection::Hunks(hunks), cancel)
            .await
    }

    pub async fn stage_lines(
        &self,
        cwd: &Path,
        path: &str,
        lines: &[u32],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        self.stage_selection(cwd, path, PartialSelection::Lines(lines), cancel)
            .await
    }

    async fn stage_selection(
        &self,
        cwd: &Path,
        path: &str,
        selection: PartialSelection<'_>,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if selection.is_empty() {
            return Ok(());
        }
        validate_partial_path(path)?;
        let index = self.partial_index_blob(cwd, path, cancel).await?;
        let file = match std::fs::symlink_metadata(cwd.join(path)) {
            Ok(file) if file.file_type().is_file() => Some(file),
            Ok(_) => return Err(partial_error("partial changes require a regular file")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(AppError::new(
                    ErrorCode::FsError,
                    format!("read file metadata: {error}"),
                ))
            }
        };
        if index.is_none() {
            if file.is_none() {
                return Err(partial_error("file no longer exists"));
            }
            match self
                .run(
                    GitInvocation::new(cwd, ["check-ignore", "-q", "--", path])
                        .git_bin(self.git_bin.clone()),
                    cancel,
                )
                .await
            {
                Ok(_) => return Err(partial_error("ignored files cannot be partially staged")),
                Err(error) if error.exit_code == Some(1) => {}
                Err(error) => return Err(error),
            }
        }
        let index_text = index.as_ref().map_or("", |blob| blob.text.as_str());
        let work_text = if file.is_some() {
            decode_partial_text(std::fs::read(cwd.join(path)).map_err(|error| {
                AppError::new(ErrorCode::FsError, format!("read worktree file: {error}"))
            })?)?
        } else {
            String::new()
        };
        let hunks = gitx_diff::compute_hunks(
            Some(index_text),
            Some(&work_text),
            &gitx_diff::DiffComputeOptions::default(),
        );
        selection.validate(&hunks)?;
        let content = match selection {
            PartialSelection::Lines(lines) => {
                gitx_diff::apply_selected_lines_to_base(index_text, &work_text, lines)
            }
            PartialSelection::Hunks(hunks) => {
                gitx_diff::apply_selected_hunks_to_base(index_text, &work_text, hunks)
            }
        };
        if content == index_text {
            return Err(AppError::new(
                ErrorCode::NothingToCommit,
                "no selected changes to stage",
            ));
        }
        if file.is_none() {
            self.run(
                GitInvocation::new(cwd, ["update-index", "--force-remove", "--", path])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?;
            return Ok(());
        }
        let mode = index
            .as_ref()
            .map(|blob| blob.mode.as_str())
            .unwrap_or_else(|| {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if file
                        .as_ref()
                        .is_some_and(|file| file.permissions().mode() & 0o111 != 0)
                    {
                        return "100755";
                    }
                }
                "100644"
            });
        // Never add the entire file before computing the selected content.
        self.stage_hunk_text(cwd, path, &content, mode, cancel)
            .await
    }

    pub(crate) async fn partial_index_blob(
        &self,
        cwd: &Path,
        path: &str,
        cancel: &CancellationToken,
    ) -> Result<Option<PartialBlob>, AppError> {
        let out = self
            .run(
                GitInvocation::new(
                    cwd,
                    [
                        "--literal-pathspecs",
                        "ls-files",
                        "--stage",
                        "-z",
                        "--",
                        path,
                    ],
                )
                .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?;
        let entries = out
            .stdout
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
            .collect::<Vec<_>>();
        if entries.is_empty() {
            return Ok(None);
        }
        if entries.len() != 1 {
            return Err(partial_error(
                "resolve conflicts and select one regular file before partial changes",
            ));
        }
        let metadata = entries[0]
            .split(|byte| *byte == b'\t')
            .next()
            .unwrap_or_default();
        let metadata = String::from_utf8_lossy(metadata);
        let fields = metadata.split_whitespace().collect::<Vec<_>>();
        if fields.len() != 3 || fields[2] != "0" {
            return Err(partial_error("resolve conflicts before partial changes"));
        }
        self.partial_blob(cwd, fields[0], fields[1], cancel)
            .await
            .map(Some)
    }

    async fn partial_head_blob(
        &self,
        cwd: &Path,
        path: &str,
        cancel: &CancellationToken,
    ) -> Result<Option<PartialBlob>, AppError> {
        let head = match self
            .run(
                GitInvocation::new(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
                    .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await
        {
            Ok(out) => String::from_utf8_lossy(&out.stdout).trim().to_string(),
            Err(error) if error.exit_code == Some(1) => {
                // Only a missing symbolic branch is unborn. A corrupt ref or
                // unreadable object must never be treated as an empty base.
                let symbolic = self
                    .run(
                        GitInvocation::new(cwd, ["symbolic-ref", "--quiet", "HEAD"])
                            .git_bin(self.git_bin.clone()),
                        cancel,
                    )
                    .await?;
                let symbolic = String::from_utf8_lossy(&symbolic.stdout);
                return match self
                    .run(
                        GitInvocation::new(
                            cwd,
                            ["show-ref", "--verify", "--quiet", symbolic.trim()],
                        )
                        .git_bin(self.git_bin.clone()),
                        cancel,
                    )
                    .await
                {
                    Err(missing) if missing.exit_code == Some(1) => Ok(None),
                    Err(other) => Err(other),
                    Ok(_) => Err(error),
                };
            }
            Err(error) => return Err(error),
        };
        let out = self
            .run(
                GitInvocation::new(
                    cwd,
                    ["--literal-pathspecs", "ls-tree", "-z", &head, "--", path],
                )
                .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?;
        let entries = out
            .stdout
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
            .collect::<Vec<_>>();
        if entries.is_empty() {
            return Ok(None);
        }
        if entries.len() != 1 {
            return Err(partial_error("select one regular file"));
        }
        let metadata = entries[0]
            .split(|byte| *byte == b'\t')
            .next()
            .unwrap_or_default();
        let metadata = String::from_utf8_lossy(metadata);
        let fields = metadata.split_whitespace().collect::<Vec<_>>();
        if fields.len() != 3 || fields[1] != "blob" {
            return Err(partial_error(
                "directories and submodules require whole-file operations",
            ));
        }
        self.partial_blob(cwd, fields[0], fields[2], cancel)
            .await
            .map(Some)
    }

    async fn partial_blob(
        &self,
        cwd: &Path,
        mode: &str,
        oid: &str,
        cancel: &CancellationToken,
    ) -> Result<PartialBlob, AppError> {
        if !matches!(mode, "100644" | "100755") {
            return Err(partial_error(
                "symlinks and submodules require whole-file operations",
            ));
        }
        let out = self
            .run(
                GitInvocation::new(cwd, ["cat-file", "blob", oid]).git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?;
        Ok(PartialBlob {
            mode: mode.to_string(),
            text: decode_partial_text(out.stdout)?,
        })
    }

    /// Unstage changed new-side lines without filtering existing blob content.
    pub async fn unstage_lines(
        &self,
        cwd: &Path,
        path: &str,
        lines: &[u32],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        self.unstage_selection(cwd, path, PartialSelection::Lines(lines), cancel)
            .await
    }

    pub async fn unstage_hunks(
        &self,
        cwd: &Path,
        path: &str,
        hunks: &[u32],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        self.unstage_selection(cwd, path, PartialSelection::Hunks(hunks), cancel)
            .await
    }

    async fn unstage_selection(
        &self,
        cwd: &Path,
        path: &str,
        selection: PartialSelection<'_>,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if selection.is_empty() {
            return Ok(());
        }
        validate_partial_path(path)?;
        let index = self.partial_index_blob(cwd, path, cancel).await?;
        let head = self.partial_head_blob(cwd, path, cancel).await?;
        let index_text = index.as_ref().map_or("", |blob| blob.text.as_str());
        let head_text = head.as_ref().map_or("", |blob| blob.text.as_str());
        let hunks = gitx_diff::compute_hunks(
            Some(head_text),
            Some(index_text),
            &gitx_diff::DiffComputeOptions::default(),
        );
        selection.validate(&hunks)?;
        let content = match selection {
            PartialSelection::Lines(lines) => {
                gitx_diff::revert_selected_lines_to_base(head_text, index_text, lines)
            }
            PartialSelection::Hunks(hunks) => {
                gitx_diff::apply_unstage_hunks_to_index(head_text, index_text, hunks)
            }
        };
        if content == index_text {
            return Err(AppError::new(
                ErrorCode::NothingToCommit,
                "no selected changes to unstage",
            ));
        }
        if content.is_empty() && head.is_none() {
            // Remove only the index entry, including before the first commit.
            self.run(
                GitInvocation::new(cwd, ["update-index", "--force-remove", "--", path])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?;
            return Ok(());
        }
        let mode = &index
            .as_ref()
            .or(head.as_ref())
            .ok_or_else(|| partial_error("file no longer exists"))?
            .mode;
        // HEAD and index are already clean Git blobs. Running --path filters
        // again can alter every unselected line or execute a failing filter.
        let out = self
            .run(
                GitInvocation::new(cwd, ["hash-object", "-w", "--stdin", "--no-filters"])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone())
                    .stdin(content.into_bytes()),
                cancel,
            )
            .await?;
        let oid = String::from_utf8_lossy(&out.stdout);
        self.run(
            GitInvocation::new(
                cwd,
                [
                    "update-index",
                    "--add",
                    "--cacheinfo",
                    &format!("{mode},{},{path}", oid.trim()),
                ],
            )
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone()),
            cancel,
        )
        .await?;
        Ok(())
    }
}
