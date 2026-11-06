use crate::state::AppState;
use gitx_core::{AppError, RemoteInfo};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteListReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAddReq {
    pub path: String,
    pub name: String,
    pub url: String,
    pub fetch_after: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEditReq {
    pub path: String,
    pub name: String,
    pub new_name: Option<String>,
    pub url: Option<String>,
    pub push_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRemoveReq {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRemovePreview {
    pub tracking_count: u32,
}

#[tauri::command]
#[specta::specta]
pub async fn remote_list(
    state: State<'_, AppState>,
    req: RemoteListReq,
) -> Result<Vec<RemoteInfo>, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.remote_list(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn remote_add(
    state: State<'_, AppState>,
    req: RemoteAddReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.remote_add(&path, &req.name, &req.url, &cancel).await?;
    if req.fetch_after {
        let settings = state.settings.read().await;
        let tags = settings.git.fetch_tags;
        drop(settings);
        let _ = git
            .fetch_run(&path, Some(&req.name), true, tags, &cancel)
            .await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn remote_edit(
    state: State<'_, AppState>,
    req: RemoteEditReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.remote_edit(
        &path,
        &req.name,
        req.new_name.as_deref(),
        req.url.as_deref(),
        req.push_url.as_deref(),
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn remote_remove_preview(
    state: State<'_, AppState>,
    req: RemoteRemoveReq,
) -> Result<RemoteRemovePreview, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let tracking_count = git
        .remote_tracking_count(&path, &req.name, &cancel)
        .await?;
    Ok(RemoteRemovePreview { tracking_count })
}

#[tauri::command]
#[specta::specta]
pub async fn remote_remove(
    state: State<'_, AppState>,
    req: RemoteRemoveReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.remote_remove(&path, &req.name, &cancel).await
}
