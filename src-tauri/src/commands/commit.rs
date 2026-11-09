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
    /// Changelist / pathspec commit (#60/#66).
    #[serde(default)]
    pub paths: Option<Vec<String>>,
    /// Line-level partial commit (#66).
    #[serde(default)]
    pub partial: Option<Vec<gitx_core::PartialFileSelection>>,
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
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    let result = git
        .commit_create_ex(
            &cwd,
            &req.message,
            req.amend,
            req.no_verify,
            req.paths.as_deref(),
            req.partial.as_deref(),
            &cancel,
        )
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
