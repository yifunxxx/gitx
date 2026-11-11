use gitx_core::ErrorCode;
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::process::Command;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn head_message_reports_an_unborn_head_instead_of_an_empty_message() {
    let repo = FixtureBuilder::new().build("empty").unwrap();
    let error = GitRunner::new("git")
        .head_message(repo.path(), &CancellationToken::new())
        .await
        .unwrap_err();
    assert!(error.git_stderr.is_some());
}

#[tokio::test]
async fn head_message_preserves_cancellation() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cancel = CancellationToken::new();
    cancel.cancel();
    let error = GitRunner::new("git")
        .head_message(repo.path(), &cancel)
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
}

#[tokio::test]
async fn head_message_preserves_full_body_and_accepts_a_real_empty_message() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let output = Command::new("git")
        .current_dir(repo.path())
        .args([
            "commit",
            "--amend",
            "-m",
            "subject",
            "-m",
            "body line 1\nbody line 2",
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        runner.head_message(repo.path(), &cancel).await.unwrap(),
        "subject\n\nbody line 1\nbody line 2\n\n"
    );
    let output = Command::new("git")
        .current_dir(repo.path())
        .args(["commit", "--amend", "--allow-empty-message", "-m", ""])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(runner
        .head_message(repo.path(), &cancel)
        .await
        .unwrap()
        .trim()
        .is_empty());
}
