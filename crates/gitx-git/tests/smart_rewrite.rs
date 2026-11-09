use gitx_core::{RepoOpKind, RewriteOutcome};
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
