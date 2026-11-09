use crate::state::AppState;
use gitx_core::{AppError, ErrorCode, JobId, JobInfo};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct JobCancelReq {
    pub job_id: String,
}

#[tauri::command]
#[specta::specta]
pub async fn job_list(state: State<'_, AppState>) -> Result<Vec<JobInfo>, AppError> {
    Ok(state.jobs.list().await)
}

#[tauri::command]
#[specta::specta]
pub async fn job_cancel(state: State<'_, AppState>, req: JobCancelReq) -> Result<bool, AppError> {
    let id = JobId(req.job_id);
    let ok = state.jobs.cancel(&id).await;
    if !ok {
        return Err(AppError::new(
            ErrorCode::NotFound,
            format!("job not found or not cancellable: {}", id.0),
        ));
    }
    Ok(true)
}
