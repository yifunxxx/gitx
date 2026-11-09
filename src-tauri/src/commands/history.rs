use crate::state::AppState;
use gitx_core::{
    AppError, BlameResult, BlobContent, ChangedFile, CommitDetails, ErrorCode, HistoryPage,
    IndexStatus, LogCommit, LogFilters, LogPage, TreeEntry,
};
use gitx_graph::layout_graph;
use gitx_index::LogIndex;
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
    #[serde(default)]
    pub filters: LogFilters,
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

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryReq {
    pub repo_id: String,
    pub path: String,
    pub file_path: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_limit")]
    pub limit: u32,
    #[serde(default)]
    pub all_branches: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BlameReq {
    pub repo_id: String,
    pub path: String,
    pub file_path: String,
    #[serde(default)]
    pub rev: String,
    #[serde(default)]
    pub ignore_whitespace: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TreeListReq {
    pub path: String,
    pub rev: String,
    #[serde(default)]
    pub dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BlobReadReq {
    pub path: String,
    pub rev: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutPathReq {
    pub repo_id: String,
    pub path: String,
    pub rev: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ListRefsReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatusReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IndexRebuildReq {
    pub path: String,
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
    let (raw, truncated) = git
        .log_page(&cwd, req.offset, limit, &req.filters, &cancel)
        .await?;
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

#[tauri::command]
#[specta::specta]
pub async fn file_history(
    state: State<'_, AppState>,
    req: FileHistoryReq,
) -> Result<HistoryPage, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.file_history(
        &cwd,
        &req.file_path,
        req.offset,
        req.limit.clamp(1, 500),
        req.all_branches,
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn blame_file(
    state: State<'_, AppState>,
    req: BlameReq,
) -> Result<BlameResult, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.blame_file(
        &cwd,
        &req.file_path,
        &req.rev,
        req.ignore_whitespace,
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn tree_list(
    state: State<'_, AppState>,
    req: TreeListReq,
) -> Result<Vec<TreeEntry>, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.tree_list(&cwd, &req.rev, &req.dir, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn blob_read(
    state: State<'_, AppState>,
    req: BlobReadReq,
) -> Result<BlobContent, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.blob_read(&cwd, &req.rev, &req.file_path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn checkout_path_from_rev(
    state: State<'_, AppState>,
    req: CheckoutPathReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.checkout_path_from_rev(&cwd, &req.rev, &req.file_path, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_refs(
    state: State<'_, AppState>,
    req: ListRefsReq,
) -> Result<Vec<String>, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.list_refs(&cwd, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn log_index_status(
    state: State<'_, AppState>,
    req: IndexStatusReq,
) -> Result<IndexStatus, AppError> {
    let settings = state.settings.read().await.clone();
    if !settings.log_indexing {
        return Ok(IndexStatus {
            enabled: false,
            ready: false,
            progress: 0.0,
            commit_count: 0,
            message: "Log indexing disabled".into(),
        });
    }
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let git_dir = match git.git_common_dir(&cwd, &cancel).await {
        Ok(p) => p,
        Err(_) => {
            return Ok(IndexStatus {
                enabled: true,
                ready: false,
                progress: 0.0,
                commit_count: 0,
                message: "Not a repository".into(),
            });
        }
    };
    let index = LogIndex::open(&git_dir)?;
    Ok(index.status())
}

#[tauri::command]
#[specta::specta]
pub async fn log_index_rebuild(
    state: State<'_, AppState>,
    req: IndexRebuildReq,
) -> Result<IndexStatus, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    let git_dir = git.git_common_dir(&cwd, &cancel).await?;
    let (raw, _) = git
        .log_page(&cwd, 0, 5000, &LogFilters::default(), &cancel)
        .await?;
    let mut index = LogIndex::open(&git_dir)?;
    index.rebuild_from_commits(raw.iter().map(|c| gitx_index::IndexCommit {
        sha: c.sha.clone(),
        parents: c.parents.clone(),
        author: c.author.clone(),
        author_email: c.author_email.clone(),
        author_time: c.author_time,
        subject: c.subject.clone(),
    }))?;
    Ok(index.status())
}
