use gitx_git::{GitInvocation, GitRunner, OpKind, RepoScheduler};
use gitx_testkit::FixtureBuilder;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

const WAIT: Duration = Duration::from_millis(500);
const FINISH: Duration = Duration::from_secs(10);

async fn blocked<F: std::future::Future>(future: F) {
    assert!(tokio::time::timeout(WAIT, future).await.is_err());
}

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
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

#[tokio::test]
async fn linked_worktree_cannot_write_shared_refs_while_main_is_locked() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let linked_dir = tempfile::tempdir().unwrap();
    let linked = linked_dir.path().join("linked 中文 空格");
    git(
        repo.path(),
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    );
    let scheduler = RepoScheduler::new();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let held = scheduler
        .acquire_repo_write(&runner, repo.path().to_str().unwrap(), &cancel)
        .await
        .unwrap();
    let write = scheduler.with_repo_permit(
        &runner,
        linked.to_str().unwrap(),
        OpKind::Write,
        &cancel,
        runner.run(
            GitInvocation::new(&linked, ["update-ref", "refs/heads/queued", "HEAD"])
                .kind(OpKind::Write),
            &cancel,
        ),
    );
    tokio::pin!(write);
    assert!(
        tokio::time::timeout(Duration::from_millis(500), &mut write)
            .await
            .is_err(),
        "linked worktree bypassed the main repository lock"
    );
    assert!(git(repo.path(), &["for-each-ref", "refs/heads/queued"]).is_empty());
    drop(held);
    tokio::time::timeout(Duration::from_secs(5), write)
        .await
        .unwrap()
        .unwrap();
    assert!(!git(repo.path(), &["for-each-ref", "refs/heads/queued"]).is_empty());
}

#[tokio::test]
async fn subdirectories_relative_paths_and_dot_segments_share_the_repository_lock() {
    let temp = tempfile::tempdir_in(std::env::current_dir().unwrap()).unwrap();
    git(temp.path(), &["init", "-b", "main"]);
    let subdir = temp.path().join("a/b");
    std::fs::create_dir_all(&subdir).unwrap();
    let scheduler = RepoScheduler::new();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let held = scheduler
        .acquire_repo_write(&runner, temp.path().to_str().unwrap(), &cancel)
        .await
        .unwrap();
    let relative = temp
        .path()
        .strip_prefix(std::env::current_dir().unwrap())
        .unwrap()
        .join("a/../a/b");
    blocked(scheduler.acquire_repo_write(&runner, relative.to_str().unwrap(), &cancel)).await;
    blocked(scheduler.acquire_repo_write(&runner, subdir.to_str().unwrap(), &cancel)).await;
    drop(held);
    tokio::time::timeout(
        FINISH,
        scheduler.acquire_repo_write(&runner, relative.to_str().unwrap(), &cancel),
    )
    .await
    .unwrap()
    .unwrap();
}

#[tokio::test]
async fn bare_repository_and_linked_worktree_share_the_same_lock() {
    let source = FixtureBuilder::new().build("clean").unwrap();
    let temp = tempfile::tempdir().unwrap();
    let bare = temp.path().join("bare.git");
    let linked = temp.path().join("linked");
    git(
        temp.path(),
        &[
            "clone",
            "--bare",
            source.path().to_str().unwrap(),
            bare.to_str().unwrap(),
        ],
    );
    git(
        &bare,
        &["worktree", "add", linked.to_str().unwrap(), "main"],
    );
    let scheduler = RepoScheduler::new();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let held = scheduler
        .acquire_repo_write(&runner, bare.to_str().unwrap(), &cancel)
        .await
        .unwrap();
    blocked(scheduler.acquire_repo_write(&runner, linked.to_str().unwrap(), &cancel)).await;
    drop(held);
    // Main/common aliases and duplicate roots cannot make a group deadlock.
    let roots = vec![
        linked.display().to_string(),
        bare.display().to_string(),
        linked.display().to_string(),
    ];
    tokio::time::timeout(
        FINISH,
        scheduler.acquire_repo_writes(&runner, &roots, &[], &cancel),
    )
    .await
    .unwrap()
    .unwrap();
}

#[tokio::test]
async fn unrelated_repositories_and_reads_continue_during_a_write() {
    let a = FixtureBuilder::new().build("clean").unwrap();
    let b = FixtureBuilder::new().build("clean").unwrap();
    let scheduler = RepoScheduler::new();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let _held = scheduler
        .acquire_repo_write(&runner, a.path().to_str().unwrap(), &cancel)
        .await
        .unwrap();
    tokio::time::timeout(
        FINISH,
        scheduler.with_repo_permit(
            &runner,
            a.path().to_str().unwrap(),
            OpKind::Read,
            &cancel,
            runner.run(GitInvocation::new(a.path(), ["rev-parse", "HEAD"]), &cancel),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    tokio::time::timeout(
        FINISH,
        scheduler.acquire_repo_write(&runner, b.path().to_str().unwrap(), &cancel),
    )
    .await
    .unwrap()
    .unwrap();
}

#[tokio::test]
async fn cancelling_a_queued_repository_write_does_not_run_its_body() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let scheduler = RepoScheduler::new();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let held = scheduler
        .acquire_repo_write(&runner, repo.path().to_str().unwrap(), &cancel)
        .await
        .unwrap();
    let queued_cancel = CancellationToken::new();
    let mut queued = Box::pin(scheduler.with_repo_permit(
        &runner,
        repo.path().to_str().unwrap(),
        OpKind::Write,
        &queued_cancel,
        async {
            panic!("cancelled write body ran");
            #[allow(unreachable_code)]
            Ok(())
        },
    ));
    blocked(&mut queued).await;
    queued_cancel.cancel();
    let error = tokio::time::timeout(FINISH, queued)
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(error.code, gitx_core::ErrorCode::Cancelled);
    drop(held);
    tokio::time::timeout(
        FINISH,
        scheduler.acquire_repo_write(&runner, repo.path().to_str().unwrap(), &cancel),
    )
    .await
    .unwrap()
    .unwrap();
}

#[tokio::test]
async fn destination_reservation_survives_init_and_blocks_new_subdirectory_writes() {
    let temp = tempfile::tempdir().unwrap();
    let destination = temp.path().join("new/clone");
    let scheduler = RepoScheduler::new();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let held = scheduler
        .acquire_repo_writes(&runner, &[], std::slice::from_ref(&destination), &cancel)
        .await
        .unwrap();
    let mut queued = Box::pin(scheduler.acquire_repo_writes(
        &runner,
        &[],
        std::slice::from_ref(&destination),
        &cancel,
    ));
    blocked(&mut queued).await;
    std::fs::create_dir_all(destination.join("subdir")).unwrap();
    git(&destination, &["init", "-b", "main"]);
    blocked(scheduler.acquire_repo_write(
        &runner,
        destination.join("subdir").to_str().unwrap(),
        &cancel,
    ))
    .await;
    drop(held);
    let queued_permits = tokio::time::timeout(FINISH, queued).await.unwrap().unwrap();
    blocked(scheduler.acquire_repo_write(&runner, destination.to_str().unwrap(), &cancel)).await;
    drop(queued_permits);
    tokio::time::timeout(
        FINISH,
        scheduler.acquire_repo_write(&runner, destination.to_str().unwrap(), &cancel),
    )
    .await
    .unwrap()
    .unwrap();
}

#[tokio::test]
async fn queued_writer_revalidates_identity_after_worktree_replacement() {
    let source = FixtureBuilder::new().build("clean").unwrap();
    let replacement = FixtureBuilder::new().build("clean").unwrap();
    let temp = tempfile::tempdir().unwrap();
    let linked = temp.path().join("linked");
    git(
        source.path(),
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    );
    let scheduler = RepoScheduler::new();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let roots = vec![source.path().display().to_string()];
    let old = scheduler
        .acquire_repo_writes(&runner, &roots, std::slice::from_ref(&linked), &cancel)
        .await
        .unwrap();
    let mut queued =
        Box::pin(scheduler.acquire_repo_write(&runner, linked.to_str().unwrap(), &cancel));
    blocked(&mut queued).await;
    // A coordinated workflow removes and recreates the same path from a
    // different repository while the queued writer has its old identity.
    git(
        source.path(),
        &["worktree", "remove", linked.to_str().unwrap()],
    );
    git(
        replacement.path(),
        &[
            "worktree",
            "add",
            "-b",
            "replacement",
            linked.to_str().unwrap(),
        ],
    );
    let new = scheduler
        .acquire_repo_write(&runner, replacement.path().to_str().unwrap(), &cancel)
        .await
        .unwrap();
    drop(old);
    blocked(&mut queued).await;
    drop(new);
    tokio::time::timeout(FINISH, queued).await.unwrap().unwrap();
}

#[tokio::test]
async fn discovery_errors_and_cancelled_tokens_prevent_write_execution() {
    let temp = tempfile::tempdir().unwrap();
    let scheduler = RepoScheduler::new();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let error = scheduler
        .with_repo_permit(
            &runner,
            temp.path().to_str().unwrap(),
            OpKind::Write,
            &cancel,
            async {
                panic!("non-repository write body ran");
                #[allow(unreachable_code)]
                Ok(())
            },
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, gitx_core::ErrorCode::NotARepository);
    let missing = GitRunner::new(temp.path().join("missing-git").to_string_lossy());
    assert!(scheduler
        .acquire_repo_writes(&missing, &[], &[temp.path().to_path_buf()], &cancel)
        .await
        .is_err());
    // An existing empty directory is a valid init/clone destination.
    let permits = scheduler
        .acquire_repo_writes(&runner, &[], &[temp.path().to_path_buf()], &cancel)
        .await
        .unwrap();
    drop(permits);
    std::fs::write(temp.path().join(".git"), "gitdir: missing\n").unwrap();
    assert!(scheduler
        .acquire_repo_writes(&runner, &[], &[temp.path().to_path_buf()], &cancel)
        .await
        .is_err());
    cancel.cancel();
    assert_eq!(
        scheduler
            .acquire_repo_writes(&runner, &[], &[temp.path().to_path_buf()], &cancel)
            .await
            .unwrap_err()
            .code,
        gitx_core::ErrorCode::Cancelled
    );
}

#[tokio::test]
async fn filesystem_aliases_share_repository_and_future_destination_locks() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let temp = tempfile::tempdir().unwrap();
    let alias = temp.path().join("alias");
    #[cfg(unix)]
    std::os::unix::fs::symlink(repo.path(), &alias).unwrap();
    #[cfg(windows)]
    {
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "New-Item -ItemType Junction -Path $env:GITX_TEST_ALIAS -Value $env:GITX_TEST_TARGET -ErrorAction Stop | Out-Null"])
            .env("GITX_TEST_ALIAS", &alias)
            .env("GITX_TEST_TARGET", repo.path())
            .output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let scheduler = RepoScheduler::new();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let held = scheduler
        .acquire_repo_write(&runner, repo.path().to_str().unwrap(), &cancel)
        .await
        .unwrap();
    blocked(scheduler.acquire_repo_write(&runner, alias.to_str().unwrap(), &cancel)).await;
    drop(held);
    let future = repo.path().join("new/clone");
    let held = scheduler
        .acquire_repo_writes(&runner, &[], &[future], &cancel)
        .await
        .unwrap();
    blocked(scheduler.acquire_repo_writes(&runner, &[], &[alias.join("new/clone")], &cancel)).await;
    drop(held);
    #[cfg(windows)]
    std::fs::remove_dir(&alias).unwrap();
    #[cfg(unix)]
    std::fs::remove_file(&alias).unwrap();
}
