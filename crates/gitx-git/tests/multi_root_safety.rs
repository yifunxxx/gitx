use gitx_core::ErrorCode;
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

fn fixture() -> FixtureRepo {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    git(repo.path(), &["config", "core.autocrlf", "false"]);
    fs::write(repo.path().join("README.md"), "main content\n").unwrap();
    git(repo.path(), &["commit", "-am", "main content"]);
    git(repo.path(), &["checkout", "-b", "shared"]);
    fs::write(repo.path().join("README.md"), "shared content\n").unwrap();
    git(repo.path(), &["commit", "-am", "shared content"]);
    git(repo.path(), &["checkout", "main"]);
    repo
}

fn roots(repos: &[&FixtureRepo]) -> Vec<String> {
    repos
        .iter()
        .map(|repo| repo.path().display().to_string())
        .collect()
}

fn recursive_fixture() -> (FixtureRepo, FixtureRepo, std::path::PathBuf) {
    let source = fixture();
    let parent = FixtureBuilder::new().build("clean").unwrap();
    git(parent.path(), &["config", "core.autocrlf", "false"]);
    git(
        parent.path(),
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            source.path().to_str().unwrap(),
            "module",
        ],
    );
    git(parent.path(), &["commit", "-am", "module on main"]);
    let module = parent.path().join("module");
    git(&module, &["config", "core.autocrlf", "false"]);
    // Normalize the disposable clone before recording its clean baseline.
    git(&module, &["checkout", "--force", "main"]);
    git(parent.path(), &["checkout", "-b", "shared"]);
    git(&module, &["checkout", "-b", "shared", "origin/shared"]);
    git(parent.path(), &["commit", "-am", "module on shared"]);
    git(
        parent.path(),
        &["checkout", "--no-recurse-submodules", "main"],
    );
    git(&module, &["checkout", "main"]);
    git(parent.path(), &["config", "submodule.recurse", "true"]);
    assert!(git(parent.path(), &["status", "--porcelain"]).is_empty());
    (source, parent, module)
}

#[tokio::test]
async fn recursive_config_does_not_change_a_skipped_submodule() {
    let (_source, parent, module) = recursive_fixture();
    git(&module, &["branch", "-D", "shared"]);
    let before = git(&module, &["rev-parse", "HEAD"]);
    let result = GitRunner::new("git")
        .multi_root_checkout(
            &[
                parent.path().display().to_string(),
                module.display().to_string(),
            ],
            "shared",
            "local",
            true,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(result.ok && result.steps[1].skipped, "{result:?}");
    assert_eq!(git(&module, &["rev-parse", "HEAD"]), before);
    assert_eq!(git(&module, &["branch", "--show-current"]), "main");
    assert_eq!(
        fs::read(module.join("README.md")).unwrap(),
        b"main content\n"
    );
}

#[tokio::test]
async fn recursive_config_preserves_submodule_identity_during_explicit_rollback() {
    let (_source, parent, module) = recursive_fixture();
    let before = git(&module, &["rev-parse", "HEAD"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .multi_root_checkout(
            &[
                parent.path().display().to_string(),
                module.display().to_string(),
            ],
            "shared",
            "local",
            true,
            &cancel,
        )
        .await
        .unwrap();
    assert!(result.ok, "{result:?}");
    let recovery = runner
        .multi_root_rollback(&result.steps, &cancel)
        .await
        .unwrap();
    assert!(recovery.rolled_back, "{recovery:?}");
    assert_eq!(git(parent.path(), &["branch", "--show-current"]), "main");
    assert_eq!(git(&module, &["branch", "--show-current"]), "main");
    assert_eq!(git(&module, &["rev-parse", "HEAD"]), before);
    assert!(git(parent.path(), &["status", "--porcelain"]).is_empty());
}

#[tokio::test]
async fn recursive_config_preserves_submodule_identity_during_automatic_rollback() {
    let (_source, parent, module) = recursive_fixture();
    let dirty = fixture();
    fs::write(dirty.path().join("README.md"), b"keep local edit\n").unwrap();
    let before = git(&module, &["rev-parse", "HEAD"]);
    let result = GitRunner::new("git")
        .multi_root_checkout(
            &[
                parent.path().display().to_string(),
                module.display().to_string(),
                dirty.path().display().to_string(),
            ],
            "shared",
            "local",
            true,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(!result.ok && result.rolled_back, "{result:?}");
    assert_eq!(git(parent.path(), &["branch", "--show-current"]), "main");
    assert_eq!(git(&module, &["branch", "--show-current"]), "main");
    assert_eq!(git(&module, &["rev-parse", "HEAD"]), before);
    assert!(git(parent.path(), &["status", "--porcelain"]).is_empty());
    assert_eq!(
        fs::read(dirty.path().join("README.md")).unwrap(),
        b"keep local edit\n"
    );
}

#[tokio::test]
async fn automatic_rollback_restores_the_exact_detached_head() {
    let a = fixture();
    let b = fixture();
    let old = git(a.path(), &["rev-parse", "main"]);
    git(a.path(), &["checkout", "--detach", &old]);
    fs::write(b.path().join("README.md"), "local edit\n").unwrap();
    let result = GitRunner::new("git")
        .multi_root_checkout(
            &roots(&[&a, &b]),
            "shared",
            "local",
            true,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(!result.ok && result.rolled_back, "{result:?}");
    assert_eq!(git(a.path(), &["rev-parse", "HEAD"]), old);
    assert_eq!(
        git(a.path(), &["rev-parse", "--abbrev-ref", "HEAD"]),
        "HEAD"
    );
    assert_eq!(git(b.path(), &["branch", "--show-current"]), "main");
    assert_eq!(
        fs::read(b.path().join("README.md")).unwrap(),
        b"local edit\n"
    );
}

#[tokio::test]
async fn failed_automatic_rollback_is_not_reported_as_complete() {
    let a = fixture();
    let b = fixture();
    fs::write(
        a.path().join(".git/hooks/post-checkout"),
        "#!/bin/sh\nprintf 'qa lock' > .git/index.lock\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            a.path().join(".git/hooks/post-checkout"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
    }
    fs::write(b.path().join("README.md"), "local edit\n").unwrap();
    let result = GitRunner::new("git")
        .multi_root_checkout(
            &roots(&[&a, &b]),
            "shared",
            "local",
            true,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(!result.ok);
    assert!(
        !result.rolled_back,
        "failed rollback was reported as complete: {result:?}"
    );
    assert_eq!(git(a.path(), &["branch", "--show-current"]), "shared");
    assert_eq!(
        fs::read(a.path().join(".git/index.lock")).unwrap(),
        b"qa lock"
    );
    assert!(result.steps[0]
        .rollback_error
        .as_deref()
        .unwrap()
        .contains("index.lock"));
    // Only this fixture created the lock and hook; remove both to retry recovery.
    fs::remove_file(a.path().join(".git/index.lock")).unwrap();
    fs::remove_file(a.path().join(".git/hooks/post-checkout")).unwrap();
    let recovery = GitRunner::new("git")
        .multi_root_rollback(&result.steps, &CancellationToken::new())
        .await
        .unwrap();
    assert!(recovery.ok && recovery.rolled_back, "{recovery:?}");
    assert_eq!(git(a.path(), &["branch", "--show-current"]), "main");
    assert_eq!(
        fs::read(b.path().join("README.md")).unwrap(),
        b"local edit\n"
    );
}

#[tokio::test]
async fn explicit_rollback_does_not_checkout_a_skipped_root() {
    let a = fixture();
    let b = fixture();
    git(b.path(), &["branch", "-D", "shared"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .multi_root_checkout(&roots(&[&a, &b]), "shared", "local", false, &cancel)
        .await
        .unwrap();
    assert!(result.ok);
    git(b.path(), &["checkout", "-b", "user-selected"]);
    let rollback = runner
        .multi_root_rollback(&result.steps, &cancel)
        .await
        .unwrap();
    assert!(rollback.ok && rollback.rolled_back, "{rollback:?}");
    assert_eq!(git(a.path(), &["branch", "--show-current"]), "main");
    assert_eq!(
        git(b.path(), &["branch", "--show-current"]),
        "user-selected"
    );
}

#[tokio::test]
async fn explicit_rollback_refuses_a_later_user_checkout() {
    let repo = fixture();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .multi_root_checkout(&roots(&[&repo]), "shared", "local", false, &cancel)
        .await
        .unwrap();
    git(repo.path(), &["checkout", "-b", "later-user-branch"]);
    let before = git(repo.path(), &["rev-parse", "HEAD"]);
    let rollback = runner
        .multi_root_rollback(&result.steps, &cancel)
        .await
        .unwrap();
    assert!(!rollback.ok && !rollback.rolled_back, "{rollback:?}");
    assert_eq!(
        git(repo.path(), &["branch", "--show-current"]),
        "later-user-branch"
    );
    assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), before);
}

#[tokio::test]
async fn cancelled_checkout_cannot_be_reported_as_a_successful_skip() {
    let repo = fixture();
    let cancel = CancellationToken::new();
    cancel.cancel();
    let result = GitRunner::new("git")
        .multi_root_checkout(&roots(&[&repo]), "shared", "local", true, &cancel)
        .await;
    assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
    assert_eq!(git(repo.path(), &["branch", "--show-current"]), "main");
}

#[tokio::test]
async fn checkout_hook_failure_after_head_moves_is_rolled_back() {
    let repo = fixture();
    let hook = repo.path().join(".git/hooks/post-checkout");
    fs::write(
        &hook,
        "#!/bin/sh\n[ \"$(git branch --show-current)\" != shared ]\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let before = git(repo.path(), &["rev-parse", "HEAD"]);
    let result = GitRunner::new("git")
        .multi_root_checkout(
            &roots(&[&repo]),
            "shared",
            "local",
            true,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(!result.ok && result.rolled_back, "{result:?}");
    assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), before);
    assert_eq!(git(repo.path(), &["branch", "--show-current"]), "main");
    assert_eq!(
        fs::read(repo.path().join("README.md")).unwrap(),
        b"main content\n"
    );
}

#[tokio::test]
async fn rollback_refuses_when_the_original_branch_tip_has_changed() {
    let repo = fixture();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .multi_root_checkout(&roots(&[&repo]), "shared", "local", false, &cancel)
        .await
        .unwrap();
    git(repo.path(), &["branch", "-f", "main", "shared"]);
    let refs = git(repo.path(), &["show-ref"]);
    let recovery = runner
        .multi_root_rollback(&result.steps, &cancel)
        .await
        .unwrap();
    assert!(!recovery.ok && !recovery.rolled_back);
    assert!(recovery.steps[0]
        .rollback_error
        .as_deref()
        .unwrap()
        .contains("original branch changed"));
    assert_eq!(git(repo.path(), &["branch", "--show-current"]), "shared");
    assert_eq!(git(repo.path(), &["show-ref"]), refs);
}

#[tokio::test]
async fn rollback_preserves_new_staged_unstaged_and_untracked_files() {
    let repo = fixture();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .multi_root_checkout(&roots(&[&repo]), "shared", "local", false, &cancel)
        .await
        .unwrap();
    fs::write(repo.path().join("README.md"), "staged\n").unwrap();
    git(repo.path(), &["add", "README.md"]);
    fs::write(repo.path().join("README.md"), "unstaged\n").unwrap();
    fs::write(repo.path().join("untracked.txt"), "untracked\n").unwrap();
    let index = git(repo.path(), &["write-tree"]);
    let recovery = runner
        .multi_root_rollback(&result.steps, &cancel)
        .await
        .unwrap();
    assert!(!recovery.ok && !recovery.rolled_back);
    assert_eq!(git(repo.path(), &["branch", "--show-current"]), "shared");
    assert_eq!(git(repo.path(), &["write-tree"]), index);
    assert_eq!(
        fs::read(repo.path().join("README.md")).unwrap(),
        b"unstaged\n"
    );
    assert_eq!(
        fs::read(repo.path().join("untracked.txt")).unwrap(),
        b"untracked\n"
    );
}

#[tokio::test]
async fn duplicate_root_aliases_do_not_overwrite_the_original_recovery_position() {
    let repo = fixture();
    fs::create_dir(repo.path().join("child")).unwrap();
    let mut paths = roots(&[&repo, &repo]);
    paths.push(repo.path().join("child").display().to_string());
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .multi_root_checkout(&paths, "shared", "local", false, &cancel)
        .await
        .unwrap();
    assert!(result.ok);
    assert_eq!(result.steps.len(), 1);
    assert!(
        runner
            .multi_root_rollback(&result.steps, &cancel)
            .await
            .unwrap()
            .rolled_back
    );
    assert_eq!(git(repo.path(), &["branch", "--show-current"]), "main");
}

#[tokio::test]
async fn fully_qualified_local_branch_is_checked_out_and_can_be_restored() {
    let repo = fixture();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .multi_root_checkout(
            &roots(&[&repo]),
            "refs/heads/shared",
            "local",
            true,
            &cancel,
        )
        .await
        .unwrap();
    assert!(result.ok && !result.steps[0].skipped, "{result:?}");
    assert_eq!(git(repo.path(), &["branch", "--show-current"]), "shared");
    assert_eq!(
        fs::read(repo.path().join("README.md")).unwrap(),
        b"shared content\n"
    );
    let recovery = runner
        .multi_root_rollback(&result.steps, &cancel)
        .await
        .unwrap();
    assert!(recovery.ok && recovery.rolled_back, "{recovery:?}");
    assert_eq!(git(repo.path(), &["branch", "--show-current"]), "main");
    assert!(git(repo.path(), &["status", "--porcelain"]).is_empty());
}

#[tokio::test]
async fn fully_qualified_option_like_target_cannot_discard_local_changes() {
    let repo = fixture();
    fs::write(repo.path().join("README.md"), b"keep local changes\n").unwrap();
    let head = git(repo.path(), &["rev-parse", "HEAD"]);
    for target in ["refs/heads/-f", "refs/heads/", "-f"] {
        let error = GitRunner::new("git")
            .multi_root_checkout(
                &roots(&[&repo]),
                target,
                "local",
                true,
                &CancellationToken::new(),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArgument);
        assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), head);
        assert_eq!(git(repo.path(), &["branch", "--show-current"]), "main");
        assert_eq!(
            fs::read(repo.path().join("README.md")).unwrap(),
            b"keep local changes\n"
        );
    }
}
