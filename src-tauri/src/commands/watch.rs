use crate::state::AppState;
use gitx_core::{AppError, ErrorCode, RepoId, RepoRoot};
use gitx_watch::WatchRoot;
use std::path::Path;
use std::sync::Arc;
use tauri::{Emitter, State};

/// Called after the frontend accepts an open result, so stale workspace probes
/// cannot replace the current repository's watches.
#[tauri::command]
#[specta::specta]
pub async fn workspace_watch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    roots: Vec<RepoRoot>,
) -> Result<(), AppError> {
    let watcher = Arc::clone(&state.watcher);
    let roots = roots
        .into_iter()
        .map(|r| {
            WatchRoot::new(
                RepoId::new(r.id),
                Path::new(&r.worktree_root),
                Path::new(&r.git_dir),
                Path::new(&r.common_dir),
            )
        })
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        watcher.replace(
            roots,
            Arc::new(move |event| {
                let _ = app.emit("repo://changed", event);
            }),
        )
    })
    .await
    .map_err(|e| AppError::new(ErrorCode::Internal, format!("watch worker: {e}")))?
    .map_err(|e| AppError::new(ErrorCode::FsError, format!("watch repository: {e}")))
}
