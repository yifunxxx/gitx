use crate::state::AppState;
use gitx_core::{AppError, ChangelistsState, ErrorCode};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangelistPathReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangelistCreateReq {
    pub path: String,
    pub name: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub set_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangelistIdReq {
    pub path: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangelistRenameReq {
    pub path: String,
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangelistDeleteReq {
    pub path: String,
    pub id: String,
    pub move_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangelistMoveReq {
    pub path: String,
    pub paths: Vec<String>,
    pub target_list_id: String,
}

async fn git_dir(state: &AppState, path: &str) -> Result<PathBuf, AppError> {
    let cwd = PathBuf::from(path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.git_dir(&cwd, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn changelist_list(
    state: State<'_, AppState>,
    req: ChangelistPathReq,
) -> Result<ChangelistsState, AppError> {
    let dir = git_dir(&state, &req.path).await?;
    gitx_meta::load_changelists(&dir)
}

#[tauri::command]
#[specta::specta]
pub async fn changelist_create(
    state: State<'_, AppState>,
    req: ChangelistCreateReq,
) -> Result<ChangelistsState, AppError> {
    let dir = git_dir(&state, &req.path).await?;
    gitx_meta::create_changelist(&dir, &req.name, &req.comment, req.set_active)
}

#[tauri::command]
#[specta::specta]
pub async fn changelist_rename(
    state: State<'_, AppState>,
    req: ChangelistRenameReq,
) -> Result<ChangelistsState, AppError> {
    let dir = git_dir(&state, &req.path).await?;
    gitx_meta::rename_changelist(&dir, &req.id, &req.name)
}

#[tauri::command]
#[specta::specta]
pub async fn changelist_delete(
    state: State<'_, AppState>,
    req: ChangelistDeleteReq,
) -> Result<ChangelistsState, AppError> {
    let dir = git_dir(&state, &req.path).await?;
    gitx_meta::delete_changelist(&dir, &req.id, req.move_to.as_deref())
}

#[tauri::command]
#[specta::specta]
pub async fn changelist_set_active(
    state: State<'_, AppState>,
    req: ChangelistIdReq,
) -> Result<ChangelistsState, AppError> {
    let dir = git_dir(&state, &req.path).await?;
    gitx_meta::set_active_changelist(&dir, &req.id)
}

#[tauri::command]
#[specta::specta]
pub async fn changelist_move(
    state: State<'_, AppState>,
    req: ChangelistMoveReq,
) -> Result<ChangelistsState, AppError> {
    if req.paths.is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "no paths to move",
        ));
    }
    let dir = git_dir(&state, &req.path).await?;
    gitx_meta::move_paths(&dir, &req.paths, &req.target_list_id)
}
