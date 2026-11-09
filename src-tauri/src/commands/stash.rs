use crate::state::AppState;
use gitx_core::{AppError, ErrorCode, StashEntry};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StashPathReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StashCreateReq {
    pub path: String,
    pub message: String,
    #[serde(default)]
    pub keep_index: bool,
    #[serde(default)]
    pub include_untracked: bool,
    #[serde(default)]
    pub paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StashRefReq {
    pub path: String,
    pub stash_ref: String,
    #[serde(default)]
    pub reinstate_index: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StashBranchReq {
    pub path: String,
    pub branch: String,
    pub stash_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StashRestoreReq {
    pub path: String,
    pub sha: String,
    pub message: String,
}

async fn emit_cmd(app: &AppHandle, line: String) {
    let _ = app.emit(
        "console://line",
        serde_json::json!({ "stream": "cmd", "line": line }),
    );
}

#[tauri::command]
#[specta::specta]
pub async fn stash_list(
    state: State<'_, AppState>,
    req: StashPathReq,
) -> Result<Vec<StashEntry>, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.stash_list(&cwd, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn stash_create(
    app: AppHandle,
    state: State<'_, AppState>,
    req: StashCreateReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("git stash push -m {:?}", req.message)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.stash_create(
        &cwd,
        &req.message,
        req.keep_index,
        req.include_untracked,
        req.paths.as_deref(),
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn stash_apply(
    app: AppHandle,
    state: State<'_, AppState>,
    req: StashRefReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("git stash apply {}", req.stash_ref)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.stash_apply(&cwd, &req.stash_ref, req.reinstate_index, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn stash_pop(
    app: AppHandle,
    state: State<'_, AppState>,
    req: StashRefReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("git stash pop {}", req.stash_ref)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.stash_pop(&cwd, &req.stash_ref, req.reinstate_index, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn stash_drop(
    app: AppHandle,
    state: State<'_, AppState>,
    req: StashRefReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("git stash drop {}", req.stash_ref)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.stash_drop(&cwd, &req.stash_ref, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn stash_clear(
    app: AppHandle,
    state: State<'_, AppState>,
    req: StashPathReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, "git stash clear".into()).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.stash_clear(&cwd, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn stash_branch(
    app: AppHandle,
    state: State<'_, AppState>,
    req: StashBranchReq,
) -> Result<(), AppError> {
    if req.branch.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "branch name is empty",
        ));
    }
    let cwd = PathBuf::from(&req.path);
    emit_cmd(
        &app,
        format!("git stash branch {} {}", req.branch, req.stash_ref),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.stash_branch(&cwd, &req.branch, &req.stash_ref, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn stash_restore(
    app: AppHandle,
    state: State<'_, AppState>,
    req: StashRestoreReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("git stash store {}", req.sha)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.stash_restore_from_backup(&cwd, &req.sha, &req.message, &cancel)
        .await
}
