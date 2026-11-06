use crate::state::AppState;
use gitx_core::{
    AppError, FetchSummary, IncomingCheck, PushPreview, PushResult, PullResult, UpdateInfo,
    UpdateMethod,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FetchRunReq {
    pub path: String,
    pub remote: Option<String>,
    pub prune: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PullRunReq {
    pub path: String,
    pub remote: String,
    pub branch: String,
    pub rebase: bool,
    pub ff_only: bool,
    pub no_ff: bool,
    pub squash: bool,
    pub no_commit: bool,
    pub no_verify: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectReq {
    pub path: String,
    pub strategy: UpdateMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PushPreviewReq {
    pub path: String,
    pub remote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PushRunReq {
    pub path: String,
    pub remote: String,
    pub branch: String,
    pub set_upstream: bool,
    pub force_with_lease: bool,
    /// null | "all" | "current"
    pub push_tags: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IncomingCheckReq {
    pub path: String,
    pub remote: String,
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_run(
    state: State<'_, AppState>,
    req: FetchRunReq,
) -> Result<FetchSummary, AppError> {
    let path = PathBuf::from(&req.path);
    let settings = state.settings.read().await;
    let tags = settings.git.fetch_tags;
    drop(settings);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.fetch_run(
        &path,
        req.remote.as_deref(),
        req.prune.unwrap_or(true),
        tags,
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn pull_run(
    state: State<'_, AppState>,
    req: PullRunReq,
) -> Result<PullResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.pull_run(
        &path,
        &req.remote,
        &req.branch,
        req.rebase,
        req.ff_only,
        req.no_ff,
        req.squash,
        req.no_commit,
        req.no_verify,
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_project_run(
    state: State<'_, AppState>,
    req: UpdateProjectReq,
) -> Result<UpdateInfo, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.update_project_run(&path, req.strategy, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn push_preview(
    state: State<'_, AppState>,
    req: PushPreviewReq,
) -> Result<PushPreview, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.push_preview(&path, req.remote.as_deref(), &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn push_run(
    state: State<'_, AppState>,
    req: PushRunReq,
) -> Result<PushResult, AppError> {
    let path = PathBuf::from(&req.path);
    let settings = state.settings.read().await;
    let protected = settings.git.protected_branches.clone();
    drop(settings);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.push_run(
        &path,
        &req.remote,
        &req.branch,
        req.set_upstream,
        req.force_with_lease,
        req.push_tags.as_deref(),
        &protected,
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ls_remote_check(
    state: State<'_, AppState>,
    req: IncomingCheckReq,
) -> Result<IncomingCheck, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.ls_remote_check(&path, &req.remote, &cancel).await
}
