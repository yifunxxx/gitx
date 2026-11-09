use gitx_core::UpdateMethod;
use gitx_git::GitRunner;
use gitx_testkit::{FixtureBuilder, FixtureRepo};
use std::{fs, path::Path, process::Command};
use tokio_util::sync::CancellationToken;

fn git(path: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim_end().to_owned()
}

fn fixture() -> FixtureRepo {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let path = repo.path();
    git(path, &["config", "core.autocrlf", "false"]);
    git(path, &["config", "init.defaultBranch", "main"]);
    let remote = git(path, &["remote", "get-url", "origin"]);
    git(path, &["remote", "add", "upstream", &remote]);
    git(path, &["checkout", "-b", "incoming"]);
    fs::write(path.join("upstream.txt"), "upstream\n").unwrap();
    git(path, &["add", "upstream.txt"]);
    git(path, &["commit", "-m", "upstream change"]);
    git(path, &["push", "origin", "incoming:main"]);
    git(path, &["checkout", "main"]);
    fs::write(path.join("local-history.txt"), "local history\n").unwrap();
    git(path, &["add", "local-history.txt"]);
    git(path, &["commit", "-m", "local history"]);
    git(path, &["fetch", "upstream"]);
    repo
}

#[derive(Debug, PartialEq)]
struct Snapshot {
    head: String,
    branch: String,
    refs: String,
    index: String,
    status: String,
    readme: Vec<u8>,
    untracked: Vec<u8>,
}

fn dirty(path: &Path) {
    fs::write(path.join("README.md"), "staged\n").unwrap();
    git(path, &["add", "README.md"]);
    fs::write(path.join("README.md"), "unstaged\n").unwrap();
    fs::write(path.join("untracked.txt"), "keep untracked\n").unwrap();
}

fn snapshot(path: &Path) -> Snapshot {
    Snapshot {
        head: git(path, &["rev-parse", "HEAD"]),
        branch: git(path, &["symbolic-ref", "HEAD"]),
        refs: git(path, &["show-ref"]),
        index: git(path, &["write-tree"]),
        status: git(path, &["status", "--porcelain"]),
        readme: fs::read(path.join("README.md")).unwrap(),
        untracked: fs::read(path.join("untracked.txt")).unwrap(),
    }
}

async fn requires_backup(fork: bool, topic: bool, strategy: UpdateMethod) {
    let repo = fixture();
    let path = repo.path();
    if topic {
        git(path, &["checkout", "-b", "topic"]);
        fs::write(path.join("topic.txt"), "topic\n").unwrap();
        git(path, &["add", "topic.txt"]);
        git(path, &["commit", "-m", "topic"]);
    }
    dirty(path);
    let head = git(path, &["rev-parse", "HEAD"]);
    git(path, &["update-ref", "refs/gitx/backup", &head]);
    let before = snapshot(path);
    let remote = git(path, &["remote", "get-url", "origin"]);
    let remote_head = git(Path::new(&remote), &["rev-parse", "main"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = if fork {
        runner
            .sync_fork(path, "upstream", strategy, true, &cancel)
            .await
            .map(|_| ())
    } else {
        runner
            .update_project_run(path, strategy, &cancel)
            .await
            .map(|_| ())
    };
    let error = result.expect_err("backup failure must stop before checkout/reset/push");
    assert!(
        error.command.unwrap_or_default().contains("update-ref"),
        "{}",
        error.message
    );
    assert_eq!(snapshot(path), before);
    assert_eq!(git(Path::new(&remote), &["rev-parse", "main"]), remote_head);
}

#[tokio::test]
async fn fork_reset_requires_backup() {
    requires_backup(true, false, UpdateMethod::Reset).await;
}

#[tokio::test]
async fn fork_backup_failure_preserves_the_original_branch() {
    requires_backup(true, true, UpdateMethod::Reset).await;
}

#[tokio::test]
async fn update_reset_requires_backup() {
    requires_backup(false, false, UpdateMethod::Reset).await;
}

#[tokio::test]
async fn merge_and_rebase_also_require_a_backup() {
    for fork in [false, true] {
        for strategy in [UpdateMethod::Merge, UpdateMethod::Rebase] {
            requires_backup(fork, false, strategy).await;
        }
    }
}

#[tokio::test]
async fn rejecting_only_the_local_snapshot_stops_sync_before_fetch() {
    for fork in [false, true] {
        let repo = fixture();
        let path = repo.path();
        dirty(path);
        let before = snapshot(path);
        let remote = git(path, &["remote", "get-url", "origin"]);
        let remote_head = git(Path::new(&remote), &["rev-parse", "main"]);
        let fetch_head = fs::read(path.join(".git/FETCH_HEAD")).unwrap();
        let hook = path.join(".git/hooks/reference-transaction");
        fs::write(&hook, "#!/bin/sh\nif test \"$1\" = prepared; then\n while read old new ref; do\n  case \"$ref\" in refs/gitx/backup/*-wt-*) exit 1 ;; esac\n done\nfi\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let result = if fork {
            runner
                .sync_fork(path, "upstream", UpdateMethod::Reset, true, &cancel)
                .await
                .map(|_| ())
        } else {
            runner
                .update_project_run(path, UpdateMethod::Reset, &cancel)
                .await
                .map(|_| ())
        };
        let error = result.unwrap_err();
        assert!(error.command.unwrap_or_default().contains("-wt-"));
        let mut after = snapshot(path);
        // The history backup succeeded; only that additional ref may remain.
        let refs = after
            .refs
            .lines()
            .filter(|line| !line.contains(" refs/gitx/backup/"))
            .collect::<Vec<_>>()
            .join("\n");
        after.refs = refs;
        assert_eq!(after, before);
        assert_eq!(fs::read(path.join(".git/FETCH_HEAD")).unwrap(), fetch_head);
        assert_eq!(git(Path::new(&remote), &["rev-parse", "main"]), remote_head);
    }
}

async fn sync_diverged_history(fork: bool, strategy: UpdateMethod) {
    let repo = fixture();
    let path = repo.path();
    let old = git(path, &["rev-parse", "HEAD"]);
    let upstream = git(path, &["rev-parse", "upstream/main"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let new = if fork {
        let result = runner
            .sync_fork(path, "upstream", strategy, true, &cancel)
            .await
            .unwrap();
        assert_eq!(result.old_head, old);
        assert!(result.pushed);
        let remote = git(path, &["remote", "get-url", "origin"]);
        assert_eq!(
            git(Path::new(&remote), &["rev-parse", "main"]),
            result.new_head
        );
        result.new_head
    } else {
        let result = runner
            .update_project_run(path, strategy, &cancel)
            .await
            .unwrap();
        assert_eq!(result.old_head, old);
        result.new_head
    };
    assert_eq!(new, git(path, &["rev-parse", "HEAD"]));
    assert_eq!(git(path, &["merge-base", &new, &upstream]), upstream);
    assert!(git(path, &["status", "--porcelain"]).is_empty());
    assert_eq!(git(path, &["symbolic-ref", "HEAD"]), "refs/heads/main");
    assert_eq!(fs::read(path.join("upstream.txt")).unwrap(), b"upstream\n");
    assert_eq!(
        fs::read(path.join("local-history.txt")).unwrap(),
        b"local history\n"
    );
    match strategy {
        UpdateMethod::Merge => assert_eq!(git(path, &["rev-parse", "HEAD^1"]), old),
        UpdateMethod::Rebase => assert_eq!(git(path, &["rev-parse", "HEAD^1"]), upstream),
        UpdateMethod::Reset => unreachable!(),
    }
    let backups = git(
        path,
        &["for-each-ref", "--format=%(refname)", "refs/gitx/backup"],
    );
    let backup = backups.lines().next().unwrap();
    assert_eq!(git(path, &["rev-parse", backup]), old);
    // A second operation must retain the first restore point.
    if fork {
        runner
            .sync_fork(path, "upstream", strategy, false, &cancel)
            .await
            .unwrap();
    } else {
        runner
            .update_project_run(path, strategy, &cancel)
            .await
            .unwrap();
    }
    assert_eq!(git(path, &["rev-parse", backup]), old);
    assert_eq!(
        git(
            path,
            &["for-each-ref", "--format=%(refname)", "refs/gitx/backup"]
        )
        .lines()
        .count(),
        2
    );
}

#[tokio::test]
async fn fork_merges_diverged_history_and_pushes() {
    sync_diverged_history(true, UpdateMethod::Merge).await;
}

#[tokio::test]
async fn fork_rebases_diverged_history_and_pushes() {
    sync_diverged_history(true, UpdateMethod::Rebase).await;
}

#[tokio::test]
async fn update_merges_diverged_history() {
    sync_diverged_history(false, UpdateMethod::Merge).await;
}

#[tokio::test]
async fn update_rebases_diverged_history() {
    sync_diverged_history(false, UpdateMethod::Rebase).await;
}

#[tokio::test]
async fn fork_reset_retains_the_default_branch_tip_and_local_snapshot() {
    let repo = fixture();
    let path = repo.path();
    let main = git(path, &["rev-parse", "main"]);
    git(path, &["checkout", "-b", "topic"]);
    fs::write(path.join("topic.txt"), "topic\n").unwrap();
    git(path, &["add", "topic.txt"]);
    git(path, &["commit", "-m", "topic"]);
    let topic = git(path, &["rev-parse", "HEAD"]);
    dirty(path);
    let index_blob = git(path, &["rev-parse", ":README.md"]);
    let runner = GitRunner::new("git");
    let result = runner
        .sync_fork(
            path,
            "upstream",
            UpdateMethod::Reset,
            false,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.old_head, main);
    assert_eq!(result.new_head, git(path, &["rev-parse", "upstream/main"]));
    assert!(!result.pushed);
    assert_eq!(git(path, &["symbolic-ref", "HEAD"]), "refs/heads/main");
    assert_eq!(git(path, &["rev-parse", "topic"]), topic);
    let backups = git(
        path,
        &["for-each-ref", "--format=%(refname)", "refs/gitx/backup"],
    );
    let refs: Vec<_> = backups.lines().collect();
    let history = refs
        .iter()
        .find(|r| !r.contains("-wt-"))
        .expect("history backup");
    let local = refs
        .iter()
        .find(|r| r.contains("-wt-"))
        .expect("local snapshot");
    assert_eq!(git(path, &["rev-parse", history]), main);
    assert_eq!(
        git(path, &["show", &format!("{local}:README.md")]),
        "unstaged"
    );
    assert_eq!(
        git(path, &["rev-parse", &format!("{local}^2:README.md")]),
        index_blob
    );
    assert_eq!(fs::read(path.join("README.md")).unwrap(), b"unstaged\n");
    assert_eq!(
        fs::read(path.join("untracked.txt")).unwrap(),
        b"keep untracked\n"
    );
}
