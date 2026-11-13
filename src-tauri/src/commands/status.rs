use crate::state::AppState;
use gitx_core::{AppError, ErrorCode, StatusSnapshot};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StatusGetReq {
    pub repo_id: String,
    pub path: String,
    #[serde(default)]
    pub include_ignored: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteWorktreeReq {
    pub repo_id: String,
    pub path: String,
    pub file_path: String,
    pub content: String,
}

#[tauri::command]
#[specta::specta]
pub async fn status_get(
    state: State<'_, AppState>,
    req: StatusGetReq,
) -> Result<StatusSnapshot, AppError> {
    let path = PathBuf::from(&req.path);
    if !path.is_dir() {
        return Err(AppError::new(
            ErrorCode::FsError,
            format!("not a directory: {}", req.path),
        ));
    }
    let version = state.next_version(&req.repo_id).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    if req.include_ignored {
        git.status_get_with_ignored(&path, &req.repo_id, version, true, &cancel)
            .await
    } else {
        git.status_get(&path, &req.repo_id, version, &cancel).await
    }
}

#[tauri::command]
#[specta::specta]
pub async fn file_write_worktree(
    state: State<'_, AppState>,
    req: FileWriteWorktreeReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    if !path.is_dir() {
        return Err(AppError::new(
            ErrorCode::FsError,
            format!("not a directory: {}", req.path),
        ));
    }
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.file_write_worktree(&path, &req.file_path, &req.content, &cancel)
        .await
}
