use crate::commands::workspace::remember_recent_path;
use crate::state::AppState;
use gitx_core::{AppError, CloneResult, ErrorCode};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CloneCheckUrlReq {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CloneRunReq {
    pub url: String,
    pub dir: String,
    pub depth: Option<u32>,
    pub branch: Option<String>,
    pub open_after: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UnshallowReq {
    pub path: String,
    pub remote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoStateReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoStateRes {
    pub is_shallow: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn clone_check_url(
    state: State<'_, AppState>,
    req: CloneCheckUrlReq,
) -> Result<bool, AppError> {
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.clone_check_url(&req.url, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn clone_run(
    state: State<'_, AppState>,
    req: CloneRunReq,
) -> Result<CloneResult, AppError> {
    let dir = PathBuf::from(&req.dir);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let result = git
        .clone_run(&req.url, &dir, req.depth, req.branch.as_deref(), &cancel)
        .await?;
    drop(git);
    if req.open_after {
        remember_recent_path(&state, &result.path).await;
    }
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn unshallow_run(state: State<'_, AppState>, req: UnshallowReq) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.unshallow_run(&path, req.remote.as_deref(), &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_state_get(
    state: State<'_, AppState>,
    req: RepoStateReq,
) -> Result<RepoStateRes, AppError> {
    let path = PathBuf::from(&req.path);
    if !path.is_dir() {
        return Err(AppError::new(
            ErrorCode::FsError,
            format!("not a directory: {}", req.path),
        ));
    }
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let is_shallow = git.is_shallow(&path, &cancel).await?;
    Ok(RepoStateRes { is_shallow })
}
