use crate::state::AppState;
use gitx_core::{AppError, ErrorCode, PatchCreateResult, ShelfEntry, ShelfPreview};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShelfPathReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShelfCreateReq {
    pub path: String,
    pub message: String,
    pub paths: Vec<String>,
    #[serde(default)]
    pub keep_changes: bool,
    pub source_changelist: Option<String>,
    #[serde(default)]
    pub system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShelfIdReq {
    pub path: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShelfUnshelveReq {
    pub path: String,
    pub id: String,
    #[serde(default = "default_true")]
    pub remove_applied: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShelfUnshelveResult {
    pub applied: Vec<String>,
    pub failed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShelfRenameReq {
    pub path: String,
    pub id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShelfImportReq {
    pub path: String,
    pub patch_file: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShelfExportReq {
    pub path: String,
    pub id: String,
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShelfPreviewReq {
    pub path: String,
    pub id: String,
    pub deleted: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn shelf_preview(
    state: State<'_, AppState>,
    req: ShelfPreviewReq,
) -> Result<ShelfPreview, AppError> {
    let git = state.git.read().await;
    git.shelf_preview(
        PathBuf::from(&req.path).as_path(),
        &req.id,
        req.deleted,
        &CancellationToken::new(),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn shelf_export(
    state: State<'_, AppState>,
    req: ShelfExportReq,
) -> Result<PatchCreateResult, AppError> {
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.shelf_export_patch(
        PathBuf::from(&req.path).as_path(),
        &req.id,
        PathBuf::from(&req.output).as_path(),
        &cancel,
    )
    .await
}

async fn emit_cmd(app: &AppHandle, line: String) {
    let _ = app.emit(
        "console://line",
        serde_json::json!({ "stream": "cmd", "line": line }),
    );
}

async fn maintain_shelf(
    state: &AppState,
    path: &str,
    git: &gitx_git::GitRunner,
    cancel: &CancellationToken,
) {
    // Retention is a write even when triggered by list refresh. Share the repo
    // scheduler with create/restore/unshelve and the cross-process Shelf lock.
    let result = async {
        if !git
            .shelf_maintenance_is_due(std::path::Path::new(path), cancel)
            .await?
        {
            return Ok(None);
        }
        let _permits = state
            .scheduler
            .acquire_repo_write(git, path, cancel)
            .await?;
        git.shelf_maintain_if_due(std::path::Path::new(path), cancel)
            .await
    }
    .await;
    match result {
        Ok(Some(report)) => tracing::info!(?report, "Shelf maintenance completed"),
        Ok(None) => {}
        Err(error) => {
            tracing::warn!(%error, "Shelf cleanup deferred; saved entries remain readable")
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn shelf_list(
    state: State<'_, AppState>,
    req: ShelfPathReq,
) -> Result<Vec<ShelfEntry>, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    maintain_shelf(&state, &req.path, &git, &cancel).await;
    git.shelf_list(&cwd, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn shelf_list_deleted(
    state: State<'_, AppState>,
    req: ShelfPathReq,
) -> Result<Vec<ShelfEntry>, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    maintain_shelf(&state, &req.path, &git, &cancel).await;
    git.shelf_list_deleted(&cwd, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn shelf_create(
    app: AppHandle,
    state: State<'_, AppState>,
    req: ShelfCreateReq,
) -> Result<ShelfEntry, AppError> {
    if req.paths.is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "no paths to shelve",
        ));
    }
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("# shelve {} paths", req.paths.len())).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.shelve_changes(
        &cwd,
        &req.message,
        &req.paths,
        req.keep_changes,
        req.source_changelist.as_deref(),
        req.system,
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn shelf_unshelve(
    app: AppHandle,
    state: State<'_, AppState>,
    req: ShelfUnshelveReq,
) -> Result<ShelfUnshelveResult, AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("# unshelve {}", req.id)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    let (applied, failed) = git
        .unshelve(&cwd, &req.id, req.remove_applied, &cancel)
        .await?;
    Ok(ShelfUnshelveResult { applied, failed })
}

#[tauri::command]
#[specta::specta]
pub async fn shelf_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    req: ShelfIdReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("# delete shelf {}", req.id)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.shelf_delete(&cwd, &req.id, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn shelf_restore(
    app: AppHandle,
    state: State<'_, AppState>,
    req: ShelfIdReq,
) -> Result<ShelfEntry, AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("# restore shelf {}", req.id)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.shelf_restore(&cwd, &req.id, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn shelf_rename(
    state: State<'_, AppState>,
    req: ShelfRenameReq,
) -> Result<ShelfEntry, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.shelf_rename(&cwd, &req.id, &req.message, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn shelf_import(
    app: AppHandle,
    state: State<'_, AppState>,
    req: ShelfImportReq,
) -> Result<ShelfEntry, AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("# import patch {}", req.patch_file)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.shelf_import_patch(
        &cwd,
        PathBuf::from(&req.patch_file).as_path(),
        &req.message,
        &cancel,
    )
    .await
}
