use gitx_git::GitRunner;
use gitx_testkit::{FixtureBuilder, FixtureRepo};
use std::{fs, path::Path, process::Command};
use tokio_util::sync::CancellationToken;

fn git(path: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

fn fixture() -> (FixtureRepo, String) {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    git(repo.path(), &["config", "core.autocrlf", "false"]);
    fs::write(repo.path().join("README.md"), "local content\n").unwrap();
    git(repo.path(), &["commit", "-am", "local content"]);
    git(repo.path(), &["checkout", "--detach"]);
    fs::write(repo.path().join("README.md"), "remote feature\n").unwrap();
    git(repo.path(), &["commit", "-am", "remote feature"]);
    let remote = git(repo.path(), &["rev-parse", "HEAD"]);
    git(
        repo.path(),
        &["update-ref", "refs/remotes/origin/feature/login", &remote],
    );
    git(repo.path(), &["checkout", "main"]);
    (repo, remote)
}

fn snapshot(path: &Path) -> (String, String, String, String, Vec<u8>) {
    (
        git(path, &["symbolic-ref", "HEAD"]),
        git(path, &["rev-parse", "HEAD"]),
        git(path, &["show-ref"]),
        git(path, &["write-tree"]),
        fs::read(path.join("README.md")).unwrap(),
    )
}

#[tokio::test]
async fn remote_checkout_preserves_branch_directory_and_ignores_basename_collision() {
    let (repo, remote) = fixture();
    git(repo.path(), &["branch", "login"]);
    let existing = git(repo.path(), &["rev-parse", "login"]);
    GitRunner::new("git")
        .branch_checkout(
            repo.path(),
            "origin/feature/login",
            "remote",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(
        git(repo.path(), &["branch", "--show-current"]),
        "feature/login"
    );
    assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), remote);
    assert_eq!(
        git(
            repo.path(),
            &["rev-parse", "--symbolic-full-name", "@{upstream}"]
        ),
        "refs/remotes/origin/feature/login"
    );
    assert_eq!(git(repo.path(), &["rev-parse", "login"]), existing);
}

#[tokio::test]
async fn remote_checkout_reuses_the_matching_tracking_branch_without_reset() {
    let (repo, _) = fixture();
    git(
        repo.path(),
        &[
            "checkout",
            "-b",
            "feature/login",
            "--track",
            "origin/feature/login",
        ],
    );
    git(
        repo.path(),
        &["commit", "--allow-empty", "-m", "local unpushed"],
    );
    let expected = git(repo.path(), &["rev-parse", "HEAD"]);
    git(repo.path(), &["checkout", "main"]);
    GitRunner::new("git")
        .branch_checkout(
            repo.path(),
            "origin/feature/login",
            "remote",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(
        git(repo.path(), &["branch", "--show-current"]),
        "feature/login"
    );
    assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), expected);
}

#[tokio::test]
async fn remote_checkout_rejects_a_conflicting_existing_local_branch() {
    let (repo, _) = fixture();
    git(repo.path(), &["branch", "feature/login"]);
    let before = snapshot(repo.path());
    let result = GitRunner::new("git")
        .branch_checkout(
            repo.path(),
            "origin/feature/login",
            "remote",
            &CancellationToken::new(),
        )
        .await;
    assert!(
        result.is_err(),
        "checkout must not silently select or create a different branch"
    );
    assert_eq!(snapshot(repo.path()), before);
}

#[tokio::test]
async fn missing_remote_ref_cannot_succeed_by_selecting_a_local_namesake() {
    let (repo, _) = fixture();
    git(repo.path(), &["branch", "missing"]);
    let before = snapshot(repo.path());
    let result = GitRunner::new("git")
        .branch_checkout(
            repo.path(),
            "origin/missing",
            "remote",
            &CancellationToken::new(),
        )
        .await;
    assert!(result.is_err());
    assert_eq!(snapshot(repo.path()), before);
}

#[tokio::test]
async fn local_checkout_cannot_treat_a_file_path_as_a_restore_operation() {
    let (repo, _) = fixture();
    fs::write(repo.path().join("README.md"), "keep unfinished work\n").unwrap();
    let before = snapshot(repo.path());
    let result = GitRunner::new("git")
        .branch_checkout(repo.path(), "README.md", "local", &CancellationToken::new())
        .await;
    assert!(result.is_err());
    assert_eq!(snapshot(repo.path()), before);
}

#[tokio::test]
async fn checkout_rejects_option_like_targets_without_discarding_work() {
    let (repo, _) = fixture();
    fs::write(repo.path().join("README.md"), "keep unfinished work\n").unwrap();
    let before = snapshot(repo.path());
    let result = GitRunner::new("git")
        .branch_checkout(repo.path(), "-f", "local", &CancellationToken::new())
        .await;
    assert!(result.is_err());
    assert_eq!(snapshot(repo.path()), before);
}

#[tokio::test]
async fn remote_checkout_accepts_full_refs_and_slashes_in_remote_names() {
    let (repo, remote) = fixture();
    let url = git(repo.path(), &["remote", "get-url", "origin"]);
    git(repo.path(), &["remote", "add", "team/upstream", &url]);
    git(
        repo.path(),
        &[
            "update-ref",
            "refs/remotes/team/upstream/feature/中文",
            &remote,
        ],
    );
    GitRunner::new("git")
        .branch_checkout(
            repo.path(),
            "refs/remotes/team/upstream/feature/中文",
            "remote",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(
        git(repo.path(), &["branch", "--show-current"]),
        "feature/中文"
    );
    assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), remote);
    assert_eq!(
        git(
            repo.path(),
            &["rev-parse", "--symbolic-full-name", "@{upstream}"]
        ),
        "refs/remotes/team/upstream/feature/中文"
    );
}

#[tokio::test]
async fn revision_checkout_detaches_at_the_selected_annotated_tag() {
    let (repo, remote) = fixture();
    git(
        repo.path(),
        &["tag", "-a", "release", &remote, "-m", "tag message"],
    );
    git(repo.path(), &["branch", "release"]);
    GitRunner::new("git")
        .branch_checkout(
            repo.path(),
            "refs/tags/release",
            "revision",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(git(repo.path(), &["branch", "--show-current"]), "");
    assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), remote);
}
