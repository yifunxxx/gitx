use gitx_core::{JobId, JobInfo, JobKind};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex, RwLock};
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
    /// Holds unfinished async tasks so cancel can find tokens.
    _running: Mutex<()>,
}

impl Default for JobManager {
    fn default() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            jobs: RwLock::new(HashMap::new()),
            tx,
            _running: Mutex::new(()),
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
        let id = JobId::new();
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
        self.jobs
            .write()
            .await
            .insert(id.0.clone(), Arc::clone(&state));
        let _ = self.tx.send(JobEvent::Started(info));
        state
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
        let _ = self.tx.send(JobEvent::Finished {
            id: id.clone(),
            ok,
            error,
            summary,
        });
        self.jobs.write().await.remove(&id.0);
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
