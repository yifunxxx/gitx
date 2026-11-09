use crate::commands::workspace::remember_recent_path;
use crate::state::AppState;
use gitx_core::{AppError, CloneResult, ErrorCode, JobId, JobKind, RepoId};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{Emitter, State};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CloneCheckUrlReq {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CloneRunReq {
    pub job_id: String,
    pub url: String,
    pub dir: String,
    pub depth: Option<u32>,
    pub branch: Option<String>,
    pub open_after: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UnshallowReq {
    pub path: String,
    pub remote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoStateReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoStateRes {
    pub is_shallow: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn clone_check_url(
    state: State<'_, AppState>,
    req: CloneCheckUrlReq,
) -> Result<bool, AppError> {
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.clone_check_url(&req.url, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn clone_run(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: CloneRunReq,
) -> Result<CloneResult, AppError> {
    let dir = PathBuf::from(&req.dir);
    let id = uuid::Uuid::parse_str(&req.job_id)
        .map_err(|_| AppError::new(ErrorCode::InvalidArgument, "invalid clone job ID"))?;
    let job = state
        .jobs
        .start_with_id(
            JobId(id.to_string()),
            JobKind::NetworkWrite,
            format!("Clone {}", req.dir),
            vec![RepoId::new(&req.dir)],
            true,
            false,
        )
        .await?;
    let _ = app.emit(
        "job://started",
        serde_json::json!({ "id": job.info.id, "title": job.info.title }),
    );
    let git = state.git.read().await;
    let result = async {
        let _permits = state
            .scheduler
            .acquire_repo_writes(&git, &[], std::slice::from_ref(&dir), &job.cancel)
            .await?;
        git.clone_run(
            &req.url,
            &dir,
            req.depth,
            req.branch.as_deref(),
            &job.cancel,
        )
        .await
    }
    .await;
    state
        .jobs
        .finish(
            &job.info.id,
            result.is_ok(),
            result.as_ref().err().cloned(),
            None,
        )
        .await;
    let _ = app.emit("job://finished", serde_json::json!({ "id": job.info.id }));
    let result = result?;
    drop(git);
    if req.open_after {
        remember_recent_path(&state, &result.path).await;
    }
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn unshallow_run(state: State<'_, AppState>, req: UnshallowReq) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.unshallow_run(&path, req.remote.as_deref(), &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_state_get(
    state: State<'_, AppState>,
    req: RepoStateReq,
) -> Result<RepoStateRes, AppError> {
    let path = PathBuf::from(&req.path);
    if !path.is_dir() {
        return Err(AppError::new(
            ErrorCode::FsError,
            format!("not a directory: {}", req.path),
        ));
    }
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let is_shallow = git.is_shallow(&path, &cancel).await?;
    Ok(RepoStateRes { is_shallow })
}
