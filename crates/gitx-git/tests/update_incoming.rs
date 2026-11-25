use gitx_core::UpdateMethod;
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
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
    String::from_utf8(out.stdout)
        .unwrap()
        .trim_end()
        .to_string()
}

fn commit(cwd: &Path, file: &str, message: &str) -> String {
    fs::write(cwd.join(file), format!("{message}\n")).unwrap();
    git(cwd, &["add", "--", file]);
    git(cwd, &["commit", "-m", message]);
    git(cwd, &["rev-parse", "HEAD"])
}

async fn divergent_update(method: UpdateMethod) {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let base = git(cwd, &["rev-parse", "HEAD"]);
    let incoming = commit(cwd, "remote.txt", "Incoming remote change");
    git(cwd, &["push"]);
    let expected = git(cwd, &["show", "-s", "--oneline", &incoming]);
    git(cwd, &["reset", "--hard", &base]);
    let local = commit(cwd, "local.txt", "Local change to retain");
    fs::write(cwd.join("README.md"), "staged work\n").unwrap();
    git(cwd, &["add", "README.md"]);
    fs::write(cwd.join("README.md"), "staged and unstaged work\n").unwrap();
    let staged = git(cwd, &["diff", "--cached", "--binary"]);
    let unstaged = git(cwd, &["diff", "--binary"]);

    let result = GitRunner::new("git")
        .update_project_run(cwd, method, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(result.old_head, local);
    assert_eq!(result.new_head, git(cwd, &["rev-parse", "HEAD"]));
    assert_eq!(git(cwd, &["diff", "--cached", "--binary"]), staged);
    assert_eq!(git(cwd, &["diff", "--binary"]), unstaged);
    assert!(git(cwd, &["stash", "list"]).is_empty());
    assert_eq!(
        fs::read_to_string(cwd.join("remote.txt")).unwrap(),
        "Incoming remote change\n"
    );
    match method {
        UpdateMethod::Merge => assert_eq!(
            git(cwd, &["rev-list", "--parents", "-n", "1", "HEAD"]),
            format!("{} {local} {incoming}", result.new_head)
        ),
        UpdateMethod::Rebase => {
            assert_ne!(result.new_head, local);
            assert_eq!(git(cwd, &["rev-parse", "HEAD^"]), incoming);
        }
        UpdateMethod::Reset => assert_eq!(result.new_head, incoming),
    }
    assert_eq!(
        result.commits,
        vec![expected],
        "Only commits arriving from upstream belong in Incoming commits"
    );
    assert!(result.message.ends_with("in 1 commits"));
}

#[tokio::test]
async fn rebase_excludes_replayed_local_commits() {
    divergent_update(UpdateMethod::Rebase).await;
}

#[tokio::test]
async fn merge_excludes_the_locally_created_merge_commit() {
    divergent_update(UpdateMethod::Merge).await;
}

#[tokio::test]
async fn reset_reports_only_incoming_commits_and_keeps_dirty_work() {
    divergent_update(UpdateMethod::Reset).await;
}

#[tokio::test]
async fn fast_forward_reports_all_fetched_commits_in_log_order() {
    for method in [
        UpdateMethod::Merge,
        UpdateMethod::Rebase,
        UpdateMethod::Reset,
    ] {
        let repo = FixtureBuilder::new().build("with-remote").unwrap();
        let cwd = repo.path();
        let base = git(cwd, &["rev-parse", "HEAD"]);
        commit(cwd, "one.txt", "First remote change");
        let incoming = commit(cwd, "two.txt", "Second remote change");
        let expected: Vec<String> = git(cwd, &["log", "--oneline", &format!("{base}..{incoming}")])
            .lines()
            .map(str::to_owned)
            .collect();
        git(cwd, &["push"]);
        git(cwd, &["reset", "--hard", &base]);
        // Make the tracking ref stale: Update Project must include its own fetch.
        git(cwd, &["update-ref", "refs/remotes/origin/main", &base]);
        let result = GitRunner::new("git")
            .update_project_run(cwd, method, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(result.old_head, base);
        assert_eq!(result.new_head, incoming);
        assert_eq!(result.commits, expected);
    }
}

#[tokio::test]
async fn a_merge_already_on_the_remote_is_still_an_incoming_commit() {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let cwd = repo.path();
    let base = git(cwd, &["rev-parse", "HEAD"]);
    git(cwd, &["checkout", "-b", "feature"]);
    let feature = commit(cwd, "feature.txt", "Remote feature");
    git(cwd, &["checkout", "main"]);
    let main = commit(cwd, "main.txt", "Remote main");
    git(cwd, &["merge", "--no-edit", "feature"]);
    let merge = git(cwd, &["rev-parse", "HEAD"]);
    let mut expected: Vec<String> = [&feature, &main, &merge]
        .into_iter()
        .map(|sha| git(cwd, &["show", "-s", "--oneline", sha]))
        .collect();
    expected.sort();
    git(cwd, &["push"]);
    git(cwd, &["reset", "--hard", &base]);
    commit(cwd, "local.txt", "Local work outside remote merge");
    let mut result = GitRunner::new("git")
        .update_project_run(cwd, UpdateMethod::Rebase, &CancellationToken::new())
        .await
        .unwrap();
    result.commits.sort();
    assert_eq!(result.commits, expected);
    assert_eq!(git(cwd, &["rev-parse", "HEAD^"]), merge);
}

#[tokio::test]
async fn no_op_update_has_no_incoming_commits() {
    for method in [
        UpdateMethod::Merge,
        UpdateMethod::Rebase,
        UpdateMethod::Reset,
    ] {
        let repo = FixtureBuilder::new().build("with-remote").unwrap();
        let result = GitRunner::new("git")
            .update_project_run(repo.path(), method, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(result.old_head, result.new_head);
        assert!(result.commits.is_empty());
        assert_eq!(result.message, "All files are up-to-date");
    }
}

#[tokio::test]
async fn local_ahead_update_does_not_report_local_commits_as_incoming() {
    for method in [
        UpdateMethod::Merge,
        UpdateMethod::Rebase,
        UpdateMethod::Reset,
    ] {
        let repo = FixtureBuilder::new().build("with-remote").unwrap();
        let cwd = repo.path();
        let upstream = git(cwd, &["rev-parse", "HEAD"]);
        let local = commit(cwd, "local.txt", "Only local work");
        let result = GitRunner::new("git")
            .update_project_run(cwd, method, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(result.old_head, local);
        assert_eq!(
            result.new_head,
            if matches!(method, UpdateMethod::Reset) {
                upstream
            } else {
                local
            }
        );
        assert!(result.commits.is_empty());
    }
}
