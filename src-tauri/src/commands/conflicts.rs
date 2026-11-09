//! Conflicts IPC (M4).

use crate::state::AppState;
use gitx_core::{AppError, ConflictSide, ConflictVersions, ConflictsList, Merge3Result};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictsPathReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictAcceptReq {
    pub path: String,
    pub paths: Vec<String>,
    pub side: ConflictSide,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFileReq {
    pub path: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSaveReq {
    pub path: String,
    pub file_path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictMarkReq {
    pub path: String,
    pub paths: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn conflicts_list(
    state: State<'_, AppState>,
    req: ConflictsPathReq,
) -> Result<ConflictsList, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.conflicts_list(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn conflict_accept_side(
    state: State<'_, AppState>,
    req: ConflictAcceptReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.conflict_accept_side(&path, &req.paths, req.side, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn conflict_versions(
    state: State<'_, AppState>,
    req: ConflictFileReq,
) -> Result<ConflictVersions, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.conflict_versions(&path, &req.file_path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn conflict_merge3(
    state: State<'_, AppState>,
    req: ConflictFileReq,
) -> Result<Merge3Result, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.conflict_merge3(&path, &req.file_path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn conflict_save_result(
    state: State<'_, AppState>,
    req: ConflictSaveReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.conflict_save_result(&path, &req.file_path, &req.content, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn conflict_mark_resolved(
    state: State<'_, AppState>,
    req: ConflictMarkReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.conflict_mark_resolved(&path, &req.paths, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn conflict_resolve_simple(
    state: State<'_, AppState>,
    req: ConflictsPathReq,
) -> Result<u32, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.conflict_resolve_simple(&path, &cancel).await
}
