use gitx_core::{ErrorCode, RepoOpKind, RepoOpPhase, RewriteOutcome};
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::{fs, path::Path, process::Command};
use tokio_util::sync::CancellationToken;

fn git(path: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .trim_end()
        .to_owned()
}

async fn conflicted_revert_remains_recoverable(abort: bool, no_commit: bool) {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let path = repo.path();
    git(path, &["config", "core.autocrlf", "false"]);
    fs::write(path.join("state.txt"), "base\n").unwrap();
    git(path, &["add", "state.txt"]);
    git(path, &["commit", "-m", "base"]);
    fs::write(path.join("state.txt"), "target\n").unwrap();
    git(path, &["commit", "-am", "target"]);
    let target = git(path, &["rev-parse", "HEAD"]);
    fs::write(path.join("state.txt"), "later\n").unwrap();
    git(path, &["commit", "-am", "later"]);
    let head = git(path, &["rev-parse", "HEAD"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .revert_run(path, &[target], None, no_commit, &cancel)
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::Conflicts);
    let state = runner.repo_op_state(path, &cancel).await.unwrap();
    assert_eq!(state.kind, RepoOpKind::Revert);
    assert_eq!(state.phase, RepoOpPhase::Conflicted);
    assert_eq!(state.conflict_count, 1);
    let blocked = runner
        .reword_commit(path, "HEAD", "must not run", &cancel)
        .await
        .unwrap_err();
    assert_eq!(blocked.code, ErrorCode::OperationInProgress);
    if abort {
        runner.revert_abort(path, &cancel).await.unwrap();
        assert_eq!(git(path, &["rev-parse", "HEAD"]), head);
        assert_eq!(fs::read(path.join("state.txt")).unwrap(), b"later\n");
    } else {
        runner
            .conflict_save_result(path, "state.txt", "resolved\n", &cancel)
            .await
            .unwrap();
        let state = runner.repo_op_state(path, &cancel).await.unwrap();
        assert_eq!(state.kind, RepoOpKind::Revert);
        assert_eq!(state.phase, RepoOpPhase::ReadyToContinue);
        runner.revert_continue(path, &cancel).await.unwrap();
        assert_eq!(fs::read(path.join("state.txt")).unwrap(), b"resolved\n");
        // Native Git's single-commit `revert --continue` creates a commit even
        // when the initial invocation used --no-commit.
        assert_eq!(git(path, &["rev-parse", "HEAD^"]), head);
        assert!(git(path, &["status", "--porcelain"]).is_empty());
    }
    assert_eq!(
        runner.repo_op_state(path, &cancel).await.unwrap().kind,
        RepoOpKind::Normal
    );
}

#[tokio::test]
async fn single_revert_conflict_can_continue() {
    conflicted_revert_remains_recoverable(false, false).await;
}

#[tokio::test]
async fn single_revert_conflict_can_abort() {
    conflicted_revert_remains_recoverable(true, false).await;
}

#[tokio::test]
async fn no_commit_revert_conflict_can_continue() {
    conflicted_revert_remains_recoverable(false, true).await;
}

#[tokio::test]
async fn no_commit_revert_conflict_can_abort() {
    conflicted_revert_remains_recoverable(true, true).await;
}
