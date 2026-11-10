use gitx_git::{GitInvocation, GitRunner};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn a_cancelled_job_does_not_start_an_executable() {
    let runner = GitRunner::new("gitx-nonexistent-executable");
    let cancel = CancellationToken::new();
    cancel.cancel();
    let error = runner
        .run(
            GitInvocation::new(std::env::temp_dir(), ["status"]),
            &cancel,
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, gitx_core::ErrorCode::Cancelled);
}

#[test]
#[ignore = "child process used by pipe_deadlock_regression"]
fn runner_pipe_fixture() {
    use std::io::{Read, Write};
    if std::env::var("GITX_PIPE_FIXTURE").as_deref() != Ok("1") {
        return;
    }
    std::io::stdout()
        .write_all(&vec![b'x'; 2 * 1024 * 1024])
        .unwrap();
    std::io::stdout().flush().unwrap();
    let mut input = Vec::new();
    std::io::stdin().read_to_end(&mut input).unwrap();
    assert_eq!(input.len(), 2 * 1024 * 1024);
}

#[tokio::test]
async fn pipe_deadlock_regression() {
    let exe = std::env::current_exe()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let runner = GitRunner::new(&exe);
    let invocation = GitInvocation::new(
        std::env::temp_dir(),
        ["--exact", "runner_pipe_fixture", "--ignored", "--nocapture"],
    )
    .git_bin(&exe)
    .env("GITX_PIPE_FIXTURE", "1")
    .stdin(vec![b'p'; 2 * 1024 * 1024])
    .timeout(Some(Duration::from_secs(10)));
    let result = tokio::time::timeout(
        Duration::from_secs(15),
        runner.run(invocation, &CancellationToken::new()),
    )
    .await;
    let output = result
        .expect("runner deadlocked before its timeout")
        .unwrap();
    assert!(output.stdout.len() > 2 * 1024 * 1024);
}

#[test]
#[ignore = "subprocess used by process_tree_cleanup"]
fn runner_descendant_fixture() {
    let Ok(path) = std::env::var("GITX_DESCENDANT_HEARTBEAT") else {
        return;
    };
    if std::env::var("GITX_DESCENDANT_CHILD").as_deref() != Ok("1") {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "runner_descendant_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("GITX_DESCENDANT_CHILD", "1");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        // The root exits immediately. Its descendant still owns the output pipe.
        // Intentionally orphan it to verify GitRunner cleans up the whole tree.
        #[allow(clippy::zombie_processes)]
        let _child = command.spawn().unwrap();
        return;
    }
    // Outlive both parent deadlines so success cannot mean the fixture
    // exited naturally before GitRunner exercised timeout/cancellation.
    for n in 0..3000 {
        std::fs::write(&path, n.to_string()).unwrap();
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[tokio::test]
async fn process_tree_cleanup() {
    for cancelled in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let heartbeat = temp.path().join("heartbeat");
        let exe = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let runner = GitRunner::new(&exe);
        let cancel = CancellationToken::new();
        let token = cancel.clone();
        let invocation = GitInvocation::new(
            temp.path(),
            [
                "--exact",
                "runner_descendant_fixture",
                "--ignored",
                "--nocapture",
            ],
        )
        .git_bin(&exe)
        .env("GITX_DESCENDANT_HEARTBEAT", heartbeat.to_string_lossy())
        // Starting a second Windows test executable can exceed 700ms while
        // builds/UI automation are active. Allow startup before exercising
        // cleanup; the heartbeat must still stop after timeout/cancellation.
        .timeout(Some(Duration::from_secs(if cancelled { 10 } else { 5 })));
        let task = tokio::spawn(async move { runner.run(invocation, &token).await });
        let started = tokio::time::timeout(Duration::from_secs(4), async {
            while !heartbeat.exists() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await;
        assert!(started.is_ok(), "descendant did not start");
        if cancelled {
            cancel.cancel();
        }
        let result = task
            .await
            .unwrap()
            .expect_err("operation must time out or cancel");
        assert_eq!(
            result.code,
            if cancelled {
                gitx_core::ErrorCode::Cancelled
            } else {
                gitx_core::ErrorCode::Timeout
            }
        );
        tokio::time::sleep(Duration::from_millis(150)).await;
        let first = std::fs::read(&heartbeat).unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(
            first,
            std::fs::read(&heartbeat).unwrap(),
            "descendant survived cancellation"
        );
    }
}

#[test]
#[ignore = "subprocess used by blocked_stdin_obeys_timeout"]
fn runner_stdin_fixture() {
    if std::env::var("GITX_STDIN_FIXTURE").as_deref() != Ok("1") {
        return;
    }
    // Simulate a helper that never consumes its input. The runner's own
    // deadline must cover writing stdin, not just waiting for the exit code.
    std::thread::sleep(Duration::from_secs(10));
}

#[tokio::test]
async fn blocked_stdin_obeys_timeout() {
    let exe = std::env::current_exe()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let runner = GitRunner::new(&exe);
    let inv = GitInvocation::new(
        std::env::temp_dir(),
        [
            "--exact",
            "runner_stdin_fixture",
            "--ignored",
            "--nocapture",
        ],
    )
    .git_bin(&exe)
    .env("GITX_STDIN_FIXTURE", "1")
    .stdin(vec![b'p'; 8 * 1024 * 1024])
    .timeout(Some(Duration::from_secs(1)));
    let result = tokio::time::timeout(
        Duration::from_secs(3),
        runner.run(inv, &CancellationToken::new()),
    )
    .await
    .expect("stdin write ignored the invocation deadline")
    .expect_err("the input consumer must time out");
    assert_eq!(result.code, gitx_core::ErrorCode::Timeout);
}

#[cfg(windows)]
#[tokio::test]
async fn dropping_an_invocation_also_terminates_orphaned_descendants() {
    let temp = tempfile::tempdir().unwrap();
    let heartbeat = temp.path().join("heartbeat");
    let exe = std::env::current_exe()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let runner = GitRunner::new(&exe);
    let inv = GitInvocation::new(
        temp.path(),
        [
            "--exact",
            "runner_descendant_fixture",
            "--ignored",
            "--nocapture",
        ],
    )
    .git_bin(&exe)
    .env("GITX_DESCENDANT_HEARTBEAT", heartbeat.to_string_lossy())
    .timeout(Some(Duration::from_secs(30)));
    let task = tokio::spawn(async move { runner.run(inv, &CancellationToken::new()).await });
    tokio::time::timeout(Duration::from_secs(4), async {
        while !heartbeat.exists() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("descendant did not start");
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    tokio::time::sleep(Duration::from_millis(150)).await;
    let first = std::fs::read(&heartbeat).unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        first,
        std::fs::read(&heartbeat).unwrap(),
        "descendant outlived the invocation"
    );
}
