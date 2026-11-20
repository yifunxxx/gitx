use gitx_git::{GitInvocation, GitRunner};
use gitx_testkit::FixtureBuilder;
use std::{fs, path::Path};
use tokio_util::sync::CancellationToken;

async fn git(runner: &GitRunner, cwd: &Path, args: &[&str]) -> String {
    let output = runner
        .run(
            GitInvocation::new(cwd, args.iter().copied()),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    String::from_utf8(output.stdout).unwrap()
}

fn reject_commit(git_dir: &Path) {
    let hook = git_dir.join("hooks/pre-commit");
    fs::write(
        &hook,
        "#!/bin/sh\necho 'pre-commit hook rejects test' >&2\nexit 1\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(hook, fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[tokio::test]
async fn rejected_path_commit_preserves_index_bytes_and_worktree() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    fs::write(cwd.join("README.md"), "staged selected\n").unwrap();
    fs::write(cwd.join("other.txt"), "staged unrelated\n").unwrap();
    git(&runner, cwd, &["add", "README.md", "other.txt"]).await;
    fs::write(cwd.join("README.md"), "current selected\n").unwrap();
    fs::write(cwd.join("other.txt"), "unstaged unrelated\n").unwrap();
    fs::write(cwd.join("new.txt"), "new selected\n").unwrap();
    let git_dir = runner.git_dir(cwd, &cancel).await.unwrap();
    reject_commit(&git_dir);
    let head = git(&runner, cwd, &["rev-parse", "HEAD"]).await;
    let index = fs::read(git_dir.join("index")).unwrap();
    let result = runner
        .commit_create_ex(
            cwd,
            "rejected",
            false,
            false,
            Some(&["README.md".into(), "new.txt".into()]),
            None,
            &cancel,
        )
        .await;
    assert!(result.is_err());
    assert_eq!(fs::read(git_dir.join("index")).unwrap(), index);
    assert_eq!(git(&runner, cwd, &["rev-parse", "HEAD"]).await, head);
    assert_eq!(
        fs::read_to_string(cwd.join("README.md")).unwrap(),
        "current selected\n"
    );
    assert_eq!(
        fs::read_to_string(cwd.join("other.txt")).unwrap(),
        "unstaged unrelated\n"
    );
    assert_eq!(
        fs::read_to_string(cwd.join("new.txt")).unwrap(),
        "new selected\n"
    );
    assert!(!git_dir.join("index.lock").exists());
    assert_eq!(fs::read_dir(git_dir.join("gitx")).unwrap().count(), 0);
}

#[tokio::test]
async fn path_commit_preserves_unselected_partial_staging_and_commits_current_selected_files() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    fs::write(cwd.join("old.txt"), "renamed content\n").unwrap();
    git(&runner, cwd, &["add", "old.txt"]).await;
    git(&runner, cwd, &["commit", "-m", "rename baseline"]).await;
    fs::rename(cwd.join("old.txt"), cwd.join("renamed.txt")).unwrap();
    fs::write(cwd.join("README.md"), "staged selected\n").unwrap();
    fs::write(cwd.join("other.txt"), "staged unrelated\n").unwrap();
    git(&runner, cwd, &["add", "README.md", "other.txt"]).await;
    fs::write(cwd.join("README.md"), "current selected\n").unwrap();
    fs::write(cwd.join("other.txt"), "unstaged unrelated\n").unwrap();
    fs::write(cwd.join("new.txt"), "new selected\n").unwrap();
    let result = runner
        .commit_create_ex(
            cwd,
            "selected files",
            false,
            false,
            Some(&[
                "README.md".into(),
                "new.txt".into(),
                "old.txt".into(),
                "renamed.txt".into(),
            ]),
            None,
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(result.subject, "selected files");
    assert_eq!(
        git(&runner, cwd, &["show", "HEAD:README.md"]).await,
        "current selected\n"
    );
    assert_eq!(
        git(&runner, cwd, &["show", "HEAD:new.txt"]).await,
        "new selected\n"
    );
    assert_eq!(
        git(&runner, cwd, &["show", "HEAD:renamed.txt"]).await,
        "renamed content\n"
    );
    assert_eq!(
        git(
            &runner,
            cwd,
            &[
                "diff-tree",
                "--no-commit-id",
                "--name-only",
                "-r",
                "--no-renames",
                "HEAD"
            ]
        )
        .await,
        "README.md\nnew.txt\nold.txt\nrenamed.txt\n"
    );
    assert_eq!(
        git(&runner, cwd, &["diff", "--cached", "--name-only"]).await,
        "other.txt\n"
    );
    assert_eq!(
        git(&runner, cwd, &["show", ":other.txt"]).await,
        "staged unrelated\n"
    );
    assert_eq!(
        fs::read_to_string(cwd.join("other.txt")).unwrap(),
        "unstaged unrelated\n"
    );
    let git_dir = runner.git_dir(cwd, &cancel).await.unwrap();
    assert!(!git_dir.join("index.lock").exists());
    assert_eq!(fs::read_dir(git_dir.join("gitx")).unwrap().count(), 0);
}

#[tokio::test]
async fn path_commit_respects_an_existing_index_lock() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    fs::write(cwd.join("README.md"), "selected\n").unwrap();
    let git_dir = runner.git_dir(cwd, &cancel).await.unwrap();
    let index = fs::read(git_dir.join("index")).unwrap();
    let head = git(&runner, cwd, &["rev-parse", "HEAD"]).await;
    fs::write(git_dir.join("index.lock"), "other process owns this lock").unwrap();
    assert!(runner
        .commit_create_ex(
            cwd,
            "locked",
            false,
            false,
            Some(&["README.md".into()]),
            None,
            &cancel
        )
        .await
        .is_err());
    assert_eq!(fs::read(git_dir.join("index")).unwrap(), index);
    assert_eq!(git(&runner, cwd, &["rev-parse", "HEAD"]).await, head);
    assert_eq!(
        fs::read_to_string(git_dir.join("index.lock")).unwrap(),
        "other process owns this lock"
    );
}

#[tokio::test]
async fn path_commit_can_create_first_commit_without_including_other_staged_files() {
    let repo = FixtureBuilder::new().build("empty").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    fs::write(cwd.join("selected.txt"), "selected\n").unwrap();
    fs::write(cwd.join("other.txt"), "other\n").unwrap();
    git(&runner, cwd, &["add", "other.txt"]).await;
    runner
        .commit_create_ex(
            cwd,
            "first",
            false,
            false,
            Some(&["selected.txt".into()]),
            None,
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(
        git(&runner, cwd, &["ls-tree", "--name-only", "HEAD"]).await,
        "selected.txt\n"
    );
    assert_eq!(
        git(&runner, cwd, &["diff", "--cached", "--name-only"]).await,
        "other.txt\n"
    );
}

#[tokio::test]
async fn failed_add_does_not_commit_a_subset_or_change_the_index() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    fs::write(cwd.join("README.md"), "new contents\n").unwrap();
    let git_dir = runner.git_dir(cwd, &cancel).await.unwrap();
    let index = fs::read(git_dir.join("index")).unwrap();
    let head = git(&runner, cwd, &["rev-parse", "HEAD"]).await;
    let result = runner
        .commit_create_ex(
            cwd,
            "missing candidate",
            false,
            false,
            Some(&["README.md".into(), "vanished.txt".into()]),
            None,
            &cancel,
        )
        .await;
    assert!(result.is_err());
    assert_eq!(fs::read(git_dir.join("index")).unwrap(), index);
    assert_eq!(git(&runner, cwd, &["rev-parse", "HEAD"]).await, head);
    assert_eq!(fs::read_dir(git_dir.join("gitx")).unwrap().count(), 0);
}

#[tokio::test]
async fn selected_path_is_literal_and_split_index_entries_are_preserved() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    fs::write(cwd.join("file[1].txt"), "selected\n").unwrap();
    fs::write(cwd.join("file1.txt"), "unrelated\n").unwrap();
    git(&runner, cwd, &["add", "file1.txt"]).await;
    git(&runner, cwd, &["update-index", "--split-index"]).await;
    runner
        .commit_create_ex(
            cwd,
            "literal",
            false,
            false,
            Some(&["file[1].txt".into()]),
            None,
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(
        git(
            &runner,
            cwd,
            &["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]
        )
        .await,
        "file[1].txt\n"
    );
    assert_eq!(
        git(&runner, cwd, &["diff", "--cached", "--name-only"]).await,
        "file1.txt\n"
    );
    assert_eq!(
        git(&runner, cwd, &["show", ":file1.txt"]).await,
        "unrelated\n"
    );
}

#[tokio::test]
async fn cancelling_a_hook_preserves_index_and_releases_owned_locks() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    fs::write(cwd.join("README.md"), "staged\n").unwrap();
    git(&runner, cwd, &["add", "README.md"]).await;
    fs::write(cwd.join("README.md"), "working contents\n").unwrap();
    let git_dir = runner.git_dir(cwd, &cancel).await.unwrap();
    reject_commit(&git_dir);
    fs::write(
        git_dir.join("hooks/pre-commit"),
        "#!/bin/sh\necho started > hook-started\nsleep 15\n",
    )
    .unwrap();
    let index = fs::read(git_dir.join("index")).unwrap();
    let head = git(&runner, cwd, &["rev-parse", "HEAD"]).await;
    let paths = ["README.md".into()];
    let operation =
        runner.commit_create_ex(cwd, "cancel", false, false, Some(&paths), None, &cancel);
    let cancellation = async {
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            while !cwd.join("hook-started").exists() {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("hook started");
        cancel.cancel();
    };
    let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(20), async {
        tokio::join!(operation, cancellation)
    })
    .await
    .expect("cancelled commit exits");
    assert!(result.is_err());
    assert_eq!(fs::read(git_dir.join("index")).unwrap(), index);
    assert_eq!(git(&runner, cwd, &["rev-parse", "HEAD"]).await, head);
    assert!(!git_dir.join("index.lock").exists());
    assert_eq!(fs::read_dir(git_dir.join("gitx")).unwrap().count(), 0);
}
