use gitx_core::AppSettings;
use gitx_git::{GitRunner, JobManager, RepoScheduler};
use gitx_watch::WatcherStub;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct AppState {
    pub settings: Arc<RwLock<AppSettings>>,
    pub settings_path: PathBuf,
    pub git: Arc<RwLock<GitRunner>>,
    pub jobs: Arc<JobManager>,
    pub scheduler: Arc<RepoScheduler>,
    pub watcher: WatcherStub,
    pub versions: Arc<RwLock<HashMap<String, u64>>>,
}

impl AppState {
    pub fn new(settings_path: PathBuf, settings: AppSettings) -> Self {
        let git_bin = settings
            .git_executable
            .clone()
            .unwrap_or_else(|| "git".into());
        Self {
            settings: Arc::new(RwLock::new(settings)),
            settings_path,
            git: Arc::new(RwLock::new(GitRunner::new(git_bin))),
            jobs: Arc::new(JobManager::new()),
            scheduler: Arc::new(RepoScheduler::new()),
            watcher: WatcherStub,
            versions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn next_version(&self, repo_id: &str) -> u64 {
        let mut map = self.versions.write().await;
        let entry = map.entry(repo_id.to_string()).or_insert(0);
        *entry += 1;
        *entry
    }
}
