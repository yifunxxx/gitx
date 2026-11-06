use crate::state::AppState;
use gitx_core::{AppError, ErrorCode, IgnoreAddResult};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreAddReq {
    pub path: String,
    /// Absolute or repo-relative path to the .gitignore / exclude file.
    pub ignore_file: String,
    pub patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreSuggestReq {
    pub path: String,
    pub files: Vec<String>,
    /// Directory containing the target .gitignore (repo-relative), or empty for root.
    #[serde(default)]
    pub ignore_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExcludePathReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RmCachedReq {
    pub path: String,
    pub paths: Vec<String>,
    #[serde(default)]
    pub add_to_gitignore: bool,
}

async fn emit_cmd(app: &AppHandle, line: String) {
    let _ = app.emit(
        "console://line",
        serde_json::json!({ "stream": "cmd", "line": line }),
    );
}

#[tauri::command]
#[specta::specta]
pub async fn ignore_add(
    app: AppHandle,
    state: State<'_, AppState>,
    req: IgnoreAddReq,
) -> Result<IgnoreAddResult, AppError> {
    let cwd = PathBuf::from(&req.path);
    emit_cmd(&app, format!("# ignore_add → {}", req.ignore_file)).await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let ignore_file = if PathBuf::from(&req.ignore_file).is_absolute() {
        PathBuf::from(&req.ignore_file)
    } else {
        cwd.join(&req.ignore_file)
    };
    git.ignore_add(&cwd, &ignore_file, &req.patterns, &cancel)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ignore_suggest_patterns(req: IgnoreSuggestReq) -> Result<Vec<String>, AppError> {
    let mut patterns = Vec::new();
    for f in &req.files {
        let rel = if req.ignore_dir.is_empty() {
            f.clone()
        } else {
            f.strip_prefix(&format!("{}/", req.ignore_dir))
                .unwrap_or(f)
                .to_string()
        };
        let as_dir = f.ends_with('/');
        patterns.push(gitx_git::GitRunner::escape_ignore_pattern(&rel, as_dir));
    }
    Ok(patterns)
}

#[tauri::command]
#[specta::specta]
pub async fn exclude_open(
    state: State<'_, AppState>,
    req: ExcludePathReq,
) -> Result<String, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let p = git.open_or_create_exclude(&cwd, &cancel).await?;
    Ok(p.display().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn rm_cached(
    app: AppHandle,
    state: State<'_, AppState>,
    req: RmCachedReq,
) -> Result<(), AppError> {
    if req.paths.is_empty() {
        return Err(AppError::new(ErrorCode::InvalidArgument, "no paths"));
    }
    let cwd = PathBuf::from(&req.path);
    emit_cmd(
        &app,
        format!("git rm --cached -- {} paths", req.paths.len()),
    )
    .await;
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    git.rm_cached(&cwd, &req.paths, &cancel).await?;
    if req.add_to_gitignore {
        let patterns: Vec<String> = req
            .paths
            .iter()
            .map(|p| gitx_git::GitRunner::escape_ignore_pattern(p, false))
            .collect();
        let ignore_file = cwd.join(".gitignore");
        let _ = git
            .ignore_add(&cwd, &ignore_file, &patterns, &cancel)
            .await?;
    }
    Ok(())
}
