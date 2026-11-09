use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Weak};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

/// Per-repo Write/NetworkWrite mutual exclusion; Read concurrent.
pub struct RepoScheduler {
    write_locks: Mutex<HashMap<String, Weak<Semaphore>>>,
}

impl Default for RepoScheduler {
    fn default() -> Self {
        Self {
            write_locks: Mutex::new(HashMap::new()),
        }
    }
}

impl RepoScheduler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Repository writes share the Git common directory, including linked
    /// worktrees, subdirectories and filesystem aliases. Acquire the caller's
    /// GitRunner/settings read lock before entering this scheduler.
    pub async fn acquire_repo_write(
        &self,
        git: &GitRunner,
        repo: &str,
        cancel: &CancellationToken,
    ) -> Result<Vec<OwnedSemaphorePermit>, AppError> {
        self.acquire_repo_writes(git, &[repo.into()], &[], cancel)
            .await
    }

    /// Resolve and acquire the entire group in one order. Destinations also
    /// reserve their future `.git` directory so clone/init remain excluded
    /// when a repository becomes discoverable partway through the operation.
    /// Relative destinations must already be resolved against the Git cwd.
    pub async fn acquire_repo_writes(
        &self,
        git: &GitRunner,
        repos: &[String],
        destinations: &[PathBuf],
        cancel: &CancellationToken,
    ) -> Result<Vec<OwnedSemaphorePermit>, AppError> {
        let acquire = async {
            loop {
                let keys = repository_keys(git, repos, destinations, cancel).await?;
                let permits = self.acquire_writes(&keys).await;
                // A queued remove/create may have changed the repository's
                // identity. Never run using keys discovered before that change.
                if keys == repository_keys(git, repos, destinations, cancel).await? {
                    return Ok(permits);
                }
                drop(permits);
            }
        };
        tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(AppError::new(ErrorCode::Cancelled, "operation cancelled")),
            result = acquire => result,
        }
    }

    pub async fn with_repo_permit<F, T>(
        &self,
        git: &GitRunner,
        repo: &str,
        kind: OpKind,
        cancel: &CancellationToken,
        f: F,
    ) -> Result<T, AppError>
    where
        F: std::future::Future<Output = Result<T, AppError>>,
    {
        match kind {
            OpKind::Write | OpKind::NetworkWrite => {
                let _permits = self.acquire_repo_write(git, repo, cancel).await?;
                f.await
            }
            OpKind::Read | OpKind::Network => f.await,
        }
    }

    async fn write_sem(&self, repo_key: &str) -> Arc<Semaphore> {
        let repo_key = gitx_core::host_path_key(repo_key);
        let mut map = self.write_locks.lock().await;
        // Waiting and running operations keep their semaphore alive. Reclaim
        // idle entries on the next write, including when a future was dropped.
        map.retain(|_, sem| sem.strong_count() > 0);
        if let Some(sem) = map.get(&repo_key).and_then(Weak::upgrade) {
            return sem;
        }
        let sem = Arc::new(Semaphore::new(1));
        map.insert(repo_key, Arc::downgrade(&sem));
        sem
    }

    /// Low-level logical-key locking. Repository command handlers must use
    /// acquire_repo_write(s), which resolves Git and filesystem identities.
    async fn acquire_write(&self, repo_key: &str) -> OwnedSemaphorePermit {
        self.write_sem(repo_key)
            .await
            .acquire_owned()
            .await
            .expect("semaphore closed")
    }

    /// A stable order prevents two multi-root operations from waiting on each
    /// other's first root. Deduplication also covers Windows path aliases.
    async fn acquire_writes(&self, repo_keys: &[String]) -> Vec<OwnedSemaphorePermit> {
        let mut keys: Vec<_> = repo_keys
            .iter()
            .map(|key| gitx_core::host_path_key(key))
            .collect();
        keys.sort();
        keys.dedup();
        let mut permits = Vec::with_capacity(keys.len());
        for key in keys {
            permits.push(self.acquire_write(&key).await);
        }
        permits
    }

    #[cfg(test)]
    async fn with_permit<F, T>(&self, repo_key: &str, kind: OpKind, f: F) -> T
    where
        F: std::future::Future<Output = T>,
    {
        match kind {
            OpKind::Write | OpKind::NetworkWrite => {
                let _permit = self.acquire_write(repo_key).await;
                f.await
            }
            OpKind::Read | OpKind::Network => f.await,
        }
    }
}

async fn repository_keys(
    git: &GitRunner,
    repos: &[String],
    destinations: &[PathBuf],
    cancel: &CancellationToken,
) -> Result<Vec<String>, AppError> {
    let mut keys = Vec::new();
    for repo in repos {
        keys.extend(repository_scope_keys(git, Path::new(repo), cancel).await?);
    }
    for destination in destinations {
        keys.push(canonical_key(destination).await?);
        keys.push(canonical_key(&destination.join(".git")).await?);
        match tokio::fs::metadata(destination).await {
            Ok(metadata) if metadata.is_dir() => {
                match repository_scope_keys(git, destination, cancel).await {
                    Ok(scope) => keys.extend(scope),
                    Err(error) if error.code == ErrorCode::NotARepository => {
                        // Absence is valid for a new destination; a broken
                        // repository marker must not downgrade to path-only locking.
                        let marker = destination.join(".git");
                        match tokio::fs::symlink_metadata(&marker).await {
                            Ok(_) => return Err(error),
                            Err(io) if io.kind() == std::io::ErrorKind::NotFound => {}
                            Err(io) => return Err(path_error(&marker, io)),
                        }
                    }
                    Err(error) => return Err(error),
                }
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(path_error(destination, error)),
        }
    }
    keys.sort();
    keys.dedup();
    Ok(keys)
}

/// Submodule writes also reserve their superprojects. This covers recursive
/// writes without discovering children before an update changes .gitmodules.
/// Inspect absorbed module gitdirs as well: a module's external linked worktree
/// has no containing superproject worktree but still shares its module refs.
async fn repository_scope_keys(
    git: &GitRunner,
    cwd: &Path,
    cancel: &CancellationToken,
) -> Result<Vec<String>, AppError> {
    let mut pending = vec![(cwd.to_path_buf(), false)];
    let mut seen = HashSet::new();
    let mut keys = Vec::new();
    while let Some((cwd, explicit_git_dir)) = pending.pop() {
        let cwd_key = canonical_key(&cwd).await?;
        if !seen.insert((cwd_key.clone(), explicit_git_dir)) {
            continue;
        }
        let args = if explicit_git_dir {
            vec!["--git-dir=.", "rev-parse", "--git-common-dir"]
        } else {
            vec![
                "rev-parse",
                "--git-common-dir",
                "--is-bare-repository",
                "--show-superproject-working-tree",
            ]
        };
        let output = git
            .run(GitInvocation::new(&cwd, args), cancel)
            .await
            .map_err(|mut error| {
                if error.code == ErrorCode::GitCommandFailed {
                    error.code = crate::StderrClassifier::classify(
                        error.git_stderr.as_deref().unwrap_or(""),
                        error.exit_code.unwrap_or(-1),
                    );
                }
                error
            })?;
        let raw = std::str::from_utf8(&output.stdout)
            .map_err(|_| AppError::new(ErrorCode::FsError, "Git common directory is not UTF-8"))?
            .trim_end_matches(['\r', '\n']);
        let mut lines = raw.split('\n').map(|line| line.trim_end_matches('\r'));
        let common = lines.next().unwrap_or("");
        if common.is_empty() {
            return Err(AppError::new(
                ErrorCode::NotARepository,
                "Git returned an empty common directory",
            ));
        }
        let common = crate::resolve_git_path(&cwd, common);
        let common_key = canonical_key(&common).await?;
        keys.push(cwd_key);
        keys.push(common_key.clone());
        if !explicit_git_dir {
            let bare = lines.next() == Some("true");
            if let Some(parent) = lines.next().filter(|path| !path.is_empty()) {
                pending.push((crate::resolve_git_path(&cwd, parent), false));
            }
            // Old-form submodules keep a real .git directory in their main
            // worktree. An external linked worktree does not report that
            // main worktree's superproject, so discover its scope as well.
            if !bare && common.file_name().is_some_and(|name| name == ".git") {
                if let Some(main_worktree) = common.parent() {
                    pending.push((main_worktree.to_path_buf(), false));
                }
            }
        }
        for ancestor in Path::new(&common_key).ancestors().skip(1) {
            if ancestor.file_name().is_some_and(|name| name == "modules") {
                if let Some(parent) = ancestor.parent() {
                    match tokio::fs::metadata(parent.join("HEAD")).await {
                        Ok(metadata) if metadata.is_file() => {
                            pending.push((parent.to_path_buf(), true))
                        }
                        Ok(_) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(path_error(parent, error)),
                    }
                }
            }
        }
    }
    keys.sort();
    keys.dedup();
    Ok(keys)
}

fn path_error(path: &Path, error: std::io::Error) -> AppError {
    AppError::new(
        ErrorCode::FsError,
        format!("resolve repository path {}: {error}", path.display()),
    )
}

/// Canonicalize existing ancestors, preserving a stable key before a clone
/// destination exists. Filesystem errors other than absence are not ignored.
async fn canonical_key(path: &Path) -> Result<String, AppError> {
    let mut ancestor = std::path::absolute(path).map_err(|error| path_error(path, error))?;
    let mut suffix = Vec::new();
    let canonical = loop {
        match tokio::fs::canonicalize(&ancestor).await {
            Ok(canonical) => break canonical,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let component = ancestor
                    .components()
                    .next_back()
                    .ok_or_else(|| path_error(path, error))?;
                suffix.push(component.as_os_str().to_owned());
                if !ancestor.pop() {
                    return Err(AppError::new(
                        ErrorCode::FsError,
                        "repository path has no existing ancestor",
                    ));
                }
            }
            Err(error) => return Err(path_error(path, error)),
        }
    };
    let mut resolved = canonical;
    for component in suffix.into_iter().rev() {
        match Path::new(&component).components().next() {
            Some(Component::ParentDir) => {
                resolved.pop();
            }
            Some(Component::CurDir) => {}
            _ => resolved.push(component),
        }
    }
    let path = resolved
        .to_str()
        .ok_or_else(|| AppError::new(ErrorCode::FsError, "repository path is not UTF-8"))?;
    Ok(gitx_core::host_path_key(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_and_other_repositories_continue_while_writers_wait() {
        let scheduler = RepoScheduler::new();
        let permit = scheduler.acquire_write("repo").await;
        let write = scheduler.with_permit("repo", OpKind::NetworkWrite, async { 42 });
        tokio::pin!(write);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), &mut write)
                .await
                .is_err()
        );
        assert_eq!(
            scheduler
                .with_permit("repo", OpKind::Read, async { 7 })
                .await,
            7
        );
        assert_eq!(
            scheduler
                .with_permit("other", OpKind::Write, async { 8 })
                .await,
            8
        );
        drop(permit);
        assert_eq!(
            tokio::time::timeout(std::time::Duration::from_secs(1), write)
                .await
                .unwrap(),
            42
        );
    }

    #[tokio::test]
    async fn multi_root_permits_are_deduplicated_and_cancelled_waits_release_all_roots() {
        let scheduler = RepoScheduler::new();
        let held = scheduler.acquire_write("b").await;
        let roots = ["b".into(), "a".into(), "a".into()];
        let mut waiting = Box::pin(scheduler.acquire_writes(&roots));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), &mut waiting)
                .await
                .is_err()
        );
        // The group must hold a while waiting for b, despite the reverse input
        // order. Dropping this in-flight future must release that partial group.
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(50),
            scheduler.acquire_write("a")
        )
        .await
        .is_err());
        drop(waiting);
        let a = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            scheduler.acquire_write("a"),
        )
        .await
        .unwrap();
        drop(a);
        drop(held);
        let permits = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            scheduler.acquire_writes(&roots),
        )
        .await
        .unwrap();
        assert_eq!(permits.len(), 2);
    }

    #[tokio::test]
    #[cfg(windows)]
    async fn windows_aliases_cannot_bypass_the_write_lock() {
        let scheduler = RepoScheduler::new();
        let held = scheduler.acquire_write(r"\\?\C:\Repo\").await;
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(50),
            scheduler.acquire_write("c:/repo")
        )
        .await
        .is_err());
        drop(held);
        let permits = scheduler
            .acquire_writes(&[r"C:\Repo".into(), "c:/repo/".into()])
            .await;
        assert_eq!(permits.len(), 1);
        drop(permits);
        let wsl = scheduler.acquire_write(r"\\wsl$\Ubuntu\home\Repo").await;
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(50),
            scheduler.acquire_write("//wsl.localhost/ubuntu/home/Repo")
        )
        .await
        .is_err());
        let case_sensitive = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            scheduler.acquire_write("//wsl.localhost/ubuntu/home/repo"),
        )
        .await
        .unwrap();
        drop((wsl, case_sensitive));
    }

    #[tokio::test]
    async fn idle_repository_entries_do_not_accumulate() {
        let scheduler = RepoScheduler::new();
        for n in 0..1_000 {
            scheduler
                .with_permit(&format!("repo-{n}"), OpKind::Write, async {})
                .await;
        }
        assert_eq!(scheduler.write_locks.lock().await.len(), 1);
    }

    #[tokio::test]
    async fn queued_writers_share_a_lock_and_cancellation_releases_it() {
        let scheduler = Arc::new(RepoScheduler::new());
        let sem = scheduler.write_sem("repo").await;
        let permit = sem.acquire().await.unwrap();
        let waiting = Arc::clone(&scheduler);
        let task = tokio::spawn(async move {
            waiting
                .with_permit("repo", OpKind::Write, async { 42 })
                .await
        });
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        assert!(Arc::ptr_eq(&sem, &scheduler.write_sem("repo").await));
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        drop(permit);
        drop(sem);
        let next = scheduler
            .with_permit("repo", OpKind::NetworkWrite, async { 7 })
            .await;
        assert_eq!(next, 7);
        assert!(scheduler.write_locks.lock().await["repo"]
            .upgrade()
            .is_none());
    }
}
