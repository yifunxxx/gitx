use crate::state::AppState;
use gitx_core::{AppError, DiffHunk, ErrorCode};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PathsReq {
    pub repo_id: String,
    pub path: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HunksReq {
    pub repo_id: String,
    pub path: String,
    pub file_path: String,
    pub hunk_indexes: Vec<u32>,
    /// Snapshot shown to the user; reject if the live diff has changed.
    #[serde(default)]
    pub expected_hunks: Option<Vec<DiffHunk>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AddPathsReq {
    pub repo_id: String,
    pub path: String,
    pub paths: Vec<String>,
    pub force: bool,
}

async fn emit_cmd(app: &AppHandle, line: String) {
    let _ = app.emit(
        "console://line",
        serde_json::json!({ "stream": "cmd", "line": line }),
    );
}

#[tauri::command]
#[specta::specta]
pub async fn stage_paths(
    app: AppHandle,
    state: State<'_, AppState>,
    req: PathsReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("git add -A -- {} paths", req.paths.len())).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.stage_paths(&cwd, &req.paths, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn unstage_paths(
    app: AppHandle,
    state: State<'_, AppState>,
    req: PathsReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(
        &app,
        format!("git restore --staged -- {} paths", req.paths.len()),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.unstage_paths(&cwd, &req.paths, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn add_paths(
    app: AppHandle,
    state: State<'_, AppState>,
    req: AddPathsReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(
        &app,
        format!(
            "git add {} -- {} paths",
            if req.force { "-f" } else { "" },
            req.paths.len()
        ),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.add_paths(&cwd, &req.paths, req.force, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn stage_hunks(
    app: AppHandle,
    state: State<'_, AppState>,
    req: HunksReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(
        &app,
        format!("# stage hunks {:?} on {}", req.hunk_indexes, req.file_path),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.stage_hunks_checked(
        &cwd,
        &req.file_path,
        &req.hunk_indexes,
        req.expected_hunks.as_deref(),
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn unstage_hunks(
    app: AppHandle,
    state: State<'_, AppState>,
    req: HunksReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(
        &app,
        format!(
            "# unstage hunks {:?} on {}",
            req.hunk_indexes, req.file_path
        ),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.unstage_hunks_checked(
        &cwd,
        &req.file_path,
        &req.hunk_indexes,
        req.expected_hunks.as_deref(),
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn revert_hunks(
    app: AppHandle,
    state: State<'_, AppState>,
    req: HunksReq,
) -> Result<(), AppError> {
    let expected = req.expected_hunks.as_deref().ok_or_else(|| {
        AppError::new(
            ErrorCode::InvalidArgument,
            "review the diff before rolling back a block",
        )
    })?;
    emit_cmd(
        &app,
        format!("# revert hunks {:?} on {}", req.hunk_indexes, req.file_path),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.revert_hunks(
        PathBuf::from(&req.path).as_path(),
        &req.file_path,
        &req.hunk_indexes,
        expected,
        &cancel,
    )
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinesReq {
    pub repo_id: String,
    pub path: String,
    pub file_path: String,
    /// 1-based new-side line numbers.
    pub lines: Vec<u32>,
}

#[tauri::command]
#[specta::specta]
pub async fn stage_lines(
    app: AppHandle,
    state: State<'_, AppState>,
    req: LinesReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(
        &app,
        format!("# stage lines {:?} on {}", req.lines, req.file_path),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.stage_lines(&cwd, &req.file_path, &req.lines, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn unstage_lines(
    app: AppHandle,
    state: State<'_, AppState>,
    req: LinesReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(
        &app,
        format!("# unstage lines {:?} on {}", req.lines, req.file_path),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.unstage_lines(&cwd, &req.file_path, &req.lines, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn revert_lines(
    app: AppHandle,
    state: State<'_, AppState>,
    req: LinesReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(
        &app,
        format!("# revert lines {:?} on {}", req.lines, req.file_path),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.revert_lines(&cwd, &req.file_path, &req.lines, &cancel)
        .await
}
