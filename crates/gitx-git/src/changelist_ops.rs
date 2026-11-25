use crate::{
    changelist_blobs::ChangelistHeadReader,
    partial_commit::CommitSelection,
    partial_ops::{decode_partial_text, partial_is_link, validate_partial_path},
    GitRunner,
};
use gitx_core::{
    AppError, AssignedHunk, ChangelistCommitFile, ChangelistFileState, ChangelistsState,
    CommitResult, DiffHunk, DiffSide, ErrorCode, PathAssignment,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};
use tokio_util::sync::CancellationToken;

pub(crate) struct ChangelistPreview {
    pub state: ChangelistFileState,
    pub hunks: Vec<DiffHunk>,
}

fn validate_changelist_file(cwd: &Path, path: &str) -> Result<(), AppError> {
    validate_partial_path(path)?;
    let mut current = cwd.to_path_buf();
    for component in Path::new(path).components() {
        current.push(component);
        match std::fs::symlink_metadata(&current) {
            Ok(meta)
                if partial_is_link(&meta) || (current == cwd.join(path) && !meta.is_file()) =>
            {
                return Err(AppError::new(
                    ErrorCode::InvalidArgument,
                    "partial changelists require a regular file",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(AppError::new(ErrorCode::FsError, error.to_string())),
        }
    }
    Ok(())
}

fn append_preview(
    state: &mut ChangelistsState,
    path: String,
    preview: Result<ChangelistPreview, AppError>,
) -> Result<(), AppError> {
    match preview {
        Ok(preview) => {
            if let Some(problem) = &preview.state.problem {
                state.warnings.push(format!("{path}: {problem}"));
            }
            state.partial_files.push(preview.state);
        }
        Err(error) => {
            if error.code == ErrorCode::Cancelled {
                return Err(error);
            }
            state.warnings.push(format!("{path}: {}", error.message));
            state.partial_files.push(ChangelistFileState {
                path,
                content_token: String::new(),
                hunks: Vec::new(),
                preview_hunks: Vec::new(),
                problem: Some(error.message),
            });
        }
    }
    Ok(())
}

impl GitRunner {
    pub async fn changelist_resolve(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<ChangelistsState, AppError> {
        let dir = self.git_dir(cwd, cancel).await?;
        let mut state = gitx_meta::load_changelists(&dir)?;
        state.partial_files.clear();
        state.warnings.clear();
        let paths = state
            .assignments
            .iter()
            .filter(|assignment| !assignment.hunk_ranges.is_empty())
            .map(|assignment| assignment.path.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        // A batch needs three Git commands; avoid adding overhead for small lists.
        if paths.len() <= 3 {
            for path in paths {
                let preview = self.changelist_preview(cwd, &path, &state, cancel).await;
                append_preview(&mut state, path, preview)?;
            }
        } else {
            let mut reader = ChangelistHeadReader::new(self, cwd, paths, cancel).await?;
            loop {
                let batch = reader.next(self, cwd, cancel).await?;
                if batch.is_empty() {
                    break;
                }
                for (path, head) in batch {
                    let preview = self
                        .changelist_preview_with_head(cwd, &path, &state, head, cancel)
                        .await;
                    append_preview(&mut state, path, preview)?;
                }
            }
        }
        Ok(state)
    }

    pub(crate) async fn changelist_preview(
        &self,
        cwd: &Path,
        path: &str,
        state: &ChangelistsState,
        cancel: &CancellationToken,
    ) -> Result<ChangelistPreview, AppError> {
        validate_changelist_file(cwd, path)?;
        let head = self.read_blob_side(cwd, path, DiffSide::Head, cancel).await;
        self.changelist_preview_with_head(cwd, path, state, head, cancel)
            .await
    }

    async fn changelist_preview_with_head(
        &self,
        cwd: &Path,
        path: &str,
        state: &ChangelistsState,
        head: Result<Option<Vec<u8>>, AppError>,
        cancel: &CancellationToken,
    ) -> Result<ChangelistPreview, AppError> {
        validate_changelist_file(cwd, path)?;
        let head = head?;
        let work = self
            .read_blob_side(cwd, path, DiffSide::Worktree, cancel)
            .await?;
        if gitx_diff::too_large(head.as_deref()) || gitx_diff::too_large(work.as_deref()) {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "large files require a whole-file changelist assignment",
            ));
        }
        let old = decode_partial_text(head.clone().unwrap_or_default())?;
        let new = decode_partial_text(work.clone().unwrap_or_default())?;
        let hunks = gitx_diff::compute_hunks(
            Some(&old),
            Some(&new),
            &gitx_diff::DiffComputeOptions::default(),
        );
        let anchors = gitx_diff::hunk_anchors(&hunks);
        let records = state
            .assignments
            .iter()
            .filter(|assignment| assignment.path == path)
            .collect::<Vec<_>>();
        let mut old = records
            .iter()
            .flat_map(|assignment| {
                assignment
                    .hunk_ranges
                    .iter()
                    .map(|anchor| (anchor.clone(), assignment.list_id.clone()))
            })
            .collect::<Vec<_>>();
        old.sort_by_key(|(anchor, _)| (anchor.old_start, anchor.new_start));
        let old_anchors = old
            .iter()
            .map(|(anchor, _)| anchor.clone())
            .collect::<Vec<_>>();
        let mapped = gitx_diff::map_hunk_anchors(&old_anchors, &anchors);
        let active = gitx_meta::active_list_id(state);
        let default = if old.is_empty() {
            records
                .iter()
                .find(|assignment| assignment.hunk_ranges.is_empty())
                .map(|assignment| assignment.list_id.clone())
                .unwrap_or_else(|| active.clone())
        } else {
            active.clone()
        };
        let mut assigned = hunks
            .iter()
            .zip(anchors)
            .map(|(hunk, anchor)| AssignedHunk {
                index: hunk.index,
                list_id: default.clone(),
                anchor,
            })
            .collect::<Vec<_>>();
        let mut matched = BTreeSet::new();
        for ((_, list), target) in old.iter().zip(&mapped) {
            if let Some(index) = target {
                assigned[*index].list_id = list.clone();
                matched.insert(*index);
            }
        }
        let problem = (mapped.iter().any(Option::is_none) && matched.len() < assigned.len()).then(|| "Some blocks changed or became ambiguous. Review and reassign a block before committing this file.".to_string());
        let metadata = serde_json::to_vec(&(state.lists.clone(), records))
            .map_err(|error| AppError::new(ErrorCode::Internal, error.to_string()))?;
        let content_token = gitx_diff::content_token(&[
            path.as_bytes(),
            &metadata,
            if head.is_some() {
                b"present"
            } else {
                b"absent"
            },
            head.as_deref().unwrap_or_default(),
            if work.is_some() {
                b"present"
            } else {
                b"absent"
            },
            work.as_deref().unwrap_or_default(),
        ]);
        Ok(ChangelistPreview {
            state: ChangelistFileState {
                path: path.into(),
                content_token,
                hunks: assigned,
                preview_hunks: hunks.clone(),
                problem,
            },
            hunks,
        })
    }

    /// The move acknowledges the current preview, including any lost anchors.
    /// Unresolved and newly added blocks join the active list; uniquely matched
    /// blocks keep their list. Save all current anchors to make that explicit.
    pub async fn changelist_move_hunks(
        &self,
        cwd: &Path,
        path: &str,
        indexes: &[u32],
        expected: &[DiffHunk],
        target: &str,
        cancel: &CancellationToken,
    ) -> Result<ChangelistsState, AppError> {
        let dir = self.git_dir(cwd, cancel).await?;
        let state = gitx_meta::load_changelists(&dir)?;
        if !state.lists.iter().any(|list| list.id == target) {
            return Err(AppError::new(
                ErrorCode::NotFound,
                "target changelist no longer exists",
            ));
        }
        let mut preview = self.changelist_preview(cwd, path, &state, cancel).await?;
        if indexes.is_empty()
            || expected != preview.hunks
            || indexes
                .iter()
                .any(|index| !preview.hunks.iter().any(|hunk| hunk.index == *index))
        {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "diff changed since preview; refresh and review the selected blocks",
            ));
        }
        // Do not create assignments that this runner cannot commit safely.
        self.validate_partial_commit_backend(cwd)?;
        self.validate_partial_commit_attributes(cwd, path, cancel)
            .await?;
        self.partial_head_blob(cwd, path, cancel).await?;
        self.partial_index_blob(cwd, path, cancel).await?;
        let mut groups: BTreeMap<String, Vec<_>> = BTreeMap::new();
        for hunk in &mut preview.state.hunks {
            if indexes.contains(&hunk.index) {
                hunk.list_id = target.into();
            }
            groups
                .entry(hunk.list_id.clone())
                .or_default()
                .push(hunk.anchor.clone());
        }
        let check = self.changelist_preview(cwd, path, &state, cancel).await?;
        if check.state.content_token != preview.state.content_token {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "file changed while assigning blocks; refresh and retry",
            ));
        }
        let result = gitx_meta::replace_hunk_assignments(
            &dir,
            path,
            &state,
            groups
                .into_iter()
                .map(|(list_id, hunk_ranges)| PathAssignment {
                    path: path.into(),
                    list_id,
                    hunk_ranges,
                })
                .collect(),
        )?;
        // The write succeeded. Return metadata now; the caller refreshes derived
        // state separately, so a refresh failure cannot invite a second write.
        Ok(result)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn commit_changelist_files(
        &self,
        cwd: &Path,
        message: &str,
        amend: bool,
        no_verify: bool,
        files: &[ChangelistCommitFile],
        cancel: &CancellationToken,
    ) -> Result<CommitResult, AppError> {
        if message.trim().is_empty() || files.is_empty() {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "select changes and enter a commit message",
            ));
        }
        let dir = self.git_dir(cwd, cancel).await?;
        let state = gitx_meta::load_changelists(&dir)?;
        let mut selected = Vec::new();
        for file in files {
            if file
                .list_ids
                .iter()
                .any(|id| !state.lists.iter().any(|list| list.id == *id))
            {
                return Err(AppError::new(
                    ErrorCode::InvalidArgument,
                    "a selected changelist no longer exists; review the selection",
                ));
            }
            let records = state
                .assignments
                .iter()
                .filter(|assignment| assignment.path == file.path)
                .collect::<Vec<_>>();
            if records
                .iter()
                .any(|assignment| !assignment.hunk_ranges.is_empty())
            {
                let preview = self
                    .changelist_preview(cwd, &file.path, &state, cancel)
                    .await?;
                if preview.state.problem.is_some()
                    || file.expected_token.as_deref() != Some(&preview.state.content_token)
                {
                    return Err(AppError::new(ErrorCode::InvalidArgument, format!("{}: file or block ownership changed; refresh and review before committing", file.path)));
                }
                let indexes = preview
                    .state
                    .hunks
                    .iter()
                    .filter(|hunk| file.list_ids.contains(&hunk.list_id))
                    .map(|hunk| hunk.index)
                    .collect::<Vec<_>>();
                selected.push(CommitSelection::Hunks {
                    path: file.path.clone(),
                    indexes,
                    token: preview.state.content_token,
                });
            } else {
                if file.expected_token.is_some() {
                    return Err(AppError::new(
                        ErrorCode::InvalidArgument,
                        "partial assignment changed to whole-file; review before committing",
                    ));
                }
                let owner = records
                    .first()
                    .map(|assignment| assignment.list_id.clone())
                    .unwrap_or_else(|| gitx_meta::active_list_id(&state));
                if (file.list_ids.is_empty() && !records.is_empty())
                    || (!file.list_ids.is_empty() && !file.list_ids.contains(&owner))
                {
                    return Err(AppError::new(
                        ErrorCode::InvalidArgument,
                        "file changed changelists; refresh and review before committing",
                    ));
                }
                selected.push(CommitSelection::Whole {
                    path: file.path.clone(),
                });
            }
        }
        if selected
            .iter()
            .all(|selection| matches!(selection, CommitSelection::Whole { .. }))
        {
            let paths = files
                .iter()
                .map(|file| file.path.clone())
                .collect::<Vec<_>>();
            return self
                .commit_create_ex(cwd, message, amend, no_verify, Some(&paths), None, cancel)
                .await;
        }
        let result = self
            .commit_selections(
                cwd,
                message.trim(),
                amend,
                no_verify,
                &selected,
                Some(&state),
                cancel,
            )
            .await?;
        if result.warning.is_some() {
            Ok(result)
        } else {
            Ok(self.restore_after_commit(cwd, result).await)
        }
    }
}
