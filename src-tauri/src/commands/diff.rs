use crate::state::AppState;
use gitx_core::{AppError, DiffFileResult, DiffSide, ErrorCode, IgnoreWhitespace};
use gitx_diff::{compute_hunks, decode_lossy, is_probably_binary, too_large, DiffComputeOptions};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileReq {
    pub repo_id: String,
    pub path: String,
    pub file_path: String,
    pub left: DiffSide,
    pub right: DiffSide,
    #[serde(default)]
    pub ignore_whitespace: IgnoreWhitespace,
    /// When false, omit full file texts (collapsed Diff only needs hunks).
    #[serde(default = "default_include_texts")]
    pub include_texts: bool,
}

fn default_include_texts() -> bool {
    true
}

fn side_label(side: DiffSide) -> &'static str {
    match side {
        DiffSide::Head => "HEAD",
        DiffSide::Index => "Staged",
        DiffSide::Worktree => "Local",
    }
}

fn side_rev(side: DiffSide) -> &'static str {
    match side {
        DiffSide::Head => "HEAD",
        DiffSide::Index => "INDEX",
        DiffSide::Worktree => "WORKTREE",
    }
}

#[tauri::command]
#[specta::specta]
pub async fn diff_file(
    state: State<'_, AppState>,
    req: DiffFileReq,
) -> Result<DiffFileResult, AppError> {
    let cwd = PathBuf::from(&req.path);
    if req.file_path.is_empty() {
        return Err(AppError::new(ErrorCode::FsError, "empty file path"));
    }
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let left_rev = side_rev(req.left);
    let right_rev = side_rev(req.right);
    let file_path = req.file_path.clone();

    // Parallel blob reads — independent I/O.
    let (left_bytes, right_bytes) = tokio::try_join!(
        git.read_blob_at(&cwd, left_rev, &file_path, &cancel),
        git.read_blob_at(&cwd, right_rev, &file_path, &cancel),
    )?;

    let binary = left_bytes.as_ref().is_some_and(|b| is_probably_binary(b))
        || right_bytes.as_ref().is_some_and(|b| is_probably_binary(b));
    let large = too_large(left_bytes.as_deref()) || too_large(right_bytes.as_deref());

    if binary || large {
        return Ok(DiffFileResult {
            path: req.file_path,
            left_label: side_label(req.left).into(),
            right_label: side_label(req.right).into(),
            left_text: None,
            right_text: None,
            binary,
            too_large: large,
            hunks: Vec::new(),
            encoding: "utf-8".into(),
        });
    }

    let left_text = decode_lossy(left_bytes.as_deref());
    let right_text = decode_lossy(right_bytes.as_deref());
    let ignore = req.ignore_whitespace;
    let left_for_diff = left_text.clone();
    let right_for_diff = right_text.clone();

    // Offload Myers/Histogram CPU off the async worker.
    let hunks = tokio::task::spawn_blocking(move || {
        compute_hunks(
            left_for_diff.as_deref(),
            right_for_diff.as_deref(),
            &DiffComputeOptions {
                ignore_whitespace: ignore,
            },
        )
    })
    .await
    .map_err(|e| AppError::new(ErrorCode::Internal, format!("diff join: {e}")))?;

    Ok(DiffFileResult {
        path: req.file_path,
        left_label: side_label(req.left).into(),
        right_label: side_label(req.right).into(),
        left_text: if req.include_texts { left_text } else { None },
        right_text: if req.include_texts { right_text } else { None },
        binary: false,
        too_large: false,
        hunks,
        encoding: "utf-8".into(),
    })
}
