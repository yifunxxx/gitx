use gitx_core::{AppError, ErrorCode, FetchTagsPolicy};
use gitx_git::{GitInvocation, GitRunner, OpKind, RepoScheduler};
use gitx_testkit::FixtureBuilder;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

const LIMIT: Duration = Duration::from_secs(10);

#[tokio::test]
async fn background_does_not_queue_behind_an_existing_writer() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let git = GitRunner::new("git");
    let scheduler = RepoScheduler::new();
    let cancel = CancellationToken::new();
    let held = scheduler
        .acquire_repo_write(&git, repo.path().to_str().unwrap(), &cancel)
        .await
        .unwrap();
    let result = tokio::time::timeout(
        LIMIT,
        scheduler.with_background_repo_write(&git, repo.path().to_str().unwrap(), &cancel, async {
            panic!("background ran while writer held the repository");
            #[allow(unreachable_code)]
            Ok(())
        }),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert_eq!(result.code, ErrorCode::Cancelled);
    drop(held);
    scheduler
        .with_background_repo_write(&git, repo.path().to_str().unwrap(), &cancel, async {
            Ok(())
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn foreground_preempts_background_but_waits_for_its_cleanup() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let path = repo.path().to_str().unwrap();
    let git = GitRunner::new("git");
    let scheduler = RepoScheduler::new();
    let background_cancel = CancellationToken::new();
    let foreground_cancel = CancellationToken::new();
    let (started, entered) = tokio::sync::oneshot::channel();
    let (release, cleaned) = tokio::sync::oneshot::channel();
    let running = scheduler.with_background_repo_write(&git, path, &background_cancel, async {
        started.send(()).unwrap();
        background_cancel.cancelled().await;
        cleaned.await.unwrap();
        Err::<(), _>(AppError::new(ErrorCode::Cancelled, "cancelled and cleaned"))
    });
    tokio::pin!(running);
    tokio::select! { _ = entered => {}, _ = &mut running => panic!("background finished early") }
    let write = scheduler.acquire_repo_write(&git, path, &foreground_cancel);
    tokio::pin!(write);
    tokio::select! {
        _ = background_cancel.cancelled() => {},
        _ = &mut write => panic!("write did not wait for background cleanup"),
        _ = tokio::time::sleep(LIMIT) => panic!("write did not preempt background"),
    }
    assert!(tokio::time::timeout(Duration::from_millis(50), &mut write)
        .await
        .is_err());
    release.send(()).unwrap();
    assert_eq!(running.await.unwrap_err().code, ErrorCode::Cancelled);
    drop(tokio::time::timeout(LIMIT, write).await.unwrap().unwrap());
}

#[tokio::test]
async fn unrelated_writer_does_not_cancel_background_work() {
    let a = FixtureBuilder::new().build("clean").unwrap();
    let b = FixtureBuilder::new().build("clean").unwrap();
    let git = GitRunner::new("git");
    let scheduler = RepoScheduler::new();
    let cancel = CancellationToken::new();
    scheduler
        .with_background_repo_write(&git, a.path().to_str().unwrap(), &cancel, async {
            let _held = scheduler
                .acquire_repo_write(&git, b.path().to_str().unwrap(), &CancellationToken::new())
                .await?;
            assert!(!cancel.is_cancelled());
            Ok(())
        })
        .await
        .unwrap();
}

// A loopback HTTP peer accepts connections without replying. A real git fetch
// blocks in network I/O; teardown closes the sockets even if an assertion fails.
struct SilentRemote {
    address: String,
    accepted: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl SilentRemote {
    fn new() -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = format!("http://{}/repo.git", listener.local_addr().unwrap());
        let accepted = Arc::new(AtomicBool::new(false));
        let stop = Arc::new(AtomicBool::new(false));
        let (s, a) = (stop.clone(), accepted.clone());
        let thread = std::thread::spawn(move || {
            let mut sockets = Vec::new();
            while !s.load(Ordering::SeqCst) {
                if let Ok((socket, _)) = listener.accept() {
                    sockets.push(socket);
                    a.store(true, Ordering::SeqCst);
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        Self {
            address,
            accepted,
            stop,
            thread: Some(thread),
        }
    }
}
impl Drop for SilentRemote {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.thread.take().unwrap().join().unwrap();
    }
}

#[tokio::test]
async fn real_slow_fetch_is_cancelled_before_a_linked_worktree_write_runs() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let linked_dir = tempfile::tempdir().unwrap();
    let linked = linked_dir.path().join("linked");
    let git = GitRunner::new("git");
    let scheduler = RepoScheduler::new();
    let cancel = CancellationToken::new();
    let peer = SilentRemote::new();
    for args in [
        vec!["remote", "add", "origin", &peer.address],
        vec!["config", "http.proxy", ""],
        vec!["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    ] {
        git.run(
            GitInvocation::new(repo.path(), args).kind(OpKind::Write),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    }
    let before = git
        .run(
            GitInvocation::new(repo.path(), ["rev-parse", "HEAD"]),
            &cancel,
        )
        .await
        .unwrap()
        .stdout;
    let fetch = scheduler.with_background_repo_write(
        &git,
        repo.path().to_str().unwrap(),
        &cancel,
        git.fetch_run(
            repo.path(),
            Some("origin"),
            true,
            FetchTagsPolicy::Auto,
            &cancel,
        ),
    );
    tokio::pin!(fetch);
    tokio::select! {
        result = &mut fetch => panic!("fetch ended before waiting: {result:?}"),
        _ = async {
            tokio::time::timeout(LIMIT, async {
                while !peer.accepted.load(Ordering::SeqCst) { tokio::time::sleep(Duration::from_millis(10)).await; }
            }).await.expect("fetch never connected");
        } => {},
    }
    let write_cancel = CancellationToken::new();
    let write = scheduler.with_repo_permit(
        &git,
        linked.to_str().unwrap(),
        OpKind::Write,
        &write_cancel,
        git.run(
            GitInvocation::new(&linked, ["update-ref", "refs/heads/foreground", "HEAD"])
                .kind(OpKind::Write),
            &write_cancel,
        ),
    );
    let (fetched, written) = tokio::time::timeout(LIMIT, async { tokio::join!(fetch, write) })
        .await
        .unwrap();
    assert_eq!(fetched.unwrap_err().code, ErrorCode::Cancelled);
    written.unwrap();
    let after = git
        .run(
            GitInvocation::new(repo.path(), ["rev-parse", "HEAD"]),
            &write_cancel,
        )
        .await
        .unwrap()
        .stdout;
    assert_eq!(before, after);
    assert!(git
        .run(
            GitInvocation::new(repo.path(), ["status", "--porcelain"]),
            &write_cancel
        )
        .await
        .unwrap()
        .stdout
        .is_empty());
}
