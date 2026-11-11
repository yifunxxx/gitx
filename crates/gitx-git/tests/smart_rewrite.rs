use gitx_core::{RebaseTodoAction, RepoOpKind, RewriteOutcome};
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::{path::Path, process::Command};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn dirty_rebase_offers_smart_retry_without_changing_local_work() {
    for staged in [false, true] {
        let repo = FixtureBuilder::new().build("linear-history").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]);
        std::fs::write(cwd.join("c.txt"), "local work\n").unwrap();
        if staged {
            git(cwd, &["add", "c.txt"]);
        }
        std::fs::write(cwd.join("untracked.txt"), "untracked work\n").unwrap();
        let before = git(cwd, &["status", "--porcelain"]);
        let head = git(cwd, &["rev-parse", "HEAD"]);
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let error = runner
            .rebase_run(
                cwd, "HEAD~1", None, None, false, false, false, false, false, false, false, &cancel,
            )
            .await
            .unwrap_err();
        assert_eq!(
            error.code,
            gitx_core::ErrorCode::DirtyWorktreeWouldBeOverwritten
        );
        let args = error.args.unwrap();
        assert_eq!(args["operation"], "rebase");
        assert!(args["files"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("c.txt")));
        assert_eq!(git(cwd, &["status", "--porcelain"]), before);
        assert_eq!(git(cwd, &["rev-parse", "HEAD"]), head);
        assert!(!cwd.join(".git/rebase-merge").exists());
        assert_eq!(
            std::fs::read_to_string(cwd.join("untracked.txt")).unwrap(),
            "untracked work\n"
        );
    }
}

#[tokio::test]
async fn clean_smart_merge_does_not_pop_an_existing_stash() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("a.txt"), "saved work\n").unwrap();
    git(cwd, &["stash", "push", "-m", "previous"]);
    let stash = git(cwd, &["rev-parse", "refs/stash"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .merge_run(
            cwd,
            &["main".into()],
            false,
            false,
            false,
            None,
            false,
            false,
            false,
            true,
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(git(cwd, &["rev-parse", "refs/stash"]), stash);
    assert!(git(cwd, &["status", "--porcelain"]).trim().is_empty());
}

#[tokio::test]
async fn smart_merge_retains_work_through_conflicts_then_restores_on_commit_or_abort() {
    for abort in [false, true] {
        let repo = FixtureBuilder::new().build("merge-conflict").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]);
        std::fs::write(cwd.join("local.txt"), "staged local work\n").unwrap();
        git(cwd, &["add", "local.txt"]);
        std::fs::write(cwd.join("untracked.txt"), "untracked local work\n").unwrap();
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let result = runner
            .merge_run(
                cwd,
                &["feature".into()],
                false,
                false,
                false,
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
        assert!(!cwd.join("local.txt").exists());
        assert!(!cwd.join("untracked.txt").exists());
        assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap().len(), 1);
        if abort {
            runner.merge_abort(cwd, &cancel).await.unwrap();
        } else {
            std::fs::write(cwd.join("file.txt"), "resolved\n").unwrap();
            git(cwd, &["add", "file.txt"]);
            runner
                .merge_commit(cwd, Some("resolved merge"), &cancel)
                .await
                .unwrap();
        }
        assert_eq!(
            runner.repo_op_state(cwd, &cancel).await.unwrap().kind,
            RepoOpKind::Normal
        );
        assert_eq!(
            git(cwd, &["show", ":local.txt"]).trim(),
            "staged local work"
        );
        assert_eq!(
            std::fs::read_to_string(cwd.join("untracked.txt")).unwrap(),
            "untracked local work\n"
        );
        assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
        assert!(!cwd.join(".git/gitx/smart-stash.json").exists());
    }
}

#[tokio::test]
async fn restoration_conflict_keeps_the_stash_and_reports_failure() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let cwd = repo.path();
    git(cwd, &["checkout", "-b", "destination"]);
    std::fs::write(cwd.join("a.txt"), "destination change\n").unwrap();
    git(cwd, &["add", "a.txt"]);
    git(cwd, &["commit", "-m", "destination change"]);
    git(cwd, &["checkout", "main"]);
    std::fs::write(cwd.join("a.txt"), "local change\n").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .merge_run(
            cwd,
            &["destination".into()],
            false,
            false,
            false,
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
    let saved = runner.stash_list(cwd, &cancel).await.unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(
        git(cwd, &["show", &format!("{}:a.txt", saved[0].sha)]).trim(),
        "local change"
    );
    assert!(cwd.join(".git/gitx/smart-stash.json").exists());
    let state = git(cwd, &["status", "--porcelain"]);
    let bytes = std::fs::read(cwd.join("a.txt")).unwrap();
    assert!(runner
        .merge_run(
            cwd,
            &["destination".into()],
            false,
            false,
            false,
            None,
            false,
            false,
            false,
            true,
            &cancel
        )
        .await
        .is_err());
    assert_eq!(git(cwd, &["status", "--porcelain"]), state);
    assert_eq!(std::fs::read(cwd.join("a.txt")).unwrap(), bytes);
    assert_eq!(
        runner.stash_list(cwd, &cancel).await.unwrap()[0].sha,
        saved[0].sha
    );
}

#[tokio::test]
async fn edit_pause_keeps_local_index_separate_until_continue_or_abort() {
    for abort in [false, true] {
        let repo = FixtureBuilder::new().build("linear-history").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]);
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let head = git(cwd, &["rev-parse", "HEAD"]);
        let mut plan = runner
            .rebase_interactive_plan(cwd, head.trim(), &cancel)
            .await
            .unwrap();
        plan.items[0].action = RebaseTodoAction::Edit;
        local_changes(cwd);
        let before = git(cwd, &["status", "--porcelain"]);
        let result = runner
            .rebase_interactive_start(cwd, &plan, true, &cancel)
            .await
            .unwrap();
        assert_eq!(result.outcome, RewriteOutcome::Conflicts);
        assert_eq!(
            runner.repo_op_state(cwd, &cancel).await.unwrap().kind,
            RepoOpKind::Rebase
        );
        assert!(
            git(cwd, &["status", "--porcelain"]).is_empty(),
            "saved changes must not enter the edit index"
        );
        let saved = runner.stash_list(cwd, &cancel).await.unwrap();
        assert_eq!(saved.len(), 1);

        // Simulate another Git client saving work while this operation pauses.
        std::fs::write(cwd.join("other.txt"), "other stash\n").unwrap();
        git(cwd, &["stash", "push", "-u", "-m", "unrelated"]);
        let unrelated = git(cwd, &["rev-parse", "refs/stash"]);
        // A new runner models closing/reopening the app during the pause.
        let runner = GitRunner::new("git");
        if abort {
            runner.rebase_abort(cwd, &cancel).await.unwrap();
        } else {
            runner.rebase_continue(cwd, &cancel).await.unwrap();
        }
        assert_eq!(git(cwd, &["status", "--porcelain"]), before);
        assert_local_changes(cwd);
        assert_eq!(git(cwd, &["rev-parse", "refs/stash"]), unrelated);
        assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap().len(), 1);
        assert!(!cwd.join(".git/gitx/smart-stash.json").exists());
        assert!(!git(cwd, &["show", "HEAD:a.txt"]).contains("local"));
    }
}

#[tokio::test]
async fn rebase_conflict_keeps_work_saved_through_continue_skip_and_abort() {
    for action in ["continue", "skip", "abort"] {
        let repo = FixtureBuilder::new().build("merge-conflict").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]);
        std::fs::write(cwd.join("local.txt"), "staged local work\n").unwrap();
        git(cwd, &["add", "local.txt"]);
        std::fs::write(cwd.join("untracked.txt"), "untracked local work\n").unwrap();
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let result = runner
            .rebase_run(
                cwd, "feature", None, None, false, false, false, false, false, false, true, &cancel,
            )
            .await
            .unwrap();
        assert_eq!(result.outcome, RewriteOutcome::Conflicts);
        assert!(!cwd.join("local.txt").exists());
        assert!(!cwd.join("untracked.txt").exists());
        assert!(cwd.join(".git/gitx/smart-stash.json").exists());
        match action {
            "continue" => {
                std::fs::write(cwd.join("file.txt"), "resolved\n").unwrap();
                git(cwd, &["add", "file.txt"]);
                runner.rebase_continue(cwd, &cancel).await.unwrap();
            }
            "skip" => {
                runner.rebase_skip(cwd, &cancel).await.unwrap();
            }
            _ => {
                runner.rebase_abort(cwd, &cancel).await.unwrap();
            }
        }
        assert_eq!(
            runner.repo_op_state(cwd, &cancel).await.unwrap().kind,
            RepoOpKind::Normal
        );
        assert_eq!(git(cwd, &["show", ":local.txt"]), "staged local work\n");
        assert_eq!(
            std::fs::read_to_string(cwd.join("untracked.txt")).unwrap(),
            "untracked local work\n"
        );
        assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
        assert!(!cwd.join(".git/gitx/smart-stash.json").exists());
    }
}

#[tokio::test]
async fn cherry_pick_conflict_restores_saved_work_on_continue_skip_and_abort() {
    for action in ["continue", "skip", "abort"] {
        let repo = FixtureBuilder::new().build("merge-conflict").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]);
        std::fs::write(cwd.join("local.txt"), "staged local work\n").unwrap();
        git(cwd, &["add", "local.txt"]);
        std::fs::write(cwd.join("untracked.txt"), "untracked local work\n").unwrap();
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let result = runner
            .cherry_pick_run(cwd, &["feature".into()], None, false, false, true, &cancel)
            .await
            .unwrap();
        assert_eq!(result.outcome, RewriteOutcome::Conflicts);
        assert!(!cwd.join("local.txt").exists());
        assert!(!cwd.join("untracked.txt").exists());
        match action {
            "continue" => {
                std::fs::write(cwd.join("file.txt"), "resolved\n").unwrap();
                git(cwd, &["add", "file.txt"]);
                runner.cherry_pick_continue(cwd, &cancel).await.unwrap();
            }
            "skip" => {
                runner.cherry_pick_skip(cwd, &cancel).await.unwrap();
            }
            _ => {
                runner.cherry_pick_abort(cwd, &cancel).await.unwrap();
            }
        }
        assert_eq!(
            runner.repo_op_state(cwd, &cancel).await.unwrap().kind,
            RepoOpKind::Normal
        );
        assert_eq!(git(cwd, &["show", ":local.txt"]), "staged local work\n");
        assert_eq!(
            std::fs::read_to_string(cwd.join("untracked.txt")).unwrap(),
            "untracked local work\n"
        );
        assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
        assert!(!cwd.join(".git/gitx/smart-stash.json").exists());
    }
}

#[tokio::test]
async fn continuing_to_another_edit_does_not_restore_local_work() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let first = git(cwd, &["rev-parse", "HEAD~1"]);
    let mut plan = runner
        .rebase_interactive_plan(cwd, first.trim(), &cancel)
        .await
        .unwrap();
    assert_eq!(plan.items.len(), 2);
    for item in &mut plan.items {
        item.action = RebaseTodoAction::Edit;
    }
    local_changes(cwd);
    runner
        .rebase_interactive_start(cwd, &plan, true, &cancel)
        .await
        .unwrap();
    let saved = git(cwd, &["rev-parse", "refs/stash"]);
    let result = runner.rebase_continue(cwd, &cancel).await.unwrap();
    assert_eq!(result.outcome, RewriteOutcome::Conflicts);
    assert!(git(cwd, &["status", "--porcelain"]).is_empty());
    assert_eq!(git(cwd, &["rev-parse", "refs/stash"]), saved);
    runner.rebase_continue(cwd, &cancel).await.unwrap();
    assert_local_changes(cwd);
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
}

#[tokio::test]
async fn failed_smart_operation_restores_the_exact_local_state() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    local_changes(cwd);
    let before = git(cwd, &["status", "--porcelain"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    assert!(runner
        .rebase_run(
            cwd,
            "does-not-exist",
            None,
            None,
            false,
            false,
            false,
            false,
            false,
            false,
            true,
            &cancel
        )
        .await
        .is_err());
    assert_eq!(git(cwd, &["status", "--porcelain"]), before);
    assert_local_changes(cwd);
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
}

#[tokio::test]
async fn cancelling_a_running_smart_rebase_restores_changes_if_no_sequence_started() {
    for interactive in [false, true] {
        let repo = FixtureBuilder::new().build("linear-history").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]);
        git(cwd, &["checkout", "-b", "destination", "HEAD~1"]);
        std::fs::write(cwd.join("destination.txt"), "destination\n").unwrap();
        git(cwd, &["add", "destination.txt"]);
        git(cwd, &["commit", "-m", "destination"]);
        git(cwd, &["checkout", "main"]);
        let hook = cwd.join(".git/hooks/pre-rebase");
        std::fs::write(
            &hook,
            "#!/bin/sh\nprintf started > .git/smart-hook-started\nsleep 30\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        local_changes(cwd);
        let before = git(cwd, &["status", "--porcelain"]);
        let head = git(cwd, &["rev-parse", "HEAD"]);
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let mut plan = runner
            .rebase_interactive_plan(cwd, head.trim(), &cancel)
            .await
            .unwrap();
        plan.items[0].action = RebaseTodoAction::Edit;
        plan.onto = Some("destination".into());
        let operation = async {
            if interactive {
                runner
                    .rebase_interactive_start(cwd, &plan, true, &cancel)
                    .await
            } else {
                runner
                    .rebase_run(
                        cwd,
                        "destination",
                        None,
                        None,
                        false,
                        false,
                        false,
                        false,
                        false,
                        false,
                        true,
                        &cancel,
                    )
                    .await
            }
        };
        let interrupt = async {
            let reached = tokio::time::timeout(std::time::Duration::from_secs(15), async {
                while !cwd.join(".git/smart-hook-started").exists() {
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
            })
            .await;
            // Always release the operation even if the hook did not run.
            cancel.cancel();
            reached.expect("pre-rebase hook reached after stashing");
        };
        let (result, _) = tokio::join!(operation, interrupt);
        assert_eq!(result.unwrap_err().code, gitx_core::ErrorCode::Cancelled);
        assert_eq!(git(cwd, &["rev-parse", "HEAD"]), head);
        assert_eq!(git(cwd, &["status", "--porcelain"]), before);
        assert_local_changes(cwd);
        assert!(runner
            .stash_list(cwd, &CancellationToken::new())
            .await
            .unwrap()
            .is_empty());
        assert!(!cwd.join(".git/gitx/smart-stash.json").exists());
    }
}

#[tokio::test]
async fn cancelled_continue_leaves_edit_and_saved_work_available() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let head = git(cwd, &["rev-parse", "HEAD"]);
    let mut plan = runner
        .rebase_interactive_plan(cwd, head.trim(), &cancel)
        .await
        .unwrap();
    plan.items[0].action = RebaseTodoAction::Edit;
    local_changes(cwd);
    runner
        .rebase_interactive_start(cwd, &plan, true, &cancel)
        .await
        .unwrap();
    let saved = git(cwd, &["rev-parse", "refs/stash"]);
    let stopped = CancellationToken::new();
    stopped.cancel();
    assert!(runner.rebase_continue(cwd, &stopped).await.is_err());
    assert_eq!(git(cwd, &["rev-parse", "refs/stash"]), saved);
    assert!(git(cwd, &["status", "--porcelain"]).is_empty());
    runner.rebase_abort(cwd, &cancel).await.unwrap();
    assert_local_changes(cwd);
}

fn local_changes(cwd: &Path) {
    std::fs::write(cwd.join("a.txt"), "staged local\n").unwrap();
    git(cwd, &["add", "a.txt"]);
    std::fs::write(cwd.join("a.txt"), "unstaged local\n").unwrap();
    std::fs::write(cwd.join("untracked.txt"), "untracked local\n").unwrap();
}

fn assert_local_changes(cwd: &Path) {
    assert_eq!(git(cwd, &["show", ":a.txt"]), "staged local\n");
    assert_eq!(
        std::fs::read_to_string(cwd.join("a.txt")).unwrap(),
        "unstaged local\n"
    );
    assert_eq!(
        std::fs::read_to_string(cwd.join("untracked.txt")).unwrap(),
        "untracked local\n"
    );
}

fn git(cwd: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}
