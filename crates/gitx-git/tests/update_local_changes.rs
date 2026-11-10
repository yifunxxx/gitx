use gitx_core::{ErrorCode, UpdateMethod};
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
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
fn peer(cwd: &Path) -> PathBuf {
    let path = cwd.parent().unwrap().join("peer");
    git(
        cwd,
        &[
            "clone",
            "--",
            &git(cwd, &["remote", "get-url", "origin"]),
            path.to_str().unwrap(),
        ],
    );
    git(&path, &["config", "core.autocrlf", "false"]);
    git(&path, &["config", "user.name", "QA"]);
    git(&path, &["config", "user.email", "qa@example.invalid"]);
    path
}
fn commit(cwd: &Path, file: &str, text: &str) {
    fs::write(cwd.join(file), text).unwrap();
    git(cwd, &["add", "--", file]);
    git(cwd, &["commit", "-m", "change"]);
}

#[tokio::test]
async fn updates_preserve_partial_staging_untracked_bytes_and_existing_stash() {
    for method in [
        UpdateMethod::Merge,
        UpdateMethod::Rebase,
        UpdateMethod::Reset,
    ] {
        let repo = FixtureBuilder::new().build("with-remote").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]);
        fs::write(cwd.join("README.md"), "old stash\n").unwrap();
        git(cwd, &["stash", "push", "-m", "user saved work"]);
        let previous = git(cwd, &["rev-parse", "refs/stash"]);
        let other = peer(cwd);
        commit(&other, "remote.txt", "incoming\n");
        git(&other, &["push"]);
        fs::write(cwd.join("README.md"), "staged\n").unwrap();
        git(cwd, &["add", "README.md"]);
        fs::write(cwd.join("README.md"), "staged and unstaged\n").unwrap();
        fs::write(cwd.join("本地.bin"), [0, 255, 14, 0]).unwrap();
        let index = git(cwd, &["diff", "--cached", "--binary"]);
        let work = git(cwd, &["diff", "--binary"]);
        let result = GitRunner::new("git")
            .update_project_run(cwd, method, &CancellationToken::new())
            .await
            .unwrap();
        assert_ne!(result.old_head, result.new_head);
        assert_eq!(
            fs::read_to_string(cwd.join("remote.txt")).unwrap(),
            "incoming\n"
        );
        assert_eq!(fs::read(cwd.join("本地.bin")).unwrap(), [0, 255, 14, 0]);
        assert_eq!(git(cwd, &["diff", "--cached", "--binary"]), index);
        assert_eq!(git(cwd, &["diff", "--binary"]), work);
        assert_eq!(git(cwd, &["stash", "list", "--format=%H"]), previous);
    }
}

#[tokio::test]
async fn clean_update_never_applies_an_existing_stash() {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    fs::write(cwd.join("README.md"), "keep saved\n").unwrap();
    git(cwd, &["stash", "push", "-m", "user saved work"]);
    let previous = git(cwd, &["rev-parse", "refs/stash"]);
    GitRunner::new("git")
        .update_project_run(cwd, UpdateMethod::Rebase, &CancellationToken::new())
        .await
        .unwrap();
    assert!(git(cwd, &["status", "--porcelain"]).is_empty());
    assert_eq!(git(cwd, &["rev-parse", "refs/stash"]), previous);
}

#[tokio::test]
async fn nonoverlapping_edits_in_one_file_are_merged_and_restored() {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let base = (0..30).map(|i| format!("line {i}\n")).collect::<String>();
    commit(cwd, "README.md", &base);
    git(cwd, &["push"]);
    let other = peer(cwd);
    commit(&other, "README.md", &base.replace("line 1\n", "remote\n"));
    git(&other, &["push"]);
    fs::write(cwd.join("README.md"), base.replace("line 28\n", "local\n")).unwrap();
    GitRunner::new("git")
        .update_project_run(cwd, UpdateMethod::Rebase, &CancellationToken::new())
        .await
        .unwrap();
    let text = fs::read_to_string(cwd.join("README.md")).unwrap();
    assert!(text.contains("remote\n") && text.contains("local\n"));
    assert!(git(cwd, &["stash", "list"]).is_empty());
}

#[tokio::test]
async fn restore_conflict_keeps_exact_saved_copy_and_remote_commit() {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let other = peer(cwd);
    commit(&other, "README.md", "remote\n");
    git(&other, &["push"]);
    fs::write(cwd.join("README.md"), "local\n").unwrap();
    let runner = GitRunner::new("git");
    let token = CancellationToken::new();
    let error = runner
        .update_project_run(cwd, UpdateMethod::Rebase, &token)
        .await
        .unwrap_err();
    let saved = runner.stash_list(cwd, &token).await.unwrap();
    assert_eq!(saved.len(), 1);
    assert!(error.message.contains(&saved[0].sha));
    assert_eq!(
        git(cwd, &["show", &format!("{}:README.md", saved[0].sha)]),
        "local"
    );
    assert_eq!(
        git(cwd, &["rev-parse", "HEAD"]),
        git(&other, &["rev-parse", "HEAD"])
    );
    assert!(!git(cwd, &["ls-files", "-u"]).is_empty());
}

#[tokio::test]
async fn untracked_collision_keeps_remote_file_and_saved_local_bytes() {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let other = peer(cwd);
    commit(&other, "new.txt", "remote\n");
    git(&other, &["push"]);
    fs::write(cwd.join("new.txt"), "local untracked\n").unwrap();
    let runner = GitRunner::new("git");
    let token = CancellationToken::new();
    assert!(runner
        .update_project_run(cwd, UpdateMethod::Merge, &token)
        .await
        .is_err());
    let saved = runner.stash_list(cwd, &token).await.unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(
        git(cwd, &["show", &format!("{}^3:new.txt", saved[0].sha)]),
        "local untracked"
    );
    assert_eq!(fs::read_to_string(cwd.join("new.txt")).unwrap(), "remote\n");
}

#[tokio::test]
async fn rebase_conflict_defers_restoration_until_after_abort() {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let other = peer(cwd);
    commit(&other, "README.md", "remote\n");
    git(&other, &["push"]);
    commit(cwd, "README.md", "local commit\n");
    fs::write(cwd.join("draft.txt"), "untracked draft\n").unwrap();
    let runner = GitRunner::new("git");
    let token = CancellationToken::new();
    let error = runner
        .update_project_run(cwd, UpdateMethod::Rebase, &token)
        .await
        .unwrap_err();
    let saved = runner.stash_list(cwd, &token).await.unwrap();
    assert_eq!(saved.len(), 1);
    assert!(error.message.contains(&saved[0].sha));
    assert!(!cwd.join("draft.txt").exists());
    assert!(!git(cwd, &["ls-files", "-u"]).is_empty());
    git(cwd, &["rebase", "--abort"]);
    runner
        .stash_apply(cwd, &saved[0].sha, true, &token)
        .await
        .unwrap();
    assert_eq!(
        fs::read_to_string(cwd.join("draft.txt")).unwrap(),
        "untracked draft\n"
    );
}

#[tokio::test]
async fn fetch_failure_and_precancellation_leave_local_files_untouched() {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    fs::write(cwd.join("README.md"), "local\n").unwrap();
    git(
        cwd,
        &["remote", "set-url", "origin", "missing-local-remote"],
    );
    let runner = GitRunner::new("git");
    let token = CancellationToken::new();
    assert!(runner
        .update_project_run(cwd, UpdateMethod::Rebase, &token)
        .await
        .is_err());
    assert_eq!(
        fs::read_to_string(cwd.join("README.md")).unwrap(),
        "local\n"
    );
    assert!(git(cwd, &["stash", "list"]).is_empty());
    token.cancel();
    let err = runner
        .update_project_run(cwd, UpdateMethod::Rebase, &token)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Cancelled);
    assert_eq!(
        fs::read_to_string(cwd.join("README.md")).unwrap(),
        "local\n"
    );
}
