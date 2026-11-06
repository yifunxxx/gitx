use crate::state::AppState;
use gitx_core::{AppError, ChangedFile, CommitDetails, ErrorCode, LogCommit, LogPage};
use gitx_graph::layout_graph;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogQueryReq {
    pub repo_id: String,
    pub path: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_limit() -> u32 {
    100
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogCommitDetailsReq {
    pub path: String,
    pub sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogChangedFilesReq {
    pub path: String,
    pub sha: String,
}

#[tauri::command]
#[specta::specta]
pub async fn log_query(state: State<'_, AppState>, req: LogQueryReq) -> Result<LogPage, AppError> {
    let cwd = PathBuf::from(&req.path);
    if !cwd.is_dir() {
        return Err(AppError::new(ErrorCode::FsError, "not a directory"));
    }
    let limit = req.limit.clamp(1, 1000);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let (raw, truncated) = git.log_page(&cwd, req.offset, limit, &cancel).await?;
    let pairs: Vec<(String, Vec<String>)> = raw
        .iter()
        .map(|c| (c.sha.clone(), c.parents.clone()))
        .collect();
    let rows = layout_graph(&pairs);
    let commits: Vec<LogCommit> = raw
        .into_iter()
        .zip(rows)
        .map(|(c, graph)| {
            let short_sha = c.sha.chars().take(7).collect();
            LogCommit {
                sha: c.sha,
                short_sha,
                parents: c.parents,
                subject: c.subject,
                author: c.author,
                author_email: c.author_email,
                author_time: c.author_time,
                refs: c.refs,
                graph,
            }
        })
        .collect();
    Ok(LogPage {
        next_offset: req.offset + commits.len() as u32,
        truncated,
        commits,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn log_commit_details(
    state: State<'_, AppState>,
    req: LogCommitDetailsReq,
) -> Result<CommitDetails, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.log_commit_details(&cwd, &req.sha, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn log_changed_files(
    state: State<'_, AppState>,
    req: LogChangedFilesReq,
) -> Result<Vec<ChangedFile>, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.commit_changed_files(&cwd, &req.sha, &cancel).await
}
