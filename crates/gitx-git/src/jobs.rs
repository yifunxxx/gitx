use gitx_core::{AppError, ErrorCode, JobId, JobInfo, JobKind};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub id: JobId,
    pub phase: Option<String>,
    pub percent: Option<f32>,
    pub current: Option<u64>,
    pub total: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JobEvent {
    Started(JobInfo),
    Progress(JobProgress),
    Log {
        id: JobId,
        stream: String,
        line: String,
    },
    Finished {
        id: JobId,
        ok: bool,
        error: Option<gitx_core::AppError>,
        summary: Option<serde_json::Value>,
    },
}

#[derive(Debug)]
pub struct JobState {
    pub info: JobInfo,
    pub cancel: CancellationToken,
}

pub struct JobManager {
    jobs: RwLock<HashMap<String, Arc<JobState>>>,
    tx: broadcast::Sender<JobEvent>,
}

impl Default for JobManager {
    fn default() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            jobs: RwLock::new(HashMap::new()),
            tx,
        }
    }
}

impl JobManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<JobEvent> {
        self.tx.subscribe()
    }

    pub async fn start(
        &self,
        kind: JobKind,
        title: impl Into<String>,
        repo_ids: Vec<gitx_core::RepoId>,
        cancellable: bool,
        background: bool,
    ) -> Arc<JobState> {
        self.start_with_id(JobId::new(), kind, title, repo_ids, cancellable, background)
            .await
            .expect("new job UUID must be unique")
    }

    pub async fn start_with_id(
        &self,
        id: JobId,
        kind: JobKind,
        title: impl Into<String>,
        repo_ids: Vec<gitx_core::RepoId>,
        cancellable: bool,
        background: bool,
    ) -> Result<Arc<JobState>, AppError> {
        let info = JobInfo {
            id: id.clone(),
            kind,
            title: title.into(),
            repo_ids,
            cancellable,
            started_at: chrono_now(),
            background,
        };
        let state = Arc::new(JobState {
            info: info.clone(),
            cancel: CancellationToken::new(),
        });
        let mut jobs = self.jobs.write().await;
        if jobs.contains_key(&id.0) {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "job ID is already running",
            ));
        }
        jobs.insert(id.0.clone(), Arc::clone(&state));
        let _ = self.tx.send(JobEvent::Started(info));
        Ok(state)
    }

    pub async fn emit_log(&self, id: &JobId, stream: &str, line: impl Into<String>) {
        let _ = self.tx.send(JobEvent::Log {
            id: id.clone(),
            stream: stream.into(),
            line: line.into(),
        });
    }

    pub async fn emit_progress(&self, progress: JobProgress) {
        let _ = self.tx.send(JobEvent::Progress(progress));
    }

    pub async fn finish(
        &self,
        id: &JobId,
        ok: bool,
        error: Option<gitx_core::AppError>,
        summary: Option<serde_json::Value>,
    ) {
        let mut jobs = self.jobs.write().await;
        jobs.remove(&id.0);
        let _ = self.tx.send(JobEvent::Finished {
            id: id.clone(),
            ok,
            error,
            summary,
        });
    }

    pub async fn cancel(&self, id: &JobId) -> bool {
        if let Some(state) = self.jobs.read().await.get(&id.0) {
            if state.info.cancellable {
                state.cancel.cancel();
                return true;
            }
        }
        false
    }

    pub async fn list(&self) -> Vec<JobInfo> {
        self.jobs
            .read()
            .await
            .values()
            .map(|s| s.info.clone())
            .collect()
    }
}

fn chrono_now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn exact_job_ids_isolate_cancellation_and_cannot_replace_a_running_job() {
        let jobs = JobManager::new();
        let first = jobs
            .start_with_id(
                JobId("first".into()),
                JobKind::NetworkWrite,
                "same title",
                vec![],
                true,
                false,
            )
            .await
            .unwrap();
        let other = jobs
            .start_with_id(
                JobId("other".into()),
                JobKind::NetworkWrite,
                "same title",
                vec![],
                true,
                false,
            )
            .await
            .unwrap();
        assert!(jobs
            .start_with_id(
                first.info.id.clone(),
                JobKind::NetworkWrite,
                "same title",
                vec![],
                true,
                false
            )
            .await
            .is_err());
        assert!(jobs.cancel(&first.info.id).await);
        assert!(first.cancel.is_cancelled());
        assert!(!other.cancel.is_cancelled());
        jobs.finish(&first.info.id, false, None, None).await;
        assert!(!jobs.cancel(&first.info.id).await);
        assert_eq!(jobs.list().await.len(), 1);
    }
}
