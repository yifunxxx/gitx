use gitx_core::{ErrorCode, ResetMode};
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

fn expected_head(path: &Path) -> gitx_core::RewriteHead {
    let output = Command::new("git")
        .current_dir(path)
        .args(["symbolic-ref", "--quiet", "HEAD"])
        .output()
        .unwrap();
    assert!(output.status.success() || output.status.code() == Some(1));
    gitx_core::RewriteHead {
        oid: git(path, &["rev-parse", "HEAD"]),
        symbolic_ref: output
            .status
            .success()
            .then(|| String::from_utf8(output.stdout).unwrap().trim().to_owned()),
    }
}

#[tokio::test]
async fn undo_partial_drop_preserves_original_staged_unstaged_and_untracked_work() {
    for older in [false, true] {
        let repo = FixtureBuilder::new().build("linear-history").unwrap();
        let path = repo.path();
        git(path, &["config", "core.autocrlf", "false"]);
        let selected = "中文,drop[1].txt";
        fs::write(path.join(selected), "committed\n").unwrap();
        fs::write(path.join("retained.txt"), "retained\n").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "-m", "partial"]);
        let commit = git(path, &["rev-parse", "HEAD"]);
        if older {
            fs::write(path.join("later.txt"), "later\n").unwrap();
            git(path, &["add", "."]);
            git(path, &["commit", "-m", "later"]);
        }
        fs::write(path.join(selected), "staged\n").unwrap();
        git(path, &["add", "--", selected]);
        fs::write(path.join(selected), "unstaged\n").unwrap();
        fs::write(path.join("local.txt"), "untracked\n").unwrap();
        let head = git(path, &["rev-parse", "HEAD"]);
        let index = git(path, &["write-tree"]);
        let status = git(path, &["status", "--porcelain"]);
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let result = runner
            .drop_changes(path, &commit, &[selected.into()], &cancel)
            .await
            .unwrap();
        let dropped = git(path, &["rev-parse", "HEAD"]);
        if older {
            let lock = path.join(".git/refs/heads/main.lock");
            fs::write(&lock, "held for regression").unwrap();
            let error = runner
                .undo_rewrite(
                    path,
                    result.backup_ref.as_ref().unwrap(),
                    true,
                    &expected_head(path),
                    &cancel,
                )
                .await
                .unwrap_err();
            assert!(error.command.unwrap_or_default().contains("update-ref"));
            assert_eq!(git(path, &["rev-parse", "HEAD"]), dropped);
            assert_eq!(git(path, &["write-tree"]), index);
            assert_eq!(fs::read(path.join(selected)).unwrap(), b"unstaged\n");
            fs::remove_file(lock).unwrap();
        }
        let undone = runner
            .undo_rewrite(
                path,
                result.backup_ref.as_ref().unwrap(),
                true,
                &expected_head(path),
                &cancel,
            )
            .await
            .unwrap();
        assert_eq!(git(path, &["rev-parse", "HEAD"]), head);
        assert_eq!(git(path, &["write-tree"]), index);
        assert_eq!(git(path, &["status", "--porcelain"]), status);
        assert_eq!(fs::read(path.join(selected)).unwrap(), b"unstaged\n");
        assert_eq!(git(path, &["show", &format!(":{selected}")]), "staged");
        assert_eq!(fs::read(path.join("local.txt")).unwrap(), b"untracked\n");
        runner
            .undo_rewrite(
                path,
                undone.backup_ref.as_ref().unwrap(),
                true,
                &expected_head(path),
                &cancel,
            )
            .await
            .unwrap();
        assert_eq!(git(path, &["rev-parse", "HEAD"]), dropped);
        assert_eq!(git(path, &["write-tree"]), index);
        assert_eq!(fs::read(path.join(selected)).unwrap(), b"unstaged\n");
    }
}

#[tokio::test]
async fn undo_partial_drop_refuses_new_changes_on_the_dropped_path() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    git(path, &["config", "core.autocrlf", "false"]);
    fs::write(path.join("c.txt"), "staged\n").unwrap();
    git(path, &["add", "c.txt"]);
    fs::write(path.join("c.txt"), "unstaged\n").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .drop_changes(path, "HEAD", &["c.txt".into()], &cancel)
        .await
        .unwrap();
    fs::write(path.join("c.txt"), "new work after drop\n").unwrap();
    let head = git(path, &["rev-parse", "HEAD"]);
    let index = git(path, &["write-tree"]);
    runner
        .undo_rewrite(
            path,
            result.backup_ref.as_ref().unwrap(),
            true,
            &expected_head(path),
            &cancel,
        )
        .await
        .unwrap_err();
    assert_eq!(git(path, &["rev-parse", "HEAD"]), head);
    assert_eq!(git(path, &["write-tree"]), index);
    assert_eq!(
        fs::read(path.join("c.txt")).unwrap(),
        b"new work after drop\n"
    );
}

#[tokio::test]
async fn rebase_of_another_branch_undo_restores_that_branch_and_local_changes() {
    for dirty in [false, true] {
        let repo = FixtureBuilder::new().build("linear-history").unwrap();
        let path = repo.path();
        git(path, &["config", "core.autocrlf", "false"]);
        let main = git(path, &["rev-parse", "main"]);
        git(path, &["checkout", "-b", "topic", "HEAD~2"]);
        fs::write(path.join("topic.txt"), "topic\n").unwrap();
        git(path, &["add", "topic.txt"]);
        git(path, &["commit", "-m", "topic"]);
        let topic = git(path, &["rev-parse", "HEAD"]);
        git(path, &["checkout", "main"]);
        if dirty {
            fs::write(path.join("a.txt"), "staged local\n").unwrap();
            git(path, &["add", "a.txt"]);
            fs::write(path.join("a.txt"), "unstaged local\n").unwrap();
            fs::write(path.join("local.txt"), "untracked local\n").unwrap();
        }
        let status = git(path, &["status", "--porcelain"]);
        let staged = git(path, &["show", ":a.txt"]);
        let local = fs::read(path.join("a.txt")).unwrap();
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let result = runner
            .with_rewrite_undo(
                path,
                &cancel,
                runner.rebase_run(
                    path,
                    "main",
                    None,
                    Some("topic"),
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    dirty,
                    &cancel,
                ),
            )
            .await
            .unwrap();
        assert_eq!(
            result.old_head, topic,
            "must back up the branch being rebased"
        );
        assert_eq!(
            git(path, &["rev-parse", result.backup_ref.as_ref().unwrap()]),
            topic
        );
        assert_eq!(git(path, &["symbolic-ref", "HEAD"]), "refs/heads/topic");
        assert_eq!(git(path, &["rev-parse", "main"]), main);
        assert_ne!(git(path, &["rev-parse", "topic"]), topic);
        runner
            .undo_rewrite(
                path,
                result.backup_ref.as_ref().unwrap(),
                true,
                result.undo_head.as_ref().unwrap(),
                &cancel,
            )
            .await
            .unwrap();
        assert_eq!(git(path, &["rev-parse", "topic"]), topic);
        assert_eq!(git(path, &["rev-parse", "main"]), main);
        assert_eq!(git(path, &["symbolic-ref", "HEAD"]), "refs/heads/topic");
        assert_eq!(git(path, &["status", "--porcelain"]), status);
        assert_eq!(git(path, &["show", ":a.txt"]), staged);
        assert_eq!(fs::read(path.join("a.txt")).unwrap(), local);
        if dirty {
            assert_eq!(
                fs::read(path.join("local.txt")).unwrap(),
                b"untracked local\n"
            );
        }
    }
}

#[tokio::test]
async fn rebase_of_another_up_to_date_branch_reports_no_rewrite() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    git(path, &["checkout", "-b", "topic"]);
    git(path, &["commit", "--allow-empty", "-m", "topic"]);
    let topic = git(path, &["rev-parse", "topic"]);
    git(path, &["checkout", "main"]);
    let result = GitRunner::new("git")
        .rebase_run(
            path,
            "main",
            None,
            Some("topic"),
            false,
            false,
            false,
            false,
            false,
            false,
            false,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.outcome, gitx_core::RewriteOutcome::AlreadyUpToDate);
    assert_eq!(result.old_head, topic);
    assert_eq!(result.new_head, topic);
}

#[tokio::test]
async fn rebase_undo_uses_the_local_branch_when_a_tag_has_the_same_name() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    git(path, &["checkout", "-b", "topic", "HEAD~2"]);
    git(path, &["commit", "--allow-empty", "-m", "topic"]);
    let topic = git(path, &["rev-parse", "HEAD"]);
    git(path, &["checkout", "main"]);
    git(path, &["tag", "topic"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .rebase_run(
            path,
            "main",
            None,
            Some("topic"),
            false,
            true,
            false,
            false,
            false,
            false,
            false,
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(result.old_head, topic);
    assert_eq!(
        git(path, &["rev-parse", result.backup_ref.as_ref().unwrap()]),
        topic
    );
    assert_eq!(git(path, &["symbolic-ref", "HEAD"]), "refs/heads/topic");
}

#[tokio::test]
async fn ordinary_root_rebase_accepts_a_branch_after_option_separator() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    git(path, &["branch", "topic"]);
    let original = git(path, &["rev-parse", "HEAD"]);
    let result = GitRunner::new("git")
        .rebase_run(
            path,
            "",
            None,
            Some("topic"),
            false,
            false,
            true,
            false,
            false,
            false,
            false,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.old_head, original);
    assert_eq!(git(path, &["symbolic-ref", "HEAD"]), "refs/heads/topic");
    assert_eq!(git(path, &["rev-list", "--count", "HEAD"]), "3");
}

async fn stale_undo_is_rejected(change: &str) {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let reset = runner
        .reset_run(path, "HEAD~1", ResetMode::Hard, &cancel)
        .await
        .unwrap();
    let expected = expected_head(path);
    match change {
        "commit" => {
            git(path, &["commit", "--allow-empty", "-m", "later work"]);
        }
        "branch" => {
            git(path, &["checkout", "-b", "another-branch"]);
        }
        "detached" => {
            git(path, &["checkout", "--detach"]);
        }
        _ => unreachable!(),
    }
    let head = git(path, &["rev-parse", "HEAD"]);
    let index = git(path, &["write-tree"]);
    let status = git(path, &["status", "--porcelain"]);
    let references = git(path, &["show-ref"]);
    let result = runner
        .undo_rewrite(path, &reset.backup_ref.unwrap(), true, &expected, &cancel)
        .await;
    assert!(result.is_err(), "old undo must reject a changed {change}");
    assert_eq!(result.unwrap_err().code, ErrorCode::StaleUndo);
    assert_eq!(git(path, &["rev-parse", "HEAD"]), head);
    assert_eq!(git(path, &["write-tree"]), index);
    assert_eq!(git(path, &["status", "--porcelain"]), status);
    assert_eq!(git(path, &["show-ref"]), references);
}

#[tokio::test]
async fn undo_rejects_later_commits() {
    stale_undo_is_rejected("commit").await;
}

#[tokio::test]
async fn undo_rejects_another_branch_at_the_same_commit() {
    stale_undo_is_rejected("branch").await;
}

#[tokio::test]
async fn undo_rejects_a_changed_head_mode() {
    stale_undo_is_rejected("detached").await;
}

#[tokio::test]
async fn rewrite_result_binds_undo_to_completed_head_and_allows_redo() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let original = git(path, &["rev-parse", "HEAD"]);
    let reset = runner
        .with_rewrite_undo(
            path,
            &cancel,
            runner.reset_run(path, "HEAD~1", ResetMode::Hard, &cancel),
        )
        .await
        .unwrap();
    let expected = reset.undo_head.as_ref().unwrap();
    assert_eq!(expected.oid, reset.new_head);
    assert_eq!(expected.symbolic_ref.as_deref(), Some("refs/heads/main"));
    let undo = runner
        .with_rewrite_undo(
            path,
            &cancel,
            runner.undo_rewrite(
                path,
                reset.backup_ref.as_ref().unwrap(),
                true,
                expected,
                &cancel,
            ),
        )
        .await
        .unwrap();
    assert_eq!(git(path, &["rev-parse", "HEAD"]), original);
    assert_eq!(undo.undo_head.as_ref().unwrap().oid, original);
    runner
        .undo_rewrite(
            path,
            undo.backup_ref.as_ref().unwrap(),
            true,
            undo.undo_head.as_ref().unwrap(),
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(git(path, &["rev-parse", "HEAD"]), reset.new_head);
}

#[tokio::test]
async fn undo_works_when_head_stays_detached() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    git(path, &["checkout", "--detach"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let original = git(path, &["rev-parse", "HEAD"]);
    let reset = runner
        .with_rewrite_undo(
            path,
            &cancel,
            runner.reset_run(path, "HEAD~1", ResetMode::Hard, &cancel),
        )
        .await
        .unwrap();
    assert!(reset.undo_head.as_ref().unwrap().symbolic_ref.is_none());
    runner
        .undo_rewrite(
            path,
            reset.backup_ref.as_ref().unwrap(),
            true,
            reset.undo_head.as_ref().unwrap(),
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(git(path, &["rev-parse", "HEAD"]), original);
    assert!(runner
        .rewrite_head(path, &cancel)
        .await
        .unwrap()
        .symbolic_ref
        .is_none());
}

#[tokio::test]
async fn undo_refuses_to_overwrite_new_tracked_work() {
    for staged in [false, true] {
        let repo = FixtureBuilder::new().build("linear-history").unwrap();
        let path = repo.path();
        git(path, &["config", "core.autocrlf", "false"]);
        fs::write(path.join("a.txt"), "committed update\n").unwrap();
        git(path, &["commit", "-am", "update a"]);
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let reset = runner
            .reset_run(path, "HEAD~1", ResetMode::Hard, &cancel)
            .await
            .unwrap();
        fs::write(path.join("a.txt"), "new local work\n").unwrap();
        if staged {
            git(path, &["add", "a.txt"]);
        }
        let before = git(path, &["rev-parse", "HEAD"]);
        let index = git(path, &["write-tree"]);
        let result = runner
            .undo_rewrite(
                path,
                &reset.backup_ref.unwrap(),
                true,
                &expected_head(path),
                &cancel,
            )
            .await;
        assert!(result.is_err(), "undo must not fall back to hard reset");
        assert!(result
            .unwrap_err()
            .command
            .unwrap_or_default()
            .contains("read-tree"));
        assert_eq!(git(path, &["rev-parse", "HEAD"]), before);
        assert_eq!(git(path, &["write-tree"]), index);
        assert_eq!(fs::read(path.join("a.txt")).unwrap(), b"new local work\n");
    }
}

#[tokio::test]
async fn undo_keeps_unrelated_staging_and_untracked_files() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    git(path, &["config", "core.autocrlf", "false"]);
    let original = git(path, &["rev-parse", "HEAD"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let reset = runner
        .reset_run(path, "HEAD~1", ResetMode::Hard, &cancel)
        .await
        .unwrap();
    fs::write(path.join("a.txt"), "staged work\n").unwrap();
    git(path, &["add", "a.txt"]);
    fs::write(path.join("a.txt"), "later unstaged work\n").unwrap();
    fs::write(path.join("untracked.txt"), "keep me\n").unwrap();
    runner
        .undo_rewrite(
            path,
            &reset.backup_ref.unwrap(),
            true,
            &expected_head(path),
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(git(path, &["rev-parse", "HEAD"]), original);
    assert_eq!(git(path, &["show", ":a.txt"]), "staged work");
    assert_eq!(
        fs::read(path.join("a.txt")).unwrap(),
        b"later unstaged work\n"
    );
    assert_eq!(fs::read(path.join("untracked.txt")).unwrap(), b"keep me\n");
    assert_eq!(git(path, &["diff", "--cached", "--name-only"]), "a.txt");
}

#[tokio::test]
async fn undo_restores_snapshot_index_and_worktree_separately() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    git(path, &["config", "core.autocrlf", "false"]);
    fs::write(path.join("a.txt"), "saved staged\n").unwrap();
    git(path, &["add", "a.txt"]);
    fs::write(path.join("a.txt"), "saved unstaged\n").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let reset = runner
        .reset_run(path, "HEAD~1", ResetMode::Hard, &cancel)
        .await
        .unwrap();
    runner
        .undo_rewrite(
            path,
            &reset.backup_ref.unwrap(),
            true,
            &expected_head(path),
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(git(path, &["show", ":a.txt"]), "saved staged");
    assert_eq!(fs::read(path.join("a.txt")).unwrap(), b"saved unstaged\n");
}

#[tokio::test]
async fn undo_reports_snapshot_restore_failure_and_retains_both_versions() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    git(path, &["config", "core.autocrlf", "false"]);
    fs::write(path.join("a.txt"), "saved before reset\n").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let reset = runner
        .reset_run(path, "HEAD~1", ResetMode::Hard, &cancel)
        .await
        .unwrap();
    let backup = reset.backup_ref.unwrap();
    fs::write(path.join("a.txt"), "new work after reset\n").unwrap();
    let result = runner
        .undo_rewrite(path, &backup, true, &expected_head(path), &cancel)
        .await;
    assert!(
        result.is_err(),
        "restoration failure must not be reported as success"
    );
    assert_eq!(
        fs::read(path.join("a.txt")).unwrap(),
        b"new work after reset\n"
    );
    let (prefix, suffix) = backup.rsplit_once('-').unwrap();
    assert_eq!(
        git(path, &["show", &format!("{prefix}-wt-{suffix}:a.txt")]),
        "saved before reset"
    );
}

#[tokio::test]
async fn undo_reword_preserves_existing_snapshot_without_applying_it_twice() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    git(path, &["config", "core.autocrlf", "false"]);
    fs::write(path.join("a.txt"), "saved staged\n").unwrap();
    git(path, &["add", "a.txt"]);
    fs::write(path.join("a.txt"), "saved unstaged\n").unwrap();
    let index = git(path, &["write-tree"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let rewrite = runner
        .reword_commit(path, "HEAD", "changed message", &cancel)
        .await
        .unwrap();
    runner
        .undo_rewrite(
            path,
            &rewrite.backup_ref.unwrap(),
            true,
            &expected_head(path),
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(git(path, &["write-tree"]), index);
    assert_eq!(fs::read(path.join("a.txt")).unwrap(), b"saved unstaged\n");
}

#[tokio::test]
async fn undo_requires_a_backup_reference() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    let original = git(path, &["rev-parse", "HEAD"]);
    let error = GitRunner::new("git")
        .undo_rewrite(
            path,
            "HEAD~1",
            false,
            &expected_head(path),
            &CancellationToken::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidArgument);
    assert_eq!(git(path, &["rev-parse", "HEAD"]), original);
}

#[tokio::test]
async fn repeated_rewrites_keep_independent_backups() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let mut backups = Vec::new();
    for i in 0..4 {
        let old = git(path, &["rev-parse", "HEAD"]);
        let rewritten = runner
            .reword_commit(path, "HEAD", &format!("rewrite {i}"), &cancel)
            .await
            .unwrap();
        backups.push((rewritten.backup_ref.unwrap(), old));
    }
    for (reference, original) in &backups {
        assert_eq!(
            &git(path, &["rev-parse", reference]),
            original,
            "earlier backup was overwritten"
        );
    }
}

#[tokio::test]
async fn reset_stops_when_it_cannot_create_its_backup() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    let original = git(path, &["rev-parse", "HEAD"]);
    fs::write(path.join("a.txt"), "unsaved work\n").unwrap();
    fs::create_dir_all(path.join(".git/refs/gitx")).unwrap();
    fs::write(path.join(".git/refs/gitx/backup"), format!("{original}\n")).unwrap();
    let result = GitRunner::new("git")
        .reset_run(path, "HEAD~1", ResetMode::Hard, &CancellationToken::new())
        .await;
    assert!(result.is_err());
    assert_eq!(git(path, &["rev-parse", "HEAD"]), original);
    assert_eq!(fs::read(path.join("a.txt")).unwrap(), b"unsaved work\n");
}

#[tokio::test]
async fn undo_keeps_an_obstructing_untracked_file() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let reset = runner
        .reset_run(path, "HEAD~1", ResetMode::Hard, &cancel)
        .await
        .unwrap();
    fs::write(path.join("c.txt"), "new untracked work\n").unwrap();
    let original = git(path, &["rev-parse", "HEAD"]);
    let error = runner
        .undo_rewrite(
            path,
            &reset.backup_ref.unwrap(),
            true,
            &expected_head(path),
            &cancel,
        )
        .await
        .unwrap_err();
    assert!(error.command.unwrap_or_default().contains("read-tree"));
    assert_eq!(git(path, &["rev-parse", "HEAD"]), original);
    assert_eq!(
        fs::read(path.join("c.txt")).unwrap(),
        b"new untracked work\n"
    );
}

#[tokio::test]
async fn undo_rolls_back_checkout_if_branch_update_is_rejected() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let reset = runner
        .reset_run(path, "HEAD~1", ResetMode::Hard, &cancel)
        .await
        .unwrap();
    let original = git(path, &["rev-parse", "HEAD"]);
    let index = git(path, &["write-tree"]);
    let hook = path.join(".git/hooks/reference-transaction");
    fs::write(&hook, "#!/bin/sh\nif test \"$1\" = prepared; then\n  while read old new ref; do\n    if test \"$ref\" = refs/heads/main; then exit 1; fi\n  done\nfi\nexit 0\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let result = runner
        .undo_rewrite(
            path,
            &reset.backup_ref.unwrap(),
            true,
            &expected_head(path),
            &cancel,
        )
        .await;
    assert!(result.is_err());
    assert_eq!(git(path, &["rev-parse", "HEAD"]), original);
    assert_eq!(git(path, &["write-tree"]), index);
    assert!(!path.join("c.txt").exists());
    assert!(git(path, &["status", "--porcelain"]).is_empty());
}
