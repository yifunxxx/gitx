//! Repository notifications with bounded queues, debounce and owned lifetimes.

use gitx_core::RepoId;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Worktree,
    Index,
    Refs,
    OpState,
    Ignore,
    Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoChangedEvent {
    pub repo_id: RepoId,
    pub kinds: Vec<ChangeKind>,
    pub version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchRoot {
    pub repo_id: RepoId,
    pub worktree: PathBuf,
    pub git_dir: PathBuf,
    pub common_dir: PathBuf,
}

fn normalized(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(gitx_core::host_path_key(&path.to_string_lossy()))
    }
    #[cfg(not(windows))]
    path.to_path_buf()
}

fn git_change(relative: &Path) -> Option<ChangeKind> {
    let text = relative.to_string_lossy().replace('\\', "/");
    if text.ends_with(".lock") || text.starts_with("objects/") || text.starts_with("logs/") {
        return None;
    }
    let first = text.split('/').next().unwrap_or_default();
    match first {
        "index" => Some(ChangeKind::Index),
        "HEAD" | "head" | "refs" | "packed-refs" | "FETCH_HEAD" | "fetch_head" | "config"
        | "worktrees" => Some(ChangeKind::Refs),
        "MERGE_HEAD" | "merge_head" | "MERGE_MSG" | "merge_msg" | "CHERRY_PICK_HEAD"
        | "cherry_pick_head" | "REVERT_HEAD" | "revert_head" | "rebase-merge" | "rebase-apply"
        | "sequencer" => Some(ChangeKind::OpState),
        "info" if text == "info/exclude" => Some(ChangeKind::Ignore),
        // Index maintenance must not trigger another index/status refresh.
        "gitx" if !text.contains("log-index.sqlite") => Some(ChangeKind::Metadata),
        _ => None,
    }
}

impl WatchRoot {
    pub fn new(repo_id: RepoId, worktree: &Path, git_dir: &Path, common_dir: &Path) -> Self {
        Self {
            repo_id,
            worktree: normalized(worktree),
            git_dir: normalized(git_dir),
            common_dir: normalized(common_dir),
        }
    }

    fn classify(&self, path: &Path) -> Option<ChangeKind> {
        let path = normalized(path);
        // The worktree git dir is more specific than its common dir.
        for dir in [&self.git_dir, &self.common_dir] {
            if let Ok(relative) = path.strip_prefix(dir) {
                return git_change(relative);
            }
        }
        let relative = path.strip_prefix(&self.worktree).ok()?;
        if relative.components().any(|part| part.as_os_str() == ".git") {
            return None;
        }
        if relative
            .file_name()
            .is_some_and(|name| name == ".gitignore")
        {
            Some(ChangeKind::Ignore)
        } else {
            Some(ChangeKind::Worktree)
        }
    }
}

type OnChange = Arc<dyn Fn(RepoChangedEvent) + Send + Sync>;

struct Session {
    roots: Vec<WatchRoot>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    _watcher: RecommendedWatcher,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// Owns only the currently displayed workspace's handles and worker thread.
#[derive(Default)]
pub struct RepoWatcher {
    session: Mutex<Option<Session>>,
}

impl RepoWatcher {
    pub fn replace(&self, roots: Vec<WatchRoot>, on_change: OnChange) -> Result<(), notify::Error> {
        let mut session = self.session.lock().unwrap_or_else(|p| p.into_inner());
        if session.as_ref().is_some_and(|old| old.roots == roots) {
            return Ok(());
        }
        // Release the old session even if registering the new one fails.
        *session = None;
        if roots.is_empty() {
            return Ok(());
        }

        let (tx, rx) = mpsc::sync_channel::<Event>(1024);
        let overflow = Arc::new(AtomicBool::new(false));
        let callback_overflow = Arc::clone(&overflow);
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<Event>| match result {
                Ok(event) if !matches!(event.kind, EventKind::Access(_)) => {
                    if tx.try_send(event).is_err() {
                        callback_overflow.store(true, Ordering::Release);
                    }
                }
                Err(error) => {
                    tracing::warn!(%error, "repository watch event failed");
                    callback_overflow.store(true, Ordering::Release);
                }
                _ => {}
            })?;
        let mut paths = roots
            .iter()
            .flat_map(|r| [&r.worktree, &r.git_dir, &r.common_dir])
            .cloned()
            .collect::<Vec<_>>();
        paths.sort_by_key(|p| p.components().count());
        let mut registered = Vec::<PathBuf>::new();
        for path in paths {
            if registered.iter().any(|parent| path.starts_with(parent)) {
                continue;
            }
            watcher.watch(&path, RecursiveMode::Recursive)?;
            registered.push(path);
        }
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let worker_roots = roots.clone();
        let worker = thread::Builder::new()
            .name("gitx-watch".into())
            .spawn(move || observe(rx, worker_roots, overflow, worker_stop, on_change))
            .map_err(notify::Error::io)?;
        *session = Some(Session {
            roots,
            stop,
            worker: Some(worker),
            _watcher: watcher,
        });
        Ok(())
    }
}

fn observe(
    rx: mpsc::Receiver<Event>,
    roots: Vec<WatchRoot>,
    overflow: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    on_change: OnChange,
) {
    let mut pending = HashMap::<usize, BTreeSet<ChangeKind>>::new();
    let mut first = Instant::now();
    let mut last = first;
    let mut version = 0;
    while !stop.load(Ordering::Acquire) {
        let was_empty = pending.is_empty();
        let mut received = false;
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(event) => {
                if event.need_rescan() {
                    overflow.store(true, Ordering::Release);
                }
                for (index, root) in roots.iter().enumerate() {
                    for path in &event.paths {
                        if let Some(kind) = root.classify(path) {
                            pending.entry(index).or_default().insert(kind);
                            received = true;
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if overflow.swap(false, Ordering::AcqRel) {
            for index in 0..roots.len() {
                pending.entry(index).or_default().extend([
                    ChangeKind::Worktree,
                    ChangeKind::Index,
                    ChangeKind::Refs,
                    ChangeKind::OpState,
                    ChangeKind::Metadata,
                ]);
            }
            received = true;
        }
        if received {
            last = Instant::now();
            if was_empty {
                first = last;
            }
        }
        if !pending.is_empty()
            && (last.elapsed() >= Duration::from_millis(300)
                || first.elapsed() >= Duration::from_secs(1))
        {
            if stop.load(Ordering::Acquire) {
                break;
            }
            version += 1;
            for (index, kinds) in pending.drain() {
                on_change(RepoChangedEvent {
                    repo_id: roots[index].repo_id.clone(),
                    kinds: kinds.into_iter().collect(),
                    version,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, WatchRoot) {
        let dir = tempfile::tempdir().unwrap();
        let git = dir.path().join(".git");
        std::fs::create_dir_all(git.join("refs/heads")).unwrap();
        let root = WatchRoot::new(RepoId::new("test"), dir.path(), &git, &git);
        (dir, root)
    }

    #[test]
    fn classifies_changes_and_ignores_git_read_side_effects() {
        let (_dir, root) = fixture();
        for (path, expected) in [
            ("index", Some(ChangeKind::Index)),
            ("HEAD", Some(ChangeKind::Refs)),
            ("refs/heads/main", Some(ChangeKind::Refs)),
            ("rebase-merge/done", Some(ChangeKind::OpState)),
            ("info/exclude", Some(ChangeKind::Ignore)),
            ("gitx/changelists.json", Some(ChangeKind::Metadata)),
            ("gitx/log-index.sqlite-wal", None),
            ("index.lock", None),
            ("objects/pack/data", None),
            ("logs/HEAD", None),
        ] {
            assert_eq!(root.classify(&root.git_dir.join(path)), expected, "{path}");
        }
        assert_eq!(
            root.classify(&root.worktree.join("src/.gitignore")),
            Some(ChangeKind::Ignore)
        );
        assert_eq!(
            root.classify(&root.worktree.join("中文.txt")),
            Some(ChangeKind::Worktree)
        );
    }

    #[test]
    fn watches_linked_worktree_git_and_common_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let common = dir.path().join("main/.git");
        let root = WatchRoot::new(
            RepoId::new("linked"),
            &dir.path().join("linked"),
            &common.join("worktrees/linked"),
            &common,
        );
        assert_eq!(
            root.classify(&root.git_dir.join("index")),
            Some(ChangeKind::Index)
        );
        assert_eq!(
            root.classify(&root.common_dir.join("refs/heads/main")),
            Some(ChangeKind::Refs)
        );
    }

    #[test]
    #[cfg(windows)]
    fn unc_watch_events_match_verbatim_aliases_without_folding_linux_names() {
        let root = WatchRoot::new(
            RepoId::new("wsl"),
            Path::new(r"\\wsl$\Ubuntu\home\User\Repo"),
            Path::new(r"\\wsl$\Ubuntu\home\User\Repo\.git"),
            Path::new(r"\\wsl$\Ubuntu\home\User\Repo\.git"),
        );
        assert_eq!(
            root.classify(Path::new(
                r"\\?\UNC\WSL.LOCALHOST\ubuntu\home\User\Repo\.git\index"
            )),
            Some(ChangeKind::Index)
        );
        assert_eq!(
            root.classify(Path::new(r"\\wsl.localhost\Ubuntu\home\User\Repo\file.txt")),
            Some(ChangeKind::Worktree)
        );
        assert_eq!(
            root.classify(Path::new(r"\\wsl.localhost\Ubuntu\home\User\repo\file.txt")),
            None
        );
        let native = WatchRoot::new(
            RepoId::new("share"),
            Path::new(r"\\Server\Share\Repo"),
            Path::new(r"\\Server\Share\Repo\.git"),
            Path::new(r"\\Server\Share\Repo\.git"),
        );
        assert_eq!(
            native.classify(Path::new(r"\\?\UNC\server\share\repo\.git\HEAD")),
            Some(ChangeKind::Refs)
        );
    }

    #[test]
    fn real_events_are_coalesced_and_old_sessions_are_released() {
        let (dir, root) = fixture();
        let (tx, rx) = mpsc::channel();
        let watcher = RepoWatcher::default();
        watcher
            .replace(
                vec![root.clone()],
                Arc::new(move |event| {
                    let _ = tx.send(event);
                }),
            )
            .unwrap();
        for index in 0..20 {
            std::fs::write(dir.path().join("file.txt"), index.to_string()).unwrap();
        }
        std::fs::write(root.git_dir.join("index"), "index").unwrap();
        std::fs::write(root.git_dir.join("refs/heads/main"), "ref").unwrap();
        let event = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("real filesystem change");
        assert!(event.kinds.contains(&ChangeKind::Worktree));
        assert!(event.kinds.contains(&ChangeKind::Index));
        assert!(event.kinds.contains(&ChangeKind::Refs));
        watcher.replace(vec![], Arc::new(|_| {})).unwrap();
        assert!(watcher.session.lock().unwrap().is_none());
        while rx.try_recv().is_ok() {}
        std::fs::write(dir.path().join("after-close.txt"), "closed").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(500)).is_err());
    }
}
