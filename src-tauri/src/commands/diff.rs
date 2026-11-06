use crate::state::AppState;
use gitx_core::{AppError, DiffFileResult, DiffSide, ErrorCode};
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
    pub ignore_whitespace: bool,
}

fn side_label(side: DiffSide) -> &'static str {
    match side {
        DiffSide::Head => "HEAD",
        DiffSide::Index => "Staged",
        DiffSide::Worktree => "Local",
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
    let left_bytes = git
        .read_blob_side(&cwd, &req.file_path, req.left, &cancel)
        .await?;
    let right_bytes = git
        .read_blob_side(&cwd, &req.file_path, req.right, &cancel)
        .await?;

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
    let hunks = compute_hunks(
        left_text.as_deref(),
        right_text.as_deref(),
        &DiffComputeOptions {
            ignore_whitespace: req.ignore_whitespace,
        },
    );

    Ok(DiffFileResult {
        path: req.file_path,
        left_label: side_label(req.left).into(),
        right_label: side_label(req.right).into(),
        left_text,
        right_text,
        binary: false,
        too_large: false,
        hunks,
        encoding: "utf-8".into(),
    })
}
