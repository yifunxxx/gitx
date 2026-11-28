use gitx_git::{GitInvocation, GitRunner};
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

async fn git(cwd: &Path, args: &[&str]) -> Vec<u8> {
    GitRunner::new("git")
        .run(
            GitInvocation::new(cwd, args.iter().copied()),
            &CancellationToken::new(),
        )
        .await
        .unwrap()
        .stdout
}

async fn separate_repository() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let fixture = tempfile::tempdir().unwrap();
    let cwd = fixture.path().join("working tree\u{3000}");
    // Unlike a trailing ASCII space, U+3000 is supported by Windows paths too.
    let common = fixture.path().join("metadata\u{3000}");
    std::fs::create_dir(&cwd).unwrap();
    git(
        &cwd,
        &[
            "init",
            "-b",
            "main",
            "--separate-git-dir",
            common.to_str().unwrap(),
        ],
    )
    .await;
    git(&cwd, &["config", "user.name", "Path Test"]).await;
    git(&cwd, &["config", "user.email", "path@example.invalid"]).await;
    git(&cwd, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(cwd.join("file.txt"), b"base\n").unwrap();
    git(&cwd, &["add", "file.txt"]).await;
    git(&cwd, &["commit", "-m", "base"]).await;
    (fixture, cwd, common)
}

#[tokio::test]
async fn common_directory_preserves_trailing_unicode_whitespace() {
    let (_fixture, cwd, common) = separate_repository().await;
    let actual = GitRunner::new("git")
        .git_common_dir(&cwd, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(actual, common);
    assert_eq!(
        GitRunner::new("git")
            .git_dir(&cwd, &CancellationToken::new())
            .await
            .unwrap(),
        common
    );
}

#[tokio::test]
async fn repository_discovery_preserves_the_common_directory() {
    let (_fixture, cwd, common) = separate_repository().await;
    let root = GitRunner::new("git")
        .resolve_repo_root(&cwd, 0, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(Path::new(&root.common_dir), common.canonicalize().unwrap());
    assert_eq!(root.git_dir, root.common_dir);
    assert!(!root.is_worktree);
    assert_eq!(Path::new(&root.worktree_root), cwd);
}

#[tokio::test]
async fn exclude_does_not_create_a_trimmed_sibling_directory() {
    let (fixture, cwd, common) = separate_repository().await;
    let target = common.join("info/exclude");
    let contents = std::fs::read(&target).unwrap();
    let actual = GitRunner::new("git")
        .open_or_create_exclude(&cwd, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(actual, target);
    assert_eq!(std::fs::read(target).unwrap(), contents);
    assert!(!fixture.path().join("metadata").exists());
}

#[tokio::test]
async fn shelf_roundtrip_uses_the_actual_common_directory() {
    let (fixture, cwd, common) = separate_repository().await;
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let decoy = fixture.path().join("metadata");
    // An existing sibling must not receive another repository's metadata.
    std::fs::create_dir(&decoy).unwrap();
    std::fs::write(decoy.join("sentinel"), b"unrelated\n").unwrap();
    std::fs::write(cwd.join("file.txt"), b"shelved edit\n").unwrap();
    let entry = runner
        .shelve_changes(
            &cwd,
            "path preservation",
            &["file.txt".into()],
            false,
            None,
            false,
            &cancel,
        )
        .await
        .unwrap();
    assert!(common.join("gitx/shelf").join(&entry.id).is_dir());
    assert!(!decoy.join("gitx").exists());
    assert_eq!(std::fs::read(cwd.join("file.txt")).unwrap(), b"base\n");
    let config = common.join("config");
    let config_before = std::fs::read(&config).unwrap();
    let rejected = runner
        .shelf_export_patch(&cwd, &entry.id, &config, &cancel)
        .await
        .unwrap_err();
    assert_eq!(rejected.code, gitx_core::ErrorCode::InvalidArgument);
    assert_eq!(std::fs::read(&config).unwrap(), config_before);
    runner
        .unshelve(&cwd, &entry.id, false, &cancel)
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(cwd.join("file.txt")).unwrap(),
        b"shelved edit\n"
    );
    assert_eq!(
        std::fs::read(decoy.join("sentinel")).unwrap(),
        b"unrelated\n"
    );
}

#[tokio::test]
async fn normal_and_linked_worktrees_share_the_same_common_directory() {
    let repo = gitx_testkit::FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let expected = repo.path().join(".git").canonicalize().unwrap();
    let nested = repo.path().join("nested");
    std::fs::create_dir(&nested).unwrap();
    let linked_parent = tempfile::tempdir().unwrap();
    let linked = linked_parent.path().join("linked");
    git(
        repo.path(),
        &["worktree", "add", "--detach", linked.to_str().unwrap()],
    )
    .await;
    for cwd in [repo.path(), nested.as_path(), linked.as_path()] {
        assert_eq!(
            runner
                .git_common_dir(cwd, &cancel)
                .await
                .unwrap()
                .canonicalize()
                .unwrap(),
            expected
        );
        let root = runner.resolve_repo_root(cwd, 0, &cancel).await.unwrap();
        assert_eq!(Path::new(&root.common_dir), expected);
        assert_eq!(root.is_worktree, cwd == linked);
        assert_eq!(
            Path::new(&root.git_dir),
            runner
                .git_dir(cwd, &cancel)
                .await
                .unwrap()
                .canonicalize()
                .unwrap()
        );
    }
}

#[tokio::test]
async fn bare_common_directory_is_resolved_relative_to_the_invocation() {
    let fixture = tempfile::tempdir().unwrap();
    let cwd = fixture.path().join("bare\u{3000}");
    std::fs::create_dir(&cwd).unwrap();
    git(&cwd, &["init", "--bare"]).await;
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    assert_eq!(
        runner
            .git_common_dir(&cwd, &cancel)
            .await
            .unwrap()
            .canonicalize()
            .unwrap(),
        cwd.canonicalize().unwrap()
    );
    assert_eq!(
        runner
            .git_dir(&cwd, &cancel)
            .await
            .unwrap()
            .canonicalize()
            .unwrap(),
        cwd.canonicalize().unwrap()
    );
}
