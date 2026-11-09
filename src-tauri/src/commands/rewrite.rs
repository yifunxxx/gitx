//! Merge / rebase / cherry-pick IPC (M4) + rewrite history (M5).

use crate::state::AppState;
use gitx_core::{AppError, RebasePlan, RepoOpState, ResetMode, ResetPreview, RewriteResult};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PathReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MergeRunReq {
    pub path: String,
    pub branches: Vec<String>,
    pub no_ff: bool,
    pub ff_only: bool,
    pub squash: bool,
    pub message: Option<String>,
    pub no_commit: bool,
    pub no_verify: bool,
    pub allow_unrelated: bool,
    pub smart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MergeCommitReq {
    pub path: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RebaseRunReq {
    pub path: String,
    pub upstream: String,
    pub onto: Option<String>,
    pub branch: Option<String>,
    pub rebase_merges: bool,
    pub keep_empty: bool,
    pub root: bool,
    pub update_refs: bool,
    pub autosquash: bool,
    pub interactive: bool,
    pub smart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CherryPickRunReq {
    pub path: String,
    pub shas: Vec<String>,
    pub mainline: Option<u32>,
    /// Force -x; if null, backend decides from protected settings.
    pub add_suffix: Option<bool>,
    pub allow_empty: bool,
    pub smart: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn repo_op_state_get(
    state: State<'_, AppState>,
    req: PathReq,
) -> Result<RepoOpState, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.repo_op_state(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn merge_run(
    state: State<'_, AppState>,
    req: MergeRunReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.merge_run(
        &path,
        &req.branches,
        req.no_ff,
        req.ff_only,
        req.squash,
        req.message.as_deref(),
        req.no_commit,
        req.no_verify,
        req.allow_unrelated,
        req.smart,
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn merge_abort(
    state: State<'_, AppState>,
    req: PathReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.merge_abort(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn merge_commit(
    state: State<'_, AppState>,
    req: MergeCommitReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.merge_commit(&path, req.message.as_deref(), &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn rebase_run(
    state: State<'_, AppState>,
    req: RebaseRunReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.rebase_run(
        &path,
        &req.upstream,
        req.onto.as_deref(),
        req.branch.as_deref(),
        req.rebase_merges,
        req.keep_empty,
        req.root,
        req.update_refs,
        req.autosquash,
        req.interactive,
        req.smart,
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn rebase_continue(
    state: State<'_, AppState>,
    req: PathReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.rebase_continue(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn rebase_skip(
    state: State<'_, AppState>,
    req: PathReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.rebase_skip(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn rebase_abort(
    state: State<'_, AppState>,
    req: PathReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.rebase_abort(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn cherry_pick_run(
    state: State<'_, AppState>,
    req: CherryPickRunReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let settings = state.settings.read().await;
    let protected = settings.git.protected_branches.clone();
    let suffix_setting = settings.git.cherry_pick_suffix_protected;
    drop(settings);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;

    let mut add_suffix = req.add_suffix.unwrap_or(false);
    if req.add_suffix.is_none() && suffix_setting {
        for sha in &req.shas {
            if git
                .cherry_pick_needs_suffix(&path, sha, &protected, &cancel)
                .await
                .unwrap_or(false)
            {
                add_suffix = true;
                break;
            }
        }
    }

    git.cherry_pick_run(
        &path,
        &req.shas,
        req.mainline,
        add_suffix,
        req.allow_empty,
        req.smart,
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn cherry_pick_continue(
    state: State<'_, AppState>,
    req: PathReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.cherry_pick_continue(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn cherry_pick_skip(
    state: State<'_, AppState>,
    req: PathReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.cherry_pick_skip(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn cherry_pick_abort(
    state: State<'_, AppState>,
    req: PathReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.cherry_pick_abort(&path, &cancel).await
}

// --- M5 ---

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlanReq {
    pub path: String,
    /// First commit to include (from-here), or exclusive upstream when `upstream` is true.
    pub from_sha: String,
    /// When true, `from_sha` is an exclusive upstream base (Rebase dialog --interactive).
    #[serde(default)]
    pub upstream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RebaseInteractiveStartReq {
    pub path: String,
    pub plan: RebasePlan,
    pub smart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RewordCommitReq {
    pub path: String,
    pub sha: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SquashCommitsReq {
    pub path: String,
    pub shas: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DropCommitsReq {
    pub path: String,
    pub shas: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FixupIntoReq {
    pub path: String,
    pub target: String,
    pub squash: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RevertRunReq {
    pub path: String,
    pub shas: Vec<String>,
    pub mainline: Option<u32>,
    pub no_commit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResetPreviewReq {
    pub path: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResetRunReq {
    pub path: String,
    pub target: String,
    pub mode: ResetMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UndoRewriteReq {
    pub path: String,
    pub backup_ref: String,
    pub restore_worktree: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PartialChangesReq {
    pub path: String,
    pub commit: String,
    pub paths: Vec<String>,
    pub message: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn rebase_interactive_plan(
    state: State<'_, AppState>,
    req: RebasePlanReq,
) -> Result<RebasePlan, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    if req.upstream {
        git.rebase_interactive_plan_from_upstream(&path, &req.from_sha, &cancel)
            .await
    } else {
        git.rebase_interactive_plan(&path, &req.from_sha, &cancel)
            .await
    }
}

#[tauri::command]
#[specta::specta]
pub async fn rebase_interactive_start(
    state: State<'_, AppState>,
    req: RebaseInteractiveStartReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.rebase_interactive_start(&path, &req.plan, req.smart, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn reword_commit(
    state: State<'_, AppState>,
    req: RewordCommitReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.reword_commit(&path, &req.sha, &req.message, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn squash_commits(
    state: State<'_, AppState>,
    req: SquashCommitsReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.squash_commits(&path, &req.shas, &req.message, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn drop_commits(
    state: State<'_, AppState>,
    req: DropCommitsReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.drop_commits(&path, &req.shas, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn fixup_into(
    state: State<'_, AppState>,
    req: FixupIntoReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.fixup_into(
        &path,
        &req.target,
        req.squash,
        req.message.as_deref(),
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn uncommit(state: State<'_, AppState>, req: PathReq) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.uncommit(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn revert_run(
    state: State<'_, AppState>,
    req: RevertRunReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.revert_run(&path, &req.shas, req.mainline, req.no_commit, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn revert_continue(
    state: State<'_, AppState>,
    req: PathReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.revert_continue(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn revert_abort(
    state: State<'_, AppState>,
    req: PathReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.revert_abort(&path, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn reset_preview(
    state: State<'_, AppState>,
    req: ResetPreviewReq,
) -> Result<ResetPreview, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.reset_preview(&path, &req.target, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn reset_run(
    state: State<'_, AppState>,
    req: ResetRunReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.reset_run(&path, &req.target, req.mode, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn undo_rewrite(
    state: State<'_, AppState>,
    req: UndoRewriteReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.undo_rewrite(&path, &req.backup_ref, req.restore_worktree, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn extract_changes(
    state: State<'_, AppState>,
    req: PartialChangesReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    let msg = req.message.as_deref().unwrap_or("Extracted changes");
    git.extract_changes(&path, &req.commit, &req.paths, msg, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn drop_changes(
    state: State<'_, AppState>,
    req: PartialChangesReq,
) -> Result<RewriteResult, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let _permits = state
        .scheduler
        .acquire_repo_write(&git, &req.path, &cancel)
        .await?;
    git.drop_changes(&path, &req.commit, &req.paths, &cancel)
        .await
}
