use gitx_core::RewriteOutcome;
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::{path::Path, process::Command};
use tokio_util::sync::CancellationToken;

// One test owns this process's helper override for all scenarios.
#[tokio::test]
async fn fixup_targets_the_selected_commit_and_preserves_other_local_changes() {
    std::env::set_var("GITX_HELPER_PATH", env!("CARGO_BIN_EXE_gitx-helper"));
    fixup_targets_a_commit_with_an_autosquash_subject().await;
    squash_without_override_preserves_the_target_message().await;
    for (root_target, squash, dirty, staged) in [
        (false, false, false, true),
        (false, false, true, true),
        (true, true, true, true),
        (false, false, false, false),
    ] {
        let repo = FixtureBuilder::new().build("linear-history").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]);
        let file = if root_target { "a.txt" } else { "b.txt" };
        let target = git(
            cwd,
            &["rev-parse", if root_target { "HEAD~2" } else { "HEAD~1" }],
        );
        let old_head = git(cwd, &["rev-parse", "HEAD"]);
        std::fs::write(cwd.join(file), "fixed target\n").unwrap();
        if staged {
            git(cwd, &["add", file]);
        }
        if dirty {
            std::fs::write(cwd.join("c.txt"), "unrelated local edit\n").unwrap();
            std::fs::write(cwd.join("local.txt"), "untracked work\n").unwrap();
        }
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let result = runner
            .fixup_into(
                cwd,
                target.trim(),
                squash,
                if squash {
                    Some("custom combined message\n\nbody")
                } else {
                    None
                },
                &cancel,
            )
            .await
            .unwrap();
        assert_eq!(result.outcome, RewriteOutcome::Success);
        assert_eq!(result.old_head, old_head.trim());
        assert_eq!(git(cwd, &["rev-list", "--count", "HEAD"]).trim(), "3");
        let target_ref = if root_target { "HEAD~2" } else { "HEAD~1" };
        assert_eq!(
            git(cwd, &["show", &format!("{target_ref}:{file}")]).trim(),
            "fixed target",
            "changes must belong to the selected historical commit"
        );
        if squash {
            assert_eq!(
                git(cwd, &["log", "-1", "--format=%B", target_ref]).trim(),
                "custom combined message\n\nbody"
            );
        } else {
            assert_eq!(
                git(cwd, &["log", "-1", "--format=%s", target_ref]).trim(),
                "commit-b"
            );
        }
        assert_eq!(git(cwd, &["log", "-1", "--format=%s"]).trim(), "commit-c");
        assert_eq!(git(cwd, &["show", "HEAD:c.txt"]).trim(), "c");
        assert!(git(cwd, &["diff", "--cached", "--name-only"])
            .trim()
            .is_empty());
        if dirty {
            assert_eq!(
                std::fs::read_to_string(cwd.join("c.txt")).unwrap(),
                "unrelated local edit\n"
            );
            assert_eq!(
                std::fs::read_to_string(cwd.join("local.txt")).unwrap(),
                "untracked work\n"
            );
        } else {
            assert!(git(cwd, &["status", "--porcelain"]).trim().is_empty());
        }
    }
    fixup_preserves_merge_topology().await;
    fixup_conflict_abort_restores_unrelated_work().await;
    rejected_commit_hook_does_not_retry_with_all_files().await;
}

async fn fixup_targets_a_commit_with_an_autosquash_subject() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let tip = git(cwd, &["rev-parse", "HEAD"]);
    git(cwd, &["checkout", "-b", "target", "HEAD~1"]);
    git(cwd, &["commit", "--amend", "-m", "fixup! commit-a"]);
    git(cwd, &["cherry-pick", tip.trim()]);
    std::fs::write(cwd.join("b.txt"), "exact target fix\n").unwrap();
    git(cwd, &["add", "b.txt"]);
    let result = GitRunner::new("git")
        .fixup_into(cwd, "HEAD~1", false, None, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::Success);
    assert_eq!(git(cwd, &["rev-list", "--count", "HEAD"]).trim(), "3");
    assert_eq!(
        git(cwd, &["show", "HEAD~1:b.txt"]).trim(),
        "exact target fix"
    );
    assert_eq!(
        git(cwd, &["log", "-1", "--format=%s", "HEAD~1"]).trim(),
        "fixup! commit-a"
    );
    assert_eq!(git(cwd, &["log", "-1", "--format=%s"]).trim(), "commit-c");
}

async fn squash_without_override_preserves_the_target_message() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    git(
        cwd,
        &["commit", "--amend", "-m", "original title\n\n完整原始正文"],
    );
    std::fs::write(cwd.join("c.txt"), "squashed content\n").unwrap();
    git(cwd, &["add", "c.txt"]);
    let result = GitRunner::new("git")
        .fixup_into(cwd, "HEAD", true, None, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::Success);
    assert_eq!(git(cwd, &["rev-list", "--count", "HEAD"]).trim(), "3");
    assert_eq!(
        git(cwd, &["log", "-1", "--format=%B"]).trim(),
        "original title\n\n完整原始正文"
    );
    assert_eq!(git(cwd, &["show", "HEAD:c.txt"]).trim(), "squashed content");
    assert!(git(cwd, &["status", "--porcelain"]).trim().is_empty());
}

async fn fixup_preserves_merge_topology() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let target = git(cwd, &["rev-parse", "HEAD~1"]);
    git(cwd, &["checkout", "-b", "side", "HEAD~1"]);
    std::fs::write(cwd.join("side.txt"), "side\n").unwrap();
    git(cwd, &["add", "."]);
    git(cwd, &["commit", "-m", "side commit"]);
    git(cwd, &["checkout", "main"]);
    git(cwd, &["merge", "--no-ff", "side", "-m", "merge side"]);
    std::fs::write(cwd.join("b.txt"), "fixed target\n").unwrap();
    git(cwd, &["add", "b.txt"]);
    let result = GitRunner::new("git")
        .fixup_into(cwd, target.trim(), false, None, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::Success);
    assert_eq!(git(cwd, &["rev-list", "--count", "HEAD"]).trim(), "5");
    assert_eq!(
        git(cwd, &["rev-list", "--parents", "-n", "1", "HEAD"])
            .split_whitespace()
            .count(),
        3
    );
    assert_eq!(
        git(cwd, &["rev-parse", "HEAD~2"]),
        git(cwd, &["rev-parse", "HEAD^2^"])
    );
    assert_eq!(git(cwd, &["show", "HEAD~2:b.txt"]).trim(), "fixed target");
    assert_eq!(git(cwd, &["show", "HEAD:c.txt"]).trim(), "c");
    assert_eq!(git(cwd, &["show", "HEAD:side.txt"]).trim(), "side");
    assert!(git(cwd, &["status", "--porcelain"]).trim().is_empty());
}

async fn fixup_conflict_abort_restores_unrelated_work() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let target = git(cwd, &["rev-parse", "HEAD~1"]);
    std::fs::write(cwd.join("b.txt"), "later committed version\n").unwrap();
    git(cwd, &["add", "b.txt"]);
    git(cwd, &["commit", "-m", "later edit"]);
    std::fs::write(cwd.join("b.txt"), "local fix\n").unwrap();
    git(cwd, &["add", "b.txt"]);
    std::fs::write(cwd.join("local.txt"), "untracked work\n").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .fixup_into(cwd, target.trim(), false, None, &cancel)
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::Conflicts);
    assert!(!cwd.join("local.txt").exists());
    assert_eq!(
        runner.rebase_abort(cwd, &cancel).await.unwrap().outcome,
        RewriteOutcome::Success
    );
    assert_eq!(
        std::fs::read_to_string(cwd.join("local.txt")).unwrap(),
        "untracked work\n"
    );
    assert_eq!(
        std::fs::read_to_string(cwd.join("b.txt")).unwrap(),
        "local fix\n"
    );
    assert!(git(cwd, &["stash", "list"]).trim().is_empty());
    assert!(git(cwd, &["log", "-1", "--format=%s"]).starts_with("fixup!"));
    assert_eq!(
        runner.repo_op_state(cwd, &cancel).await.unwrap().kind,
        gitx_core::RepoOpKind::Normal
    );
}

async fn rejected_commit_hook_does_not_retry_with_all_files() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let old_head = git(cwd, &["rev-parse", "HEAD"]);
    std::fs::write(cwd.join("b.txt"), "staged fix\n").unwrap();
    git(cwd, &["add", "b.txt"]);
    std::fs::write(cwd.join("c.txt"), "unstaged work\n").unwrap();
    let hook = cwd.join(".git/hooks/pre-commit");
    std::fs::write(
        &hook,
        "#!/bin/sh\nprintf 'called\\n' >> .git/hook-calls\nexit 1\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    assert!(runner
        .fixup_into(cwd, "HEAD~1", false, None, &cancel)
        .await
        .is_err());
    assert_eq!(
        std::fs::read_to_string(cwd.join(".git/hook-calls")).unwrap(),
        "called\n"
    );
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]), old_head);
    assert_eq!(
        git(cwd, &["diff", "--cached", "--name-only"]).trim(),
        "b.txt"
    );
    assert_eq!(
        std::fs::read_to_string(cwd.join("c.txt")).unwrap(),
        "unstaged work\n"
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
