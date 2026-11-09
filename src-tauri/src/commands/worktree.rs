use crate::state::AppState;
use gitx_core::{AppError, WorktreeInfo, WorktreePrunePreview};
use gitx_git::OpKind;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeListReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeAddReq {
    pub path: String,
    pub worktree_path: String,
    pub start_ref: String,
    pub new_branch: Option<String>,
    #[serde(default)]
    pub track: bool,
    #[serde(default = "default_true")]
    pub open_after: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeAddRes {
    pub worktree_path: String,
    pub open_after: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreePathReq {
    pub path: String,
    pub worktree_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemoveReq {
    pub path: String,
    pub worktree_path: String,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeLockReq {
    pub path: String,
    pub worktree_path: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeOpenRefReq {
    pub path: String,
    pub worktree_path: String,
    pub remote: String,
    /// e.g. `refs/pull/12/head` or a remote branch name.
    pub refspec: String,
    pub review_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDefaultPathReq {
    pub repo_path: String,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDefaultPathRes {
    pub path: String,
}

async fn emit_cmd(app: &AppHandle, line: String) {
    let _ = app.emit(
        "console://line",
        serde_json::json!({ "stream": "cmd", "line": line }),
    );
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_list(
    state: State<'_, AppState>,
    req: WorktreeListReq,
) -> Result<Vec<WorktreeInfo>, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.worktree_list(&cwd, Some(&req.path), &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_add(
    app: AppHandle,
    state: State<'_, AppState>,
    req: WorktreeAddReq,
) -> Result<WorktreeAddRes, AppError> {
    let cwd = PathBuf::from(&req.path);
    let wt = PathBuf::from(&req.worktree_path);
    emit_cmd(
        &app,
        format!(
            "git worktree add {} {} {}",
            req.new_branch
                .as_ref()
                .map(|b| format!("-b {b}"))
                .unwrap_or_default(),
            req.worktree_path,
            req.start_ref
        ),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let destination = if wt.is_absolute() {
        wt.clone()
    } else {
        cwd.join(&wt)
    };
    let _permits = state
        .scheduler
        .acquire_repo_writes(
            &git,
            std::slice::from_ref(&req.path),
            &[destination],
            &cancel,
        )
        .await?;
    git.worktree_add(
        &cwd,
        &wt,
        &req.start_ref,
        req.new_branch.as_deref(),
        req.track,
        &cancel,
    )
    .await?;
    Ok(WorktreeAddRes {
        worktree_path: req.worktree_path,
        open_after: req.open_after,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    req: WorktreeRemoveReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    let wt = PathBuf::from(&req.worktree_path);
    emit_cmd(
        &app,
        format!(
            "git worktree remove{} {}",
            if req.force { " --force" } else { "" },
            req.worktree_path
        ),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let destination = if wt.is_absolute() {
        wt.clone()
    } else {
        cwd.join(&wt)
    };
    let _permits = state
        .scheduler
        .acquire_repo_writes(
            &git,
            std::slice::from_ref(&req.path),
            &[destination],
            &cancel,
        )
        .await?;
    git.worktree_remove(&cwd, &wt, req.force, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_lock(
    app: AppHandle,
    state: State<'_, AppState>,
    req: WorktreeLockReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    let wt = PathBuf::from(&req.worktree_path);
    emit_cmd(&app, format!("git worktree lock {}", req.worktree_path)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    state
        .scheduler
        .with_repo_permit(
            &git,
            &req.path,
            OpKind::Write,
            &cancel,
            git.worktree_lock(&cwd, &wt, req.reason.as_deref(), &cancel),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_unlock(
    app: AppHandle,
    state: State<'_, AppState>,
    req: WorktreePathReq,
) -> Result<(), AppError> {
    let cwd = PathBuf::from(&req.path);
    let wt = PathBuf::from(&req.worktree_path);
    emit_cmd(&app, format!("git worktree unlock {}", req.worktree_path)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    state
        .scheduler
        .with_repo_permit(
            &git,
            &req.path,
            OpKind::Write,
            &cancel,
            git.worktree_unlock(&cwd, &wt, &cancel),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_prune_preview(
    state: State<'_, AppState>,
    req: WorktreeListReq,
) -> Result<WorktreePrunePreview, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.worktree_prune_preview(&cwd, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_prune(
    app: AppHandle,
    state: State<'_, AppState>,
    req: WorktreeListReq,
) -> Result<WorktreePrunePreview, AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, "git worktree prune -v".into()).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    state
        .scheduler
        .with_repo_permit(
            &git,
            &req.path,
            OpKind::Write,
            &cancel,
            git.worktree_prune(&cwd, &cancel),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_open_ref(
    app: AppHandle,
    state: State<'_, AppState>,
    req: WorktreeOpenRefReq,
) -> Result<WorktreeAddRes, AppError> {
    let cwd = PathBuf::from(&req.path);
    let wt = PathBuf::from(&req.worktree_path);
    emit_cmd(
        &app,
        format!(
            "git fetch {} {}:refs/gitx/review/{} && git worktree add -b review/{} {}",
            req.remote, req.refspec, req.review_name, req.review_name, req.worktree_path
        ),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let destination = if wt.is_absolute() {
        wt.clone()
    } else {
        cwd.join(&wt)
    };
    let _permits = state
        .scheduler
        .acquire_repo_writes(
            &git,
            std::slice::from_ref(&req.path),
            &[destination],
            &cancel,
        )
        .await?;
    git.worktree_open_ref(
        &cwd,
        &wt,
        &req.remote,
        &req.refspec,
        &req.review_name,
        &cancel,
    )
    .await?;
    Ok(WorktreeAddRes {
        worktree_path: req.worktree_path,
        open_after: true,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_default_path(
    req: WorktreeDefaultPathReq,
) -> Result<WorktreeDefaultPathRes, AppError> {
    let path = gitx_git::GitRunner::worktree_default_path(
        PathBuf::from(&req.repo_path).as_path(),
        &req.branch,
    );
    Ok(WorktreeDefaultPathRes {
        path: path.to_string_lossy().into_owned(),
    })
}
