use crate::state::AppState;
use gitx_core::{AppError, MultiRootOpResult, MultiRootOpStep, RepoRoot, WslPathInfo};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverRootsReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MultiRootCheckoutReq {
    pub roots: Vec<String>,
    pub target: String,
    /// `local` | `remote` | `revision`
    pub mode: String,
    #[serde(default = "default_true")]
    pub rollback_on_fail: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MultiRootRollbackReq {
    pub steps: Vec<MultiRootOpStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UiSyncPayload {
    pub channel: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ParseWslPathReq {
    pub path: String,
}

#[tauri::command]
#[specta::specta]
pub async fn repo_discover(
    state: State<'_, AppState>,
    req: DiscoverRootsReq,
) -> Result<Vec<RepoRoot>, AppError> {
    let path = PathBuf::from(&req.path);
    // Auto-enable WSL git when opening a WSL UNC path.
    if let Some(info) = gitx_git::parse_wsl_unc_path(&req.path) {
        let mut git = state.git.write().await;
        *git = gitx_git::GitRunner::new("git").with_wsl(info.distro);
    }
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.discover_repo_roots(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn multi_root_checkout(
    app: AppHandle,
    state: State<'_, AppState>,
    req: MultiRootCheckoutReq,
) -> Result<MultiRootOpResult, AppError> {
    let _ = app.emit(
        "console://line",
        serde_json::json!({
            "stream": "cmd",
            "line": format!(
                "multi-root checkout {} on {} root(s)",
                req.target,
                req.roots.len()
            )
        }),
    );
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.multi_root_checkout(
        &req.roots,
        &req.target,
        &req.mode,
        req.rollback_on_fail,
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn multi_root_rollback(
    state: State<'_, AppState>,
    req: MultiRootRollbackReq,
) -> Result<MultiRootOpResult, AppError> {
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.multi_root_rollback(&req.steps, &cancel).await
}

/// Broadcast UI state to other windows (`ui://sync`).
#[tauri::command]
#[specta::specta]
pub async fn ui_sync_broadcast(app: AppHandle, payload: UiSyncPayload) -> Result<(), AppError> {
    let _ = app.emit("ui://sync", payload);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn parse_wsl_path(req: ParseWslPathReq) -> Result<Option<WslPathInfo>, AppError> {
    Ok(gitx_git::parse_wsl_unc_path(&req.path))
}
