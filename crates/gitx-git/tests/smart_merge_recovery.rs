use gitx_core::RewriteOutcome;
use gitx_git::GitRunner;
use gitx_testkit::{FixtureBuilder, FixtureRepo};
use std::{fs, path::Path, process::Command};
use tokio_util::sync::CancellationToken;

fn fixture() -> FixtureRepo {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    git(cwd, &["checkout", "-b", "feature"]);
    fs::write(cwd.join("incoming.txt"), "incoming\n").unwrap();
    fs::write(cwd.join("second.txt"), "second\n").unwrap();
    git(cwd, &["add", "incoming.txt", "second.txt"]);
    git(cwd, &["commit", "-m", "feature"]);
    git(cwd, &["checkout", "main"]);
    fs::write(cwd.join("a.txt"), "staged local\n").unwrap();
    git(cwd, &["add", "a.txt"]);
    fs::write(cwd.join("a.txt"), "unstaged local\n").unwrap();
    fs::write(cwd.join("draft.txt"), "untracked draft\n").unwrap();
    repo
}

fn assert_local(cwd: &Path) {
    assert_eq!(git(cwd, &["show", ":a.txt"]), "staged local\n");
    assert_eq!(
        fs::read_to_string(cwd.join("a.txt")).unwrap(),
        "unstaged local\n"
    );
    assert_eq!(
        fs::read_to_string(cwd.join("draft.txt")).unwrap(),
        "untracked draft\n"
    );
    assert_eq!(git(cwd, &["show", "HEAD:a.txt"]), "a\n");
}

#[tokio::test]
async fn squash_keeps_saved_local_work_separate_until_commit_panel_finishes() {
    let repo = fixture();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .merge_run(
            cwd,
            &["feature".into()],
            false,
            false,
            true,
            None,
            false,
            false,
            false,
            true,
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::NothingToCommit);
    assert_eq!(
        git(cwd, &["diff", "--cached", "--name-only"]),
        "incoming.txt\nsecond.txt\n"
    );
    assert_eq!(git(cwd, &["show", ":a.txt"]), "a\n");
    assert!(!cwd.join("draft.txt").exists());
    assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap().len(), 1);
    runner
        .commit_create(cwd, "squashed feature", false, false, &cancel)
        .await
        .unwrap();
    assert_local(cwd);
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
}

#[tokio::test]
async fn ordinary_commit_panel_finishes_merge_and_restores_local_work() {
    let repo = fixture();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .merge_run(
            cwd,
            &["feature".into()],
            true,
            false,
            false,
            None,
            true,
            false,
            false,
            true,
            &cancel,
        )
        .await
        .unwrap();
    assert!(cwd.join(".git/MERGE_HEAD").exists());
    assert!(!cwd.join("draft.txt").exists());
    runner
        .commit_create(cwd, "merge feature", false, false, &cancel)
        .await
        .unwrap();
    assert_local(cwd);
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
}

#[tokio::test]
async fn external_completion_exposes_explicit_recovery_without_mutating_on_refresh() {
    for abort in [false, true] {
        let repo = fixture();
        let cwd = repo.path();
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        runner
            .merge_run(
                cwd,
                &["feature".into()],
                true,
                false,
                false,
                None,
                true,
                false,
                false,
                true,
                &cancel,
            )
            .await
            .unwrap();
        let saved = runner
            .repo_op_state(cwd, &cancel)
            .await
            .unwrap()
            .smart_recovery
            .unwrap();
        assert!(!saved.can_restore);
        assert!(runner
            .restore_smart_changes(cwd, &saved.sha, &cancel)
            .await
            .is_err());
        if abort {
            git(cwd, &["merge", "--abort"]);
        } else {
            git(cwd, &["commit", "-m", "external merge"]);
        }
        let before = git(cwd, &["status", "--porcelain"]);
        let runner = GitRunner::new("git");
        for _ in 0..2 {
            let state = runner.repo_op_state(cwd, &cancel).await.unwrap();
            assert!(state.smart_recovery.unwrap().can_restore);
            assert_eq!(git(cwd, &["status", "--porcelain"]), before);
        }
        assert!(runner
            .restore_smart_changes(cwd, "wrong-sha", &cancel)
            .await
            .is_err());
        assert!(!cwd.join("draft.txt").exists());
        runner
            .restore_smart_changes(cwd, &saved.sha, &cancel)
            .await
            .unwrap();
        assert_local(cwd);
        assert!(runner
            .repo_op_state(cwd, &cancel)
            .await
            .unwrap()
            .smart_recovery
            .is_none());
    }
}

#[tokio::test]
async fn partial_squash_commit_keeps_the_remaining_index_isolated() {
    let repo = fixture();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .merge_run(
            cwd,
            &["feature".into()],
            false,
            false,
            true,
            None,
            false,
            false,
            false,
            true,
            &cancel,
        )
        .await
        .unwrap();
    runner
        .commit_create_ex(
            cwd,
            "first part",
            false,
            false,
            Some(&["incoming.txt".into()]),
            None,
            &cancel,
        )
        .await
        .unwrap();
    let saved = runner
        .repo_op_state(cwd, &cancel)
        .await
        .unwrap()
        .smart_recovery
        .unwrap();
    assert!(saved.pending_commit);
    assert!(!saved.can_restore);
    assert!(!cwd.join("draft.txt").exists());
    assert_eq!(
        git(cwd, &["diff", "--cached", "--name-only"]),
        "second.txt\n"
    );
    runner
        .commit_create(cwd, "remaining part", false, false, &cancel)
        .await
        .unwrap();
    assert_local(cwd);
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
}

#[tokio::test]
async fn failed_commit_keeps_saved_work_and_retry_restores_only_after_success() {
    let repo = fixture();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .merge_run(
            cwd,
            &["feature".into()],
            true,
            false,
            false,
            None,
            true,
            false,
            false,
            true,
            &cancel,
        )
        .await
        .unwrap();
    assert!(runner
        .commit_create(cwd, "", false, false, &cancel)
        .await
        .is_err());
    assert!(!cwd.join("draft.txt").exists());
    assert!(runner
        .repo_op_state(cwd, &cancel)
        .await
        .unwrap()
        .smart_recovery
        .is_some());
    runner
        .commit_create(cwd, "merge", false, false, &cancel)
        .await
        .unwrap();
    assert_local(cwd);
}

#[tokio::test]
async fn successful_commit_reports_restoration_warning_without_reporting_commit_failure() {
    let repo = fixture();
    let cwd = repo.path();
    // Preserve the existing local work while extending the feature branch.
    git(cwd, &["stash", "push", "-u", "-m", "fixture"]);
    git(cwd, &["checkout", "feature"]);
    fs::write(cwd.join("a.txt"), "incoming overlap\n").unwrap();
    git(cwd, &["add", "a.txt"]);
    git(cwd, &["commit", "-m", "overlap"]);
    git(cwd, &["checkout", "main"]);
    git(cwd, &["stash", "pop", "--index"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .merge_run(
            cwd,
            &["feature".into()],
            true,
            false,
            false,
            None,
            true,
            false,
            false,
            true,
            &cancel,
        )
        .await
        .unwrap();
    let result = runner
        .commit_create(cwd, "merge succeeded", false, false, &cancel)
        .await
        .unwrap();
    assert!(result
        .warning
        .as_deref()
        .unwrap()
        .contains("Commit succeeded"));
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]).trim(), result.sha);
    assert_eq!(git(cwd, &["show", "HEAD:a.txt"]), "incoming overlap\n");
    let saved = runner
        .repo_op_state(cwd, &cancel)
        .await
        .unwrap()
        .smart_recovery
        .unwrap();
    assert_eq!(saved.phase, "attention");
    assert!(!saved.can_restore);
    assert!(runner
        .restore_smart_changes(cwd, &saved.sha, &cancel)
        .await
        .is_err());
    assert_eq!(
        git(cwd, &["show", &format!("{}:a.txt", saved.sha)]),
        "unstaged local\n"
    );
}

#[tokio::test]
async fn squash_without_changes_restores_immediately_and_reports_up_to_date() {
    let repo = fixture();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .merge_run(
            cwd,
            &["main".into()],
            false,
            false,
            true,
            None,
            false,
            false,
            false,
            true,
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::AlreadyUpToDate);
    assert_local(cwd);
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
}

#[tokio::test]
async fn squash_of_an_empty_commit_does_not_mistake_restored_local_index_for_merge_output() {
    let repo = fixture();
    let cwd = repo.path();
    git(cwd, &["branch", "empty-feature"]);
    git(cwd, &["checkout", "empty-feature"]);
    git(cwd, &["commit", "--allow-empty", "-m", "empty", "--only"]);
    git(cwd, &["checkout", "main"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .merge_run(
            cwd,
            &["empty-feature".into()],
            false,
            false,
            true,
            None,
            false,
            false,
            false,
            true,
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::AlreadyUpToDate);
    assert_local(cwd);
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
}

#[tokio::test]
async fn clean_squash_reports_staged_changes_and_does_not_touch_existing_stashes() {
    for smart in [false, true] {
        let repo = fixture();
        let cwd = repo.path();
        git(cwd, &["stash", "push", "-u", "-m", "older unrelated work"]);
        let before = git(cwd, &["stash", "list", "--format=%H"]);
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let result = runner
            .merge_run(
                cwd,
                &["feature".into()],
                false,
                false,
                true,
                None,
                false,
                false,
                false,
                smart,
                &cancel,
            )
            .await
            .unwrap();
        assert_eq!(result.outcome, RewriteOutcome::NothingToCommit);
        assert_eq!(
            git(cwd, &["diff", "--cached", "--name-only"]),
            "incoming.txt\nsecond.txt\n"
        );
        runner
            .commit_create(cwd, "squashed", false, false, &cancel)
            .await
            .unwrap();
        assert_eq!(git(cwd, &["stash", "list", "--format=%H"]), before);
        assert!(!cwd.join("draft.txt").exists());
    }
}

#[tokio::test]
async fn cleanup_after_restoration_does_not_wait_on_restored_staged_local_changes() {
    let repo = fixture();
    let cwd = repo.path();
    git(cwd, &["stash", "push", "-u", "-m", "saved local work"]);
    let sha = git(cwd, &["rev-parse", "refs/stash"]).trim().to_string();
    git(cwd, &["stash", "apply", "--index", &sha]);
    fs::create_dir_all(cwd.join(".git/gitx")).unwrap();
    fs::write(
        cwd.join(".git/gitx/smart-stash.json"),
        serde_json::to_vec(&serde_json::json!({
            "operation": "merge", "sha": sha, "restoration": "Applied", "wait_for_commit": true,
        }))
        .unwrap(),
    )
    .unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let saved = runner
        .repo_op_state(cwd, &cancel)
        .await
        .unwrap()
        .smart_recovery
        .unwrap();
    assert!(saved.can_restore);
    assert!(!saved.pending_commit);
    assert_eq!(saved.phase, "applied");
    runner
        .restore_smart_changes(cwd, &sha, &cancel)
        .await
        .unwrap();
    assert_local(cwd);
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
}

fn git(cwd: &Path, args: &[&str]) -> String {
    let result = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    String::from_utf8(result.stdout).unwrap()
}

#[tokio::test]
async fn squash_conflicts_keep_saved_work_separate_until_resolution_is_committed() {
    let repo = fixture();
    let cwd = repo.path();
    // Make main and feature add different versions of the same file.
    git(cwd, &["stash", "push", "-u", "-m", "fixture"]);
    fs::write(cwd.join("incoming.txt"), "main version\n").unwrap();
    git(cwd, &["add", "incoming.txt"]);
    git(cwd, &["commit", "-m", "main version"]);
    git(cwd, &["stash", "pop", "--index"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .merge_run(
            cwd,
            &["feature".into()],
            false,
            false,
            true,
            None,
            false,
            false,
            false,
            true,
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::Conflicts);
    let state = runner.repo_op_state(cwd, &cancel).await.unwrap();
    assert_eq!(state.conflict_count, 1);
    assert!(!state.smart_recovery.unwrap().can_restore);
    assert!(!cwd.join("draft.txt").exists());
    fs::write(cwd.join("incoming.txt"), "resolved version\n").unwrap();
    git(cwd, &["add", "incoming.txt"]);
    assert!(
        runner
            .repo_op_state(cwd, &cancel)
            .await
            .unwrap()
            .smart_recovery
            .unwrap()
            .pending_commit
    );
    let result = runner
        .commit_create(cwd, "resolved squash", false, false, &cancel)
        .await
        .unwrap();
    assert!(result.warning.is_none());
    assert_local(cwd);
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
}

#[tokio::test]
async fn discarded_squash_exposes_explicit_restore_after_external_reset() {
    let repo = fixture();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .merge_run(
            cwd,
            &["feature".into()],
            false,
            false,
            true,
            None,
            false,
            false,
            false,
            true,
            &cancel,
        )
        .await
        .unwrap();
    git(cwd, &["reset", "--hard", "HEAD"]);
    let saved = runner
        .repo_op_state(cwd, &cancel)
        .await
        .unwrap()
        .smart_recovery
        .unwrap();
    assert!(saved.can_restore);
    assert!(!cwd.join("draft.txt").exists());
    runner
        .restore_smart_changes(cwd, &saved.sha, &cancel)
        .await
        .unwrap();
    assert_local(cwd);
    assert!(!cwd.join("incoming.txt").exists());
}
