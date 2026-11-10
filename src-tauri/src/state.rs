use gitx_core::AppSettings;
use gitx_git::{GitRunner, JobManager, RepoScheduler};
use gitx_watch::RepoWatcher;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct AppState {
    pub settings: Arc<RwLock<AppSettings>>,
    pub settings_path: PathBuf,
    pub git: Arc<RwLock<GitRunner>>,
    pub jobs: Arc<JobManager>,
    pub scheduler: Arc<RepoScheduler>,
    pub watcher: Arc<RepoWatcher>,
    pub terminals: Arc<crate::terminal::TerminalManager>,
    pub versions: AtomicU64,
}

impl AppState {
    pub fn new(settings_path: PathBuf, settings: AppSettings) -> Self {
        gitx_git::ensure_windows_git_path();
        let git_bin = settings
            .git_executable
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .or_else(|| gitx_git::detect_git(None).ok().map(|d| d.path))
            .unwrap_or_else(|| "git".into());
        // Bridge Settings → GitRunner for network askpass / credential.helper policy.
        // SAFETY: single-process desktop app.
        unsafe {
            std::env::set_var(
                "GITX_USE_CREDENTIAL_HELPER",
                if settings.git.use_credential_helper {
                    "1"
                } else {
                    "0"
                },
            );
        }
        Self {
            settings: Arc::new(RwLock::new(settings)),
            settings_path,
            git: Arc::new(RwLock::new(GitRunner::new(git_bin))),
            jobs: Arc::new(JobManager::new()),
            scheduler: Arc::new(RepoScheduler::new()),
            watcher: Arc::new(RepoWatcher::default()),
            terminals: Arc::new(crate::terminal::TerminalManager::default()),
            versions: AtomicU64::new(0),
        }
    }

    pub async fn next_version(&self, _repo_id: &str) -> u64 {
        self.versions.fetch_add(1, Ordering::Relaxed) + 1
    }
}
