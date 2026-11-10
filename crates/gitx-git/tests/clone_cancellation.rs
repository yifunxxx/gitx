use gitx_core::{ErrorCode, JobKind};
use gitx_git::{GitRunner, JobManager, RepoScheduler};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn cancelled_clone_does_not_create_parent_directories() {
    let temp = tempfile::tempdir().unwrap();
    let destination = temp.path().join("not-created").join("clone");
    let cancel = CancellationToken::new();
    cancel.cancel();
    let result = GitRunner::new("git")
        .clone_run("unused", &destination, None, None, &cancel)
        .await
        .unwrap_err();
    assert_eq!(result.code, ErrorCode::Cancelled);
    assert!(!destination.parent().unwrap().exists());
}

#[tokio::test]
async fn a_nonempty_destination_is_preserved_on_failure() {
    let temp = tempfile::tempdir().unwrap();
    let marker = temp.path().join("keep.txt");
    std::fs::write(&marker, "user content").unwrap();
    let result = GitRunner::new("git")
        .clone_run("unused", temp.path(), None, None, &CancellationToken::new())
        .await
        .unwrap_err();
    assert_eq!(result.code, ErrorCode::FsError);
    assert_eq!(std::fs::read_to_string(marker).unwrap(), "user content");
}

#[cfg(windows)]
#[tokio::test]
async fn cancelling_a_started_clone_preserves_files_created_by_another_writer() {
    use std::net::TcpListener;

    let temp = tempfile::tempdir().unwrap();
    let destination = temp.path().join("clone");
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/stalled.git", listener.local_addr().unwrap());
    let cancel = CancellationToken::new();
    let token = cancel.clone();
    let target = destination.clone();
    let task = tokio::spawn(async move {
        GitRunner::new("git")
            .clone_run(&url, &target, None, None, &token)
            .await
    });
    let connected = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                Err(err) => panic!("fixture listener failed: {err}"),
            }
        }
    })
    .await;
    if connected.is_err() {
        cancel.cancel();
        panic!("clone did not connect to fixture: {:?}", task.await);
    }
    let _connection = connected.unwrap();
    // The destination did not exist when clone_run checked it. A different
    // writer can create content while Git is waiting for a remote response.
    std::fs::create_dir_all(&destination).unwrap();
    let marker = destination.join("keep.txt");
    std::fs::write(&marker, "concurrent user content").unwrap();
    cancel.cancel();
    let error = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .expect("clone did not stop")
        .unwrap()
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(
        std::fs::read_to_string(marker).expect("cancellation removed another writer's file"),
        "concurrent user content"
    );
}

#[tokio::test]
async fn a_queued_clone_can_be_cancelled_before_touching_its_destination() {
    let temp = tempfile::tempdir().unwrap();
    let destination = temp.path().join("queued");
    let runner = GitRunner::new("git");
    let scheduler = RepoScheduler::new();
    let jobs = JobManager::new();
    let held = scheduler
        .acquire_repo_writes(
            &runner,
            &[],
            std::slice::from_ref(&destination),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    let job = jobs
        .start(JobKind::NetworkWrite, "clone", vec![], true, false)
        .await;
    let run = async {
        let _permits = scheduler
            .acquire_repo_writes(
                &runner,
                &[],
                std::slice::from_ref(&destination),
                &job.cancel,
            )
            .await?;
        runner
            .clone_run("unused", &destination, None, None, &job.cancel)
            .await
    };
    tokio::pin!(run);
    tokio::select! {
        _ = &mut run => panic!("clone bypassed its destination lock"),
        _ = tokio::time::sleep(Duration::from_millis(100)) => {}
    }
    assert!(jobs.cancel(&job.info.id).await);
    let error = tokio::time::timeout(Duration::from_secs(2), &mut run)
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert!(!destination.exists());
    jobs.finish(&job.info.id, false, Some(error), None).await;
    assert!(jobs.list().await.is_empty());
    drop(held);
    assert!(tokio::time::timeout(
        Duration::from_secs(2),
        scheduler.acquire_repo_writes(
            &runner,
            &[],
            std::slice::from_ref(&destination),
            &CancellationToken::new()
        ),
    )
    .await
    .unwrap()
    .is_ok());
}
