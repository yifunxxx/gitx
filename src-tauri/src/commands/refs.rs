use crate::state::AppState;
use gitx_core::{AppError, CompareRange, ErrorCode, RefsList};
use gitx_meta::{load_favorites, save_favorites};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RefsListReq {
    pub repo_id: String,
    pub path: String,
    pub git_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchCreateReq {
    pub path: String,
    pub name: String,
    pub start_point: Option<String>,
    pub checkout: bool,
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchCheckoutReq {
    pub path: String,
    pub target: String,
    /// local | remote | revision
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchRenameReq {
    pub path: String,
    pub old_name: String,
    pub new_name: String,
    pub unset_upstream: bool,
    pub force: bool,
    pub git_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchDeleteReq {
    pub path: String,
    pub name: String,
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchDeleteRes {
    pub sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchRestoreReq {
    pub path: String,
    pub name: String,
    pub sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchUpdateReq {
    pub path: String,
    pub local: String,
    pub remote_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoritesSetReq {
    pub git_dir: String,
    pub favorites: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CompareReq {
    pub path: String,
    pub left: String,
    pub right: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TagCreateReq {
    pub path: String,
    pub name: String,
    pub target: String,
    pub message: Option<String>,
    pub force: bool,
    pub push_remote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TagDeleteReq {
    pub path: String,
    pub name: String,
    pub remote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TagDeleteRes {
    pub sha: String,
}

fn resolve_git_dir(path: &str, git_dir: Option<&str>) -> PathBuf {
    if let Some(gd) = git_dir {
        let p = PathBuf::from(gd);
        if p.is_absolute() {
            return p;
        }
        return PathBuf::from(path).join(p);
    }
    PathBuf::from(path).join(".git")
}

#[tauri::command]
#[specta::specta]
pub async fn refs_list(
    state: State<'_, AppState>,
    req: RefsListReq,
) -> Result<RefsList, AppError> {
    let path = PathBuf::from(&req.path);
    let git_dir = resolve_git_dir(&req.path, req.git_dir.as_deref());
    let favs = load_favorites(&git_dir).unwrap_or_default();
    let set: HashSet<String> = favs.into_iter().collect();
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.refs_list(&path, &set, &cancel).await
}

#[tauri::command]
#[specta::specta]
pub async fn favorites_set(
    _state: State<'_, AppState>,
    req: FavoritesSetReq,
) -> Result<(), AppError> {
    let git_dir = PathBuf::from(&req.git_dir);
    save_favorites(&git_dir, &req.favorites)
}

#[tauri::command]
#[specta::specta]
pub async fn branch_create(
    state: State<'_, AppState>,
    req: BranchCreateReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.branch_create(
        &path,
        &req.name,
        req.start_point.as_deref(),
        req.checkout,
        req.force,
        &cancel,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn branch_checkout(
    state: State<'_, AppState>,
    req: BranchCheckoutReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.branch_checkout(&path, &req.target, &req.mode, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn branch_rename(
    state: State<'_, AppState>,
    req: BranchRenameReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.branch_rename(
        &path,
        &req.old_name,
        &req.new_name,
        req.unset_upstream,
        req.force,
        &cancel,
    )
    .await?;
    // Migrate favorites full names.
    if let Some(gd) = req.git_dir.as_deref() {
        let git_dir = resolve_git_dir(&req.path, Some(gd));
        if let Ok(mut favs) = load_favorites(&git_dir) {
            let old_full = format!("refs/heads/{}", req.old_name);
            let new_full = format!("refs/heads/{}", req.new_name);
            for f in &mut favs {
                if f == &old_full || f == &req.old_name {
                    *f = new_full.clone();
                }
            }
            let _ = save_favorites(&git_dir, &favs);
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn branch_delete(
    state: State<'_, AppState>,
    req: BranchDeleteReq,
) -> Result<BranchDeleteRes, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let sha = git
        .branch_delete(&path, &req.name, req.force, &cancel)
        .await?;
    Ok(BranchDeleteRes { sha })
}

#[tauri::command]
#[specta::specta]
pub async fn branch_restore(
    state: State<'_, AppState>,
    req: BranchRestoreReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.branch_restore(&path, &req.name, &req.sha, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn branch_update(
    state: State<'_, AppState>,
    req: BranchUpdateReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.branch_update_ff(&path, &req.local, &req.remote_ref, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn compare_branches(
    state: State<'_, AppState>,
    req: CompareReq,
) -> Result<CompareRange, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.compare_range(&path, &req.left, &req.right, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn tag_create(
    state: State<'_, AppState>,
    req: TagCreateReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.tag_create(
        &path,
        &req.name,
        &req.target,
        req.message.as_deref(),
        req.force,
        &cancel,
    )
    .await?;
    if let Some(remote) = req.push_remote.as_deref() {
        git.tag_push(&path, &req.name, remote, &cancel).await?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TagPushReq {
    pub path: String,
    pub name: String,
    pub remote: String,
}

#[tauri::command]
#[specta::specta]
pub async fn tag_delete(
    state: State<'_, AppState>,
    req: TagDeleteReq,
) -> Result<TagDeleteRes, AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    if let Some(remote) = req.remote.as_deref() {
        use gitx_git::{GitInvocation, OpKind};
        let inv = GitInvocation::new(
            &path,
            [
                "push",
                remote,
                "--delete",
                &format!("refs/tags/{}", req.name),
            ],
        )
        .kind(OpKind::NetworkWrite)
        .git_bin(git.git_bin.clone());
        git.run(inv, &cancel).await?;
        return Ok(TagDeleteRes {
            sha: String::new(),
        });
    }
    let sha = git.tag_delete(&path, &req.name, &cancel).await?;
    Ok(TagDeleteRes { sha })
}

#[tauri::command]
#[specta::specta]
pub async fn tag_push(
    state: State<'_, AppState>,
    req: TagPushReq,
) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.tag_push(&path, &req.name, &req.remote, &cancel).await
}
