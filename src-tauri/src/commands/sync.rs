use crate::state::AppState;
use gitx_core::{
    AppError, FetchSummary, IncomingCheck, PullResult, PushPreview, PushResult,
    SubmoduleUpdatePolicy, SubmoduleUpdateResult, SyncForkResult, UpdateInfo, UpdateMethod,
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
    pub branch: Option<String>,
    pub remote_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PushRunReq {
    pub path: String,
    pub remote: String,
    pub branch: String,
    pub remote_branch: Option<String>,
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
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
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
pub async fn pull_run(state: State<'_, AppState>, req: PullRunReq) -> Result<PullResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
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

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncForkReq {
    pub path: String,
    pub parent_remote: Option<String>,
    pub strategy: Option<UpdateMethod>,
    #[serde(default = "default_true")]
    pub push_origin: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleUpdateReq {
    pub path: String,
    pub policy: Option<SubmoduleUpdatePolicy>,
    pub changed_paths: Option<Vec<String>>,
}

#[tauri::command]
#[specta::specta]
pub async fn update_project_run(
    state: State<'_, AppState>,
    req: UpdateProjectReq,
) -> Result<UpdateInfo, AppError> {
    let path = PathBuf::from(&req.path);
    let policy = {
        let settings = state.settings.read().await;
        settings.git.update_submodules
    };
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.update_project_with_submodules(&path, req.strategy, policy, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn sync_fork(
    state: State<'_, AppState>,
    req: SyncForkReq,
) -> Result<SyncForkResult, AppError> {
    let path = PathBuf::from(&req.path);
    let settings = state.settings.read().await;
    let parent = req
        .parent_remote
        .unwrap_or_else(|| settings.git.fork_parent_remote.clone());
    let strategy = req.strategy.unwrap_or(settings.git.update_method);
    drop(settings);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.sync_fork(&path, &parent, strategy, req.push_origin, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn submodule_update(
    state: State<'_, AppState>,
    req: SubmoduleUpdateReq,
) -> Result<SubmoduleUpdateResult, AppError> {
    let path = PathBuf::from(&req.path);
    // Callers that omit policy get Always for explicit action.
    let policy = req.policy.unwrap_or(SubmoduleUpdatePolicy::Always);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.submodule_update(&path, policy, req.changed_paths.as_deref(), &cancel)
        .await
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
    git.push_preview(
        &path,
        req.remote.as_deref(),
        req.branch.as_deref(),
        req.remote_branch.as_deref(),
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn push_run(state: State<'_, AppState>, req: PushRunReq) -> Result<PushResult, AppError> {
    let path = PathBuf::from(&req.path);
    let settings = state.settings.read().await;
    let protected = settings.git.protected_branches.clone();
    drop(settings);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.push_run(
        &path,
        &req.remote,
        &req.branch,
        req.remote_branch.as_deref(),
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
