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
    pub watch_generation: u64,
    pub degraded: bool,
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
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    wake: mpsc::SyncSender<Option<Event>>,
    _watcher: RecommendedWatcher,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = self.wake.try_send(None);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// Owns only the currently displayed workspace's handles and worker thread.
#[derive(Default)]
pub struct RepoWatcher {
    state: Mutex<WatchState>,
}

#[derive(Default)]
struct WatchState {
    generation: u64,
    closed: bool,
    session: Option<Session>,
}

impl RepoWatcher {
    pub fn replace(
        &self,
        generation: u64,
        roots: Vec<WatchRoot>,
        on_change: OnChange,
    ) -> Result<(), notify::Error> {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        // Also rejects a registration whose matching release arrived first.
        if state.closed || generation <= state.generation {
            return Ok(());
        }
        state.generation = generation;
        // Release the old session even if registering the new one fails.
        state.session = None;
        if roots.is_empty() {
            return Ok(());
        }

        let (tx, rx) = mpsc::sync_channel::<Option<Event>>(1024);
        let wake = tx.clone();
        let overflow = Arc::new(AtomicBool::new(false));
        let callback_overflow = Arc::clone(&overflow);
        let degraded = Arc::new(AtomicBool::new(false));
        let callback_degraded = Arc::clone(&degraded);
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<Event>| match result {
                Ok(event) if !matches!(event.kind, EventKind::Access(_)) => {
                    if tx.try_send(Some(event)).is_err() {
                        callback_overflow.store(true, Ordering::Release);
                    }
                }
                Err(error) => {
                    tracing::warn!(%error, "repository watch event failed");
                    callback_overflow.store(true, Ordering::Release);
                    callback_degraded.store(true, Ordering::Release);
                    let _ = tx.try_send(None);
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
            .spawn(move || {
                observe(
                    rx,
                    worker_roots,
                    overflow,
                    degraded,
                    worker_stop,
                    generation,
                    on_change,
                )
            })
            .map_err(notify::Error::io)?;
        state.session = Some(Session {
            stop,
            worker: Some(worker),
            wake,
            _watcher: watcher,
        });
        Ok(())
    }

    pub fn release(&self, generation: u64) {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if generation >= state.generation {
            state.generation = generation;
            state.session = None;
        }
    }

    pub fn shutdown(&self) {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        state.closed = true;
        state.session = None;
    }
}

fn observe(
    rx: mpsc::Receiver<Option<Event>>,
    roots: Vec<WatchRoot>,
    overflow: Arc<AtomicBool>,
    degraded: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    generation: u64,
    on_change: OnChange,
) {
    let mut pending = HashMap::<usize, BTreeSet<ChangeKind>>::new();
    let mut first = Instant::now();
    let mut last = first;
    let mut version = 0;
    while !stop.load(Ordering::Acquire) {
        let was_empty = pending.is_empty();
        let mut received = false;
        // Shutdown sends a wake message; idle sessions do not wake 20 times/sec.
        let event = if pending.is_empty() {
            rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected)
        } else {
            rx.recv_timeout(Duration::from_millis(50))
        };
        match event {
            Ok(Some(event)) => {
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
            Ok(None) => {}
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
                    ChangeKind::Ignore,
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
        // Slightly longer quiet window reduces refresh storms while the UI is
        // already busy (e.g. scrolling a virtual list after loadMore).
        if !pending.is_empty()
            && (last.elapsed() >= Duration::from_millis(450)
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
                    watch_generation: generation,
                    degraded: degraded.load(Ordering::Acquire),
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
                1,
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
        watcher.release(1);
        assert!(watcher.state.lock().unwrap().session.is_none());
        while rx.try_recv().is_ok() {}
        std::fs::write(dir.path().join("after-close.txt"), "closed").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(500)).is_err());
    }

    #[test]
    fn stale_registrations_and_releases_cannot_replace_a_new_session() {
        let (_dir, root) = fixture();
        let watcher = RepoWatcher::default();
        watcher
            .replace(2, vec![root.clone()], Arc::new(|_| {}))
            .unwrap();
        watcher.replace(1, vec![], Arc::new(|_| {})).unwrap();
        watcher.release(1);
        assert!(watcher.state.lock().unwrap().session.is_some());
        watcher.release(3);
        watcher
            .replace(3, vec![root.clone()], Arc::new(|_| {}))
            .unwrap();
        assert!(watcher.state.lock().unwrap().session.is_none());
        watcher.shutdown();
        watcher.replace(4, vec![root], Arc::new(|_| {})).unwrap();
        assert!(watcher.state.lock().unwrap().session.is_none());
    }

    #[test]
    fn idle_shutdown_wakes_worker_and_same_roots_use_the_new_callback() {
        let (dir, root) = fixture();
        let watcher = RepoWatcher::default();
        let (old_tx, old_rx) = mpsc::channel();
        watcher
            .replace(
                1,
                vec![root.clone()],
                Arc::new(move |e| {
                    let _ = old_tx.send(e);
                }),
            )
            .unwrap();
        let (tx, rx) = mpsc::channel();
        watcher
            .replace(
                2,
                vec![root],
                Arc::new(move |e| {
                    let _ = tx.send(e);
                }),
            )
            .unwrap();
        std::fs::write(dir.path().join("new-session.txt"), "change").unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5))
                .unwrap()
                .watch_generation,
            2
        );
        assert!(old_rx.try_recv().is_err());
        let start = Instant::now();
        watcher.shutdown();
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "idle worker was not woken"
        );
    }

    #[test]
    fn continuous_changes_publish_within_the_maximum_debounce_window() {
        let (_dir, root) = fixture();
        let (tx, rx) = mpsc::sync_channel(1024);
        let (output, events) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let path = root.worktree.join("busy.txt");
        let worker = thread::spawn(move || {
            observe(
                rx,
                vec![root],
                Arc::new(AtomicBool::new(false)),
                Arc::new(AtomicBool::new(false)),
                worker_stop,
                1,
                Arc::new(move |e| {
                    let _ = output.send(e);
                }),
            )
        });
        let sender = tx.clone();
        let producer = thread::spawn(move || {
            for _ in 0..35 {
                let _ = sender.send(Some(Event::new(EventKind::Any).add_path(path.clone())));
                thread::sleep(Duration::from_millis(50));
            }
        });
        let event = events.recv_timeout(Duration::from_millis(1600));
        stop.store(true, Ordering::Release);
        let _ = tx.send(None);
        worker.join().unwrap();
        producer.join().unwrap();
        assert!(event.unwrap().kinds.contains(&ChangeKind::Worktree));
    }

    #[test]
    fn overflow_and_runtime_errors_request_a_full_refresh_and_fallback() {
        let (_dir, root) = fixture();
        let (tx, rx) = mpsc::sync_channel(1);
        let (output, events) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let worker = thread::spawn(move || {
            observe(
                rx,
                vec![root],
                Arc::new(AtomicBool::new(true)),
                Arc::new(AtomicBool::new(true)),
                worker_stop,
                9,
                Arc::new(move |e| {
                    let _ = output.send(e);
                }),
            )
        });
        tx.send(None).unwrap();
        let result = events.recv_timeout(Duration::from_secs(3));
        stop.store(true, Ordering::Release);
        let _ = tx.send(None);
        worker.join().unwrap();
        let event = result.unwrap();
        assert!(event.degraded);
        assert_eq!(event.watch_generation, 9);
        assert_eq!(event.kinds.len(), 6);
    }

    #[test]
    fn real_linked_worktree_observes_private_index_and_common_refs() {
        let dir = tempfile::tempdir().unwrap();
        let common = dir.path().join("main/.git");
        let private = common.join("worktrees/linked");
        let worktree = dir.path().join("linked");
        std::fs::create_dir_all(&private).unwrap();
        std::fs::create_dir_all(common.join("refs/heads")).unwrap();
        std::fs::create_dir_all(&worktree).unwrap();
        let (tx, rx) = mpsc::channel();
        let watcher = RepoWatcher::default();
        watcher
            .replace(
                1,
                vec![WatchRoot::new(
                    RepoId::new("linked"),
                    &worktree,
                    &private,
                    &common,
                )],
                Arc::new(move |e| {
                    let _ = tx.send(e);
                }),
            )
            .unwrap();
        std::fs::write(private.join("index"), "new index").unwrap();
        std::fs::write(common.join("refs/heads/main"), "new ref").unwrap();
        let event = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(event.kinds.contains(&ChangeKind::Index));
        assert!(event.kinds.contains(&ChangeKind::Refs));
        let missing = WatchRoot::new(
            RepoId::new("missing"),
            &dir.path().join("missing"),
            &private,
            &common,
        );
        assert!(watcher.replace(2, vec![missing], Arc::new(|_| {})).is_err());
        assert!(watcher.state.lock().unwrap().session.is_none());
    }
}
