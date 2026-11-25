use gitx_core::PullResult;
use gitx_git::GitRunner;
use gitx_testkit::{FixtureBuilder, FixtureRepo};
use std::{fs, path::Path, process::Command};
use tokio_util::sync::CancellationToken;

fn git(cwd: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(cwd)
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

fn commit(cwd: &Path, file: &str, message: &str) -> String {
    fs::write(cwd.join(file), format!("{message}\n")).unwrap();
    git(cwd, &["add", "--", file]);
    git(cwd, &["commit", "-m", message]);
    git(cwd, &["rev-parse", "HEAD"])
}

fn incoming(diverge: bool) -> (FixtureRepo, String, String) {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let base = git(cwd, &["rev-parse", "HEAD"]);
    let remote = commit(cwd, "remote.txt", "Remote incoming change");
    git(cwd, &["push"]);
    git(cwd, &["reset", "--hard", &base]);
    git(cwd, &["update-ref", "refs/remotes/origin/main", &base]);
    if diverge {
        commit(cwd, "local.txt", "Local change");
    }
    let old = git(cwd, &["rev-parse", "HEAD"]);
    (repo, old, remote)
}

async fn pull(cwd: &Path, rebase: bool, no_ff: bool, squash: bool, no_commit: bool) -> PullResult {
    GitRunner::new("git")
        .pull_run(
            cwd,
            "origin",
            "main",
            rebase,
            false,
            no_ff,
            squash,
            no_commit,
            false,
            &CancellationToken::new(),
        )
        .await
        .unwrap()
}

fn assert_incoming(cwd: &Path, result: &PullResult, sha: &str) {
    assert!(result.updated);
    assert_eq!(
        result.commits,
        vec![git(cwd, &["show", "-s", "--oneline", sha])]
    );
}

#[tokio::test]
async fn rebase_reports_remote_commits_without_local_replays() {
    let (repo, old, remote) = incoming(true);
    let result = pull(repo.path(), true, false, false, false).await;
    assert_eq!(result.old_head, old);
    assert_ne!(result.new_head, old);
    assert_eq!(git(repo.path(), &["rev-parse", "HEAD^"]), remote);
    assert_incoming(repo.path(), &result, &remote);
}

#[tokio::test]
async fn merge_reports_remote_commits_without_the_new_local_merge() {
    let (repo, old, remote) = incoming(true);
    let result = pull(repo.path(), false, false, false, false).await;
    assert_eq!(result.old_head, old);
    assert_eq!(
        git(repo.path(), &["rev-list", "--parents", "-n", "1", "HEAD"]),
        format!("{} {old} {remote}", result.new_head)
    );
    assert_incoming(repo.path(), &result, &remote);
}

#[tokio::test]
async fn no_commit_reports_incoming_commits_while_preserving_head() {
    let (repo, old, remote) = incoming(true);
    let result = pull(repo.path(), false, true, false, true).await;
    assert_eq!(result.new_head, old);
    assert_eq!(git(repo.path(), &["rev-parse", "MERGE_HEAD"]), remote);
    assert_eq!(result.message, "Changes applied; commit required");
    assert_eq!(result.updated_files.len(), 1);
    assert_eq!(result.updated_files[0].path, "remote.txt");
    assert_incoming(repo.path(), &result, &remote);
}

#[tokio::test]
async fn squash_reports_source_commits_and_preserves_unrelated_local_edits() {
    let (repo, old, remote) = incoming(true);
    fs::write(repo.path().join("README.md"), "Unstaged local work\n").unwrap();
    let work = git(repo.path(), &["diff", "--binary"]);
    let result = pull(repo.path(), false, false, true, false).await;
    assert_eq!(result.new_head, old);
    assert_eq!(result.message, "Changes applied; commit required");
    assert_eq!(git(repo.path(), &["diff", "--binary"]), work);
    assert_eq!(result.updated_files.len(), 1);
    assert_eq!(result.updated_files[0].path, "remote.txt");
    assert_incoming(repo.path(), &result, &remote);
}

#[tokio::test]
async fn no_commit_with_an_empty_remote_commit_still_reports_its_source() {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let cwd = repo.path();
    let base = git(cwd, &["rev-parse", "HEAD"]);
    git(
        cwd,
        &["commit", "--allow-empty", "-m", "Empty remote change"],
    );
    let remote = git(cwd, &["rev-parse", "HEAD"]);
    git(cwd, &["push"]);
    git(cwd, &["reset", "--hard", &base]);
    let result = pull(cwd, false, true, false, true).await;
    assert_eq!(result.new_head, base);
    assert_eq!(git(cwd, &["rev-parse", "MERGE_HEAD"]), remote);
    assert!(result.updated_files.is_empty());
    assert!(git(cwd, &["diff", "--cached", "--name-only"]).is_empty());
    assert_eq!(result.message, "Changes applied; commit required");
    assert_incoming(cwd, &result, &remote);
}

#[tokio::test]
async fn fast_forward_and_no_commit_fast_forward_report_fetched_commits() {
    for no_commit in [false, true] {
        let (repo, old, remote) = incoming(false);
        let result = pull(repo.path(), false, false, false, no_commit).await;
        assert_eq!(result.old_head, old);
        assert_eq!(result.new_head, remote);
        assert_incoming(repo.path(), &result, &remote);
    }
}

#[tokio::test]
async fn no_op_and_local_ahead_pulls_have_no_incoming_commits() {
    for local in [false, true] {
        let repo = FixtureBuilder::new().build("with-remote").unwrap();
        if local {
            commit(repo.path(), "local.txt", "Local only");
        }
        let result = pull(repo.path(), false, false, false, false).await;
        assert_eq!(result.old_head, result.new_head);
        assert!(!result.updated);
        assert!(result.commits.is_empty());
    }
}

#[tokio::test]
async fn selected_remote_branch_without_tracking_ref_is_the_incoming_source() {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let cwd = repo.path();
    let base = git(cwd, &["rev-parse", "HEAD"]);
    git(cwd, &["checkout", "-b", "review/incoming"]);
    let remote = commit(cwd, "selected.txt", "Selected branch change");
    git(cwd, &["tag", "incoming-tag"]);
    git(cwd, &["push", "origin", "review/incoming", "incoming-tag"]);
    git(cwd, &["checkout", "main"]);
    commit(cwd, "local.txt", "Local only");
    git(
        cwd,
        &[
            "remote",
            "add",
            "alternate",
            &git(cwd, &["remote", "get-url", "origin"]),
        ],
    );
    git(cwd, &["config", "--unset-all", "remote.alternate.fetch"]);
    let result = GitRunner::new("git")
        .pull_run(
            cwd,
            "alternate",
            "review/incoming",
            true,
            false,
            false,
            false,
            false,
            false,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(git(cwd, &["rev-parse", "@{u}"]), base);
    assert_eq!(git(cwd, &["rev-parse", "FETCH_HEAD"]), remote);
    assert_eq!(git(cwd, &["for-each-ref", "refs/remotes/alternate"]), "");
    assert_incoming(cwd, &result, &remote);
}
