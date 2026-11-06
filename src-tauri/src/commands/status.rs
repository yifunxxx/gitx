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
    git.status_get(&path, &req.repo_id, version, &cancel).await
}
