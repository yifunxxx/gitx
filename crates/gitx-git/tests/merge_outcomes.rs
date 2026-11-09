use gitx_core::{RepoOpKind, RewriteOutcome};
use gitx_git::GitRunner;
use gitx_testkit::{FixtureBuilder, FixtureRepo};
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

fn fixture(diverged: bool) -> FixtureRepo {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    git(path, &["config", "core.autocrlf", "false"]);
    git(path, &["checkout", "-b", "incoming"]);
    fs::write(path.join("incoming.txt"), "incoming\n").unwrap();
    git(path, &["add", "incoming.txt"]);
    git(path, &["commit", "-m", "incoming"]);
    git(path, &["checkout", "main"]);
    if diverged {
        fs::write(path.join("local-commit.txt"), "local commit\n").unwrap();
        git(path, &["add", "local-commit.txt"]);
        git(path, &["commit", "-m", "local commit"]);
    }
    repo
}

#[tokio::test]
async fn squash_reports_pending_commit_for_linear_and_diverged_history() {
    for diverged in [false, true] {
        let repo = fixture(diverged);
        let path = repo.path();
        let old = git(path, &["rev-parse", "HEAD"]);
        fs::write(path.join("local-untracked.txt"), "keep local\n").unwrap();
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let result = runner
            .with_rewrite_undo(
                path,
                &cancel,
                runner.merge_run(
                    path,
                    &["incoming".into()],
                    false,
                    false,
                    true,
                    None,
                    false,
                    false,
                    false,
                    false,
                    &cancel,
                ),
            )
            .await
            .unwrap();
        assert_eq!(
            result.outcome,
            RewriteOutcome::NothingToCommit,
            "{result:?}"
        );
        assert!(
            result.undo_head.is_none(),
            "staging alone is not an undoable history rewrite"
        );
        assert_eq!(result.old_head, old);
        assert_eq!(result.new_head, old);
        assert_eq!(git(path, &["rev-parse", "HEAD"]), old);
        assert_eq!(
            git(path, &["diff", "--cached", "--name-only"]),
            "incoming.txt"
        );
        assert_eq!(git(path, &["show", ":incoming.txt"]), "incoming");
        assert_eq!(
            fs::read_to_string(path.join("local-untracked.txt")).unwrap(),
            "keep local\n"
        );
        assert_eq!(
            runner.repo_op_state(path, &cancel).await.unwrap().kind,
            RepoOpKind::Normal
        );
    }
}

#[tokio::test]
async fn no_commit_reports_pending_merge_even_when_the_index_does_not_change() {
    for empty in [false, true] {
        let repo = fixture(true);
        let path = repo.path();
        if empty {
            // A divergent empty commit requires a merge commit, but no new file content.
            git(path, &["branch", "-f", "incoming", "main~1"]);
            git(path, &["checkout", "incoming"]);
            git(path, &["commit", "--allow-empty", "-m", "empty incoming"]);
            git(path, &["checkout", "main"]);
        }
        let old = git(path, &["rev-parse", "HEAD"]);
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let result = runner
            .merge_run(
                path,
                &["incoming".into()],
                false,
                false,
                false,
                None,
                true,
                false,
                false,
                false,
                &cancel,
            )
            .await
            .unwrap();
        assert_eq!(
            result.outcome,
            RewriteOutcome::NothingToCommit,
            "{result:?}"
        );
        assert_eq!(git(path, &["rev-parse", "HEAD"]), old);
        assert_eq!(
            runner.repo_op_state(path, &cancel).await.unwrap().kind,
            RepoOpKind::Merge
        );
        let completed = runner
            .merge_commit(path, Some("finish pending merge"), &cancel)
            .await
            .unwrap();
        assert_eq!(completed.outcome, RewriteOutcome::Success);
        assert_eq!(
            git(path, &["show", "-s", "--format=%P", "HEAD"])
                .split_whitespace()
                .count(),
            2
        );
    }
}

#[tokio::test]
async fn already_merged_does_not_claim_existing_staged_changes_came_from_merge() {
    for squash in [false, true] {
        let repo = fixture(false);
        let path = repo.path();
        fs::write(path.join("staged-local.txt"), "keep staged\n").unwrap();
        git(path, &["add", "staged-local.txt"]);
        let index = git(path, &["write-tree"]);
        let old = git(path, &["rev-parse", "HEAD"]);
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let result = runner
            .with_rewrite_undo(
                path,
                &cancel,
                runner.merge_run(
                    path,
                    &["main".into()],
                    false,
                    false,
                    squash,
                    None,
                    !squash,
                    false,
                    false,
                    false,
                    &cancel,
                ),
            )
            .await
            .unwrap();
        assert_eq!(result.outcome, RewriteOutcome::AlreadyUpToDate);
        assert!(result.undo_head.is_none());
        assert_eq!(git(path, &["write-tree"]), index);
        assert_eq!(git(path, &["rev-parse", "HEAD"]), old);
        assert_eq!(git(path, &["show", ":staged-local.txt"]), "keep staged");
    }
}

#[tokio::test]
async fn newly_created_merge_commit_is_not_reported_as_fast_forward() {
    let repo = fixture(true);
    let path = repo.path();
    let old = git(path, &["rev-parse", "HEAD"]);
    let incoming = git(path, &["rev-parse", "incoming"]);
    let result = GitRunner::new("git")
        .merge_run(
            path,
            &["incoming".into()],
            false,
            false,
            false,
            None,
            false,
            false,
            false,
            false,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::Success, "{result:?}");
    assert_eq!(
        git(path, &["show", "-s", "--format=%P", "HEAD"]),
        format!("{old} {incoming}")
    );
    assert_eq!(git(path, &["show", "HEAD:incoming.txt"]), "incoming");
    assert!(git(path, &["status", "--porcelain"]).is_empty());
}

#[tokio::test]
async fn fast_forward_to_existing_merge_commit_remains_fast_forward() {
    let repo = fixture(true);
    let path = repo.path();
    let old = git(path, &["rev-parse", "HEAD"]);
    git(path, &["checkout", "incoming"]);
    git(path, &["merge", "--no-edit", "main"]);
    let target = git(path, &["rev-parse", "HEAD"]);
    git(path, &["checkout", "main"]);
    let result = GitRunner::new("git")
        .merge_run(
            path,
            &["incoming".into()],
            false,
            false,
            false,
            None,
            true,
            false,
            false,
            false,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::FastForward);
    assert_eq!(result.old_head, old);
    assert_eq!(result.new_head, target);
    assert_eq!(git(path, &["rev-parse", "HEAD"]), target);
    assert!(git(path, &["status", "--porcelain"]).is_empty());
}

#[tokio::test]
async fn default_upstream_merge_reports_fast_forward() {
    let repo = fixture(false);
    let path = repo.path();
    git(path, &["branch", "--set-upstream-to=incoming", "main"]);
    let incoming = git(path, &["rev-parse", "incoming"]);
    let result = GitRunner::new("git")
        .merge_run(
            path,
            &[],
            false,
            false,
            false,
            None,
            false,
            false,
            false,
            false,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::FastForward);
    assert_eq!(result.new_head, incoming);
    assert_eq!(git(path, &["rev-parse", "HEAD"]), incoming);
    assert!(git(path, &["status", "--porcelain"]).is_empty());
}
