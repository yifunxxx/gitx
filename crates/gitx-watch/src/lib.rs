//! Filesystem watcher skeleton. Real notify + debounce arrives with M1.

use gitx_core::RepoId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Worktree,
    Index,
    Refs,
    OpState,
    Ignore,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoChangedEvent {
    pub repo_id: RepoId,
    pub kinds: Vec<ChangeKind>,
    pub version: u64,
}

/// No-op watcher for M0 — registers interest but emits nothing.
#[derive(Debug, Default)]
pub struct WatcherStub;

impl WatcherStub {
    pub fn watch(&self, _repo_id: &RepoId, _worktree: &std::path::Path) {
        tracing::debug!("watcher stub: watch registered");
    }

    pub fn pause(&self, _repo_id: &RepoId) {}
    pub fn resume(&self, _repo_id: &RepoId) {}
}
