//! M5: reword / squash / drop / reset / uncommit / interactive rebase / extract.

use gitx_core::{RebaseTodoAction, ResetMode, RewriteOutcome};
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn reword_head_and_older_in_memory_keeps_index() {
    let repo = FixtureBuilder::new()
        .build("linear-history")
        .expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    let head = runner.rev_parse_public(cwd, "HEAD", &cancel).await.unwrap();
    let fp_before = runner.worktree_fingerprint(cwd, &cancel).await.unwrap();

    let r = runner
        .reword_commit(cwd, &head, "commit-c-rewritten", &cancel)
        .await
        .expect("reword head");
    assert_eq!(r.outcome, RewriteOutcome::Success);
    assert!(r.backup_ref.is_some());
    let msg = git_stdout(cwd, &["log", "-1", "--format=%s"]);
    assert_eq!(msg.trim(), "commit-c-rewritten");

    let mid = runner
        .rev_parse_public(cwd, "HEAD~1", &cancel)
        .await
        .unwrap();
    let r2 = runner
        .reword_commit(cwd, &mid, "commit-b-rewritten", &cancel)
        .await
        .expect("reword mid");
    assert_eq!(r2.outcome, RewriteOutcome::Success);
    let fp_after = runner.worktree_fingerprint(cwd, &cancel).await.unwrap();
    assert_eq!(
        fp_before, fp_after,
        "in-memory reword must not touch index/worktree"
    );
    let subjects = git_stdout(cwd, &["log", "--format=%s"]);
    assert!(subjects.contains("commit-b-rewritten"));
    assert!(subjects.contains("commit-c-rewritten"));
}

#[tokio::test]
async fn squash_two_commits_and_undo() {
    let repo = FixtureBuilder::new()
        .build("linear-history")
        .expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    let b = runner
        .rev_parse_public(cwd, "HEAD~1", &cancel)
        .await
        .unwrap();
    let c = runner.rev_parse_public(cwd, "HEAD", &cancel).await.unwrap();
    let r = runner
        .squash_commits(cwd, &[b, c], "squashed-bc", &cancel)
        .await
        .expect("squash");
    assert_eq!(r.outcome, RewriteOutcome::Success);
    let count: u32 = git_stdout(cwd, &["rev-list", "--count", "HEAD"])
        .trim()
        .parse()
        .unwrap();
    assert_eq!(count, 2); // a + squashed
    assert!(git_stdout(cwd, &["log", "-1", "--format=%s"]).contains("squashed-bc"));

    let backup = r.backup_ref.expect("backup");
    let undo = runner
        .undo_rewrite(cwd, &backup, false, &cancel)
        .await
        .expect("undo");
    assert_eq!(undo.outcome, RewriteOutcome::Success);
    let count2: u32 = git_stdout(cwd, &["rev-list", "--count", "HEAD"])
        .trim()
        .parse()
        .unwrap();
    assert_eq!(count2, 3);
}

#[tokio::test]
async fn drop_middle_commit() {
    let repo = FixtureBuilder::new()
        .build("linear-history")
        .expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    let b = runner
        .rev_parse_public(cwd, "HEAD~1", &cancel)
        .await
        .unwrap();
    let r = runner.drop_commits(cwd, &[b], &cancel).await.expect("drop");
    assert_eq!(r.outcome, RewriteOutcome::Success);
    let subjects = git_stdout(cwd, &["log", "--format=%s"]);
    assert!(!subjects.contains("commit-b"));
    assert!(subjects.contains("commit-a"));
    assert!(subjects.contains("commit-c"));
    assert!(
        !cwd.join("b.txt").exists() || {
            // worktree still has files from checkout of trees — after drop, HEAD tree shouldn't have b.txt
            let tree = git_stdout(cwd, &["ls-tree", "-r", "--name-only", "HEAD"]);
            !tree.lines().any(|l| l == "b.txt")
        }
    );
}

#[tokio::test]
async fn uncommit_soft_and_reset_modes() {
    let repo = FixtureBuilder::new()
        .build("linear-history")
        .expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    let r = runner.uncommit(cwd, &cancel).await.expect("uncommit");
    assert_eq!(r.outcome, RewriteOutcome::Success);
    let count: u32 = git_stdout(cwd, &["rev-list", "--count", "HEAD"])
        .trim()
        .parse()
        .unwrap();
    assert_eq!(count, 2);
    // Staged file from undone commit.
    let cached = git_stdout(cwd, &["diff", "--cached", "--name-only"]);
    assert!(cached.contains("c.txt"));

    let target = runner
        .rev_parse_public(cwd, "HEAD~1", &cancel)
        .await
        .unwrap();
    let preview = runner
        .reset_preview(cwd, &target, &cancel)
        .await
        .expect("preview");
    assert!(preview.commits_affected >= 1);

    let soft = runner
        .reset_run(cwd, "HEAD", ResetMode::Mixed, &cancel)
        .await
        .expect("mixed reset to self is noop-ish");
    assert_eq!(soft.outcome, RewriteOutcome::Success);

    // Hard reset to first commit.
    let a = runner
        .rev_parse_public(cwd, "HEAD~1", &cancel)
        .await
        .unwrap();
    let hard = runner
        .reset_run(cwd, &a, ResetMode::Hard, &cancel)
        .await
        .expect("hard");
    assert_eq!(hard.outcome, RewriteOutcome::Success);
    assert!(hard.backup_ref.is_some());
    let count2: u32 = git_stdout(cwd, &["rev-list", "--count", "HEAD"])
        .trim()
        .parse()
        .unwrap();
    assert_eq!(count2, 1);
}

#[tokio::test]
async fn interactive_plan_and_start_reword_drop() {
    let repo = FixtureBuilder::new()
        .build("linear-history")
        .expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    let a = runner
        .rev_parse_public(cwd, "HEAD~2", &cancel)
        .await
        .unwrap();
    let mut plan = runner
        .rebase_interactive_plan(cwd, &a, &cancel)
        .await
        .expect("plan");
    assert_eq!(plan.items.len(), 3);
    // Drop middle, reword last.
    plan.items[1].action = RebaseTodoAction::Drop;
    plan.items[2].action = RebaseTodoAction::Reword;
    plan.items[2].message = Some("only-c".into());

    let r = runner
        .rebase_interactive_start(cwd, &plan, false, &cancel)
        .await
        .expect("start");
    assert_eq!(r.outcome, RewriteOutcome::Success);
    let subjects = git_stdout(cwd, &["log", "--format=%s"]);
    assert!(subjects.contains("commit-a"));
    assert!(!subjects.contains("commit-b"));
    assert!(subjects.contains("only-c"));
}

#[tokio::test]
async fn extract_selected_changes_keeps_final_tree() {
    let repo = FixtureBuilder::new()
        .build("linear-history")
        .expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    // Amend HEAD to touch two files in one commit so we can extract one path.
    std::fs::write(cwd.join("c.txt"), "c2\n").unwrap();
    std::fs::write(cwd.join("extra.txt"), "extra\n").unwrap();
    git(cwd, &["add", "c.txt", "extra.txt"]);
    git(cwd, &["commit", "--amend", "-m", "commit-c-multi"]);

    let head = runner.rev_parse_public(cwd, "HEAD", &cancel).await.unwrap();
    let tree_before = git_stdout(cwd, &["rev-parse", "HEAD^{tree}"]);
    let fp = runner.worktree_fingerprint(cwd, &cancel).await.unwrap();

    let r = runner
        .extract_changes(
            cwd,
            &head,
            &["extra.txt".into()],
            "extracted extra",
            &cancel,
        )
        .await
        .expect("extract");
    assert_eq!(r.outcome, RewriteOutcome::Success);
    let tree_after = git_stdout(cwd, &["rev-parse", "HEAD^{tree}"]);
    assert_eq!(
        tree_before.trim(),
        tree_after.trim(),
        "extract must preserve final tree"
    );
    let count: u32 = git_stdout(cwd, &["rev-list", "--count", "HEAD"])
        .trim()
        .parse()
        .unwrap();
    assert_eq!(count, 4); // a, b, c-without-extra, extracted
    let fp2 = runner.worktree_fingerprint(cwd, &cancel).await.unwrap();
    assert_eq!(fp, fp2);
}

#[tokio::test]
async fn revert_commit_creates_inverse() {
    let repo = FixtureBuilder::new()
        .build("linear-history")
        .expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    let c = runner.rev_parse_public(cwd, "HEAD", &cancel).await.unwrap();
    let r = runner
        .revert_run(cwd, &[c], None, false, &cancel)
        .await
        .expect("revert");
    assert_eq!(r.outcome, RewriteOutcome::Success);
    assert!(
        !cwd.join("c.txt").exists() || {
            let tree = git_stdout(cwd, &["ls-tree", "-r", "--name-only", "HEAD"]);
            !tree.lines().any(|l| l == "c.txt")
        }
    );
}

fn git(cwd: &std::path::Path, args: &[&str]) {
    let st = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .status()
        .expect("git");
    assert!(st.success(), "git {args:?} failed");
}

fn git_stdout(cwd: &std::path::Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}
