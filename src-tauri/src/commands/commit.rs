use crate::state::AppState;
use gitx_core::{AppError, CommitResult, ErrorCode};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitCreateReq {
    pub repo_id: String,
    pub path: String,
    pub message: String,
    #[serde(default)]
    pub amend: bool,
    #[serde(default)]
    pub no_verify: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HeadMessageReq {
    pub path: String,
}

#[tauri::command]
#[specta::specta]
pub async fn commit_create(
    app: AppHandle,
    state: State<'_, AppState>,
    req: CommitCreateReq,
) -> Result<CommitResult, AppError> {
    let cwd = PathBuf::from(&req.path);
    let _ = app.emit(
        "console://line",
        serde_json::json!({
            "stream": "cmd",
            "line": format!(
                "git commit {}{} -F <msg>",
                if req.amend { "--amend " } else { "" },
                if req.no_verify { "--no-verify " } else { "" }
            )
        }),
    );
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let result = git
        .commit_create(&cwd, &req.message, req.amend, req.no_verify, &cancel)
        .await?;
    let _ = app.emit(
        "console://line",
        serde_json::json!({
            "stream": "stdout",
            "line": format!("[{}] {}", &result.sha[..7.min(result.sha.len())], result.subject)
        }),
    );
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn commit_head_message(
    state: State<'_, AppState>,
    req: HeadMessageReq,
) -> Result<String, AppError> {
    let cwd = PathBuf::from(&req.path);
    if !cwd.is_dir() {
        return Err(AppError::new(ErrorCode::FsError, "not a directory"));
    }
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.head_message(&cwd, &cancel).await
}
