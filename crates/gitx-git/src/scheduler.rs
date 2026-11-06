use crate::runner::OpKind;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};

/// Per-repo scheduler stub: Write/NetworkWrite mutual exclusion; Read concurrent.
pub struct RepoScheduler {
    write_locks: Arc<Mutex<HashMap<String, Arc<Semaphore>>>>,
}

impl Default for RepoScheduler {
    fn default() -> Self {
        Self {
            write_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl RepoScheduler {
    pub fn new() -> Self {
        Self::default()
    }

    async fn write_sem(&self, repo_key: &str) -> Arc<Semaphore> {
        let mut map = self.write_locks.lock().await;
        map.entry(repo_key.to_string())
            .or_insert_with(|| Arc::new(Semaphore::new(1)))
            .clone()
    }

    pub async fn with_permit<F, T>(&self, repo_key: &str, kind: OpKind, f: F) -> T
    where
        F: std::future::Future<Output = T>,
    {
        match kind {
            OpKind::Write | OpKind::NetworkWrite => {
                let sem = self.write_sem(repo_key).await;
                let _permit = sem.acquire().await.expect("semaphore closed");
                f.await
            }
            OpKind::Read | OpKind::Network => f.await,
        }
    }
}
