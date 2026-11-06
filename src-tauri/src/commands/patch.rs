use crate::state::AppState;
use gitx_core::{AppError, ErrorCode, PatchCreateResult};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PatchCreateReq {
    pub path: String,
    #[serde(default)]
    pub paths: Vec<String>,
    pub output: Option<String>,
    pub base: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PatchApplyReq {
    pub path: String,
    pub patch_file: String,
    #[serde(default = "default_true")]
    pub three_way: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PatchApplyClipboardReq {
    pub path: String,
    pub patch_text: String,
    #[serde(default = "default_true")]
    pub three_way: bool,
}

async fn emit_cmd(app: &AppHandle, line: String) {
    let _ = app.emit(
        "console://line",
        serde_json::json!({ "stream": "cmd", "line": line }),
    );
}

#[tauri::command]
#[specta::specta]
pub async fn patch_create(
    app: AppHandle,
    state: State<'_, AppState>,
    req: PatchCreateReq,
) -> Result<PatchCreateResult, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let output = if let Some(o) = req.output {
        PathBuf::from(o)
    } else {
        git.default_patch_path(&cwd, &cancel).await?
    };
    emit_cmd(&app, format!("git diff --binary > {}", output.display())).await;
    git.patch_create(&cwd, &req.paths, &output, req.base.as_deref(), &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn patch_apply(
    app: AppHandle,
    state: State<'_, AppState>,
    req: PatchApplyReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("git apply {}", req.patch_file)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.patch_apply(
        &cwd,
        PathBuf::from(&req.patch_file).as_path(),
        req.three_way,
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn patch_apply_clipboard(
    app: AppHandle,
    state: State<'_, AppState>,
    req: PatchApplyClipboardReq,
) -> Result<(), AppError> {
    if req.patch_text.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "clipboard patch is empty",
        ));
    }
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, "git apply <clipboard>".into()).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.patch_apply_clipboard(&cwd, &req.patch_text, req.three_way, &cancel)
        .await
}
