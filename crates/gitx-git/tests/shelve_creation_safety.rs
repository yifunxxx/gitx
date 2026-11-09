use gitx_core::ErrorCode;
use gitx_git::{GitInvocation, GitRunner};
use gitx_testkit::FixtureBuilder;
use std::path::Path;
use tokio_util::sync::CancellationToken;

async fn git(runner: &GitRunner, cwd: &Path, args: &[&str]) -> Vec<u8> {
    runner
        .run(
            GitInvocation::new(cwd, args.iter().copied()),
            &CancellationToken::new(),
        )
        .await
        .unwrap()
        .stdout
}

async fn shelve(
    runner: &GitRunner,
    cwd: &Path,
    paths: &[&str],
    keep: bool,
) -> Result<gitx_core::ShelfEntry, gitx_core::AppError> {
    runner
        .shelve_changes(
            cwd,
            "safety test",
            &paths.iter().map(|p| p.to_string()).collect::<Vec<_>>(),
            keep,
            None,
            false,
            &CancellationToken::new(),
        )
        .await
}

#[tokio::test]
async fn empty_shelf_does_not_publish_metadata_or_keepalive_refs() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let err = shelve(&runner, repo.path(), &["README.md"], false)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::NothingToCommit);
    assert!(runner
        .shelf_list(repo.path(), &CancellationToken::new())
        .await
        .unwrap()
        .is_empty());
    assert!(git(&runner, repo.path(), &["for-each-ref", "refs/gitx/"])
        .await
        .is_empty());
}

#[tokio::test]
async fn partial_staging_is_not_discarded_when_removing_shelved_changes() {
    for worktree_matches_head in [false, true] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        let runner = GitRunner::new("git");
        git(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
        let base = git(&runner, cwd, &["show", "HEAD:README.md"]).await;
        std::fs::write(cwd.join("README.md"), b"staged intermediate version\n").unwrap();
        git(&runner, cwd, &["add", "README.md"]).await;
        let worktree = if worktree_matches_head {
            base
        } else {
            b"working version\n".to_vec()
        };
        std::fs::write(cwd.join("README.md"), &worktree).unwrap();
        let staged = git(&runner, cwd, &["show", ":README.md"]).await;
        let result = shelve(&runner, cwd, &["README.md"], false).await;
        assert_eq!(
            git(&runner, cwd, &["show", ":README.md"]).await,
            staged,
            "intermediate staged data was lost"
        );
        assert_eq!(std::fs::read(cwd.join("README.md")).unwrap(), worktree);
        assert_eq!(result.unwrap_err().code, ErrorCode::ShelfFailed);
        assert!(runner
            .shelf_list(cwd, &CancellationToken::new())
            .await
            .unwrap()
            .is_empty());
    }
}

#[tokio::test]
async fn shelf_selection_treats_brackets_literally_and_ignores_untracked_paths() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    git(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    for path in ["file[1].txt", "file1.txt"] {
        std::fs::write(cwd.join(path), b"base\n").unwrap();
    }
    git(&runner, cwd, &["add", "."]).await;
    git(&runner, cwd, &["commit", "-m", "literal names"]).await;
    std::fs::write(cwd.join("file[1].txt"), b"selected\n").unwrap();
    std::fs::write(cwd.join("file1.txt"), b"unselected\n").unwrap();
    std::fs::write(cwd.join("untracked.txt"), b"untracked\n").unwrap();
    let entry = shelve(&runner, cwd, &["file[1].txt", "untracked.txt"], false)
        .await
        .unwrap();
    assert_eq!(entry.paths, ["file[1].txt"]);
    assert_eq!(std::fs::read(cwd.join("file[1].txt")).unwrap(), b"base\n");
    assert_eq!(
        std::fs::read(cwd.join("file1.txt")).unwrap(),
        b"unselected\n"
    );
    assert_eq!(
        std::fs::read(cwd.join("untracked.txt")).unwrap(),
        b"untracked\n"
    );
    runner
        .unshelve(cwd, &entry.id, false, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(cwd.join("file[1].txt")).unwrap(),
        b"selected\n"
    );
}

#[tokio::test]
async fn shelve_before_first_commit_removes_only_saved_tracked_additions() {
    let repo = tempfile::tempdir().unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    git(&runner, cwd, &["init", "-b", "main"]).await;
    git(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(cwd.join("first.txt"), b"initial work\n").unwrap();
    std::fs::write(cwd.join("untracked.txt"), b"keep\n").unwrap();
    git(&runner, cwd, &["add", "first.txt"]).await;
    let entry = shelve(&runner, cwd, &["first.txt", "untracked.txt"], false)
        .await
        .unwrap();
    assert_eq!(entry.paths, ["first.txt"]);
    assert!(!cwd.join("first.txt").exists());
    assert!(git(&runner, cwd, &["ls-files"]).await.is_empty());
    assert_eq!(std::fs::read(cwd.join("untracked.txt")).unwrap(), b"keep\n");
    runner
        .unshelve(cwd, &entry.id, false, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(cwd.join("first.txt")).unwrap(),
        b"initial work\n"
    );
    assert!(runner
        .run(
            GitInvocation::new(cwd, ["rev-parse", "--verify", "HEAD"]),
            &CancellationToken::new()
        )
        .await
        .is_err());
}

#[tokio::test]
async fn restore_lock_failure_is_reported_and_the_saved_patch_remains() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    std::fs::write(cwd.join("README.md"), b"saved but not removed\n").unwrap();
    let common = runner
        .git_common_dir(cwd, &CancellationToken::new())
        .await
        .unwrap();
    std::fs::write(common.join("index.lock"), b"test lock").unwrap();
    assert!(shelve(&runner, cwd, &["README.md"], false).await.is_err());
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        b"saved but not removed\n"
    );
    let list = runner
        .shelf_list(cwd, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(list.len(), 1);
    assert!(!gitx_meta::read_shelf_patch(&common, &list[0].id)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn staged_deletion_does_not_overwrite_an_untracked_replacement() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    git(&runner, cwd, &["rm", "README.md"]).await;
    std::fs::write(cwd.join("README.md"), b"untracked replacement\n").unwrap();
    assert!(shelve(&runner, cwd, &["README.md"], false).await.is_err());
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        b"untracked replacement\n"
    );
    assert!(git(&runner, cwd, &["ls-files", "--", "README.md"])
        .await
        .is_empty());
}

#[tokio::test]
async fn patch_is_applyable_despite_user_diff_prefix_and_color_settings() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    git(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    git(&runner, cwd, &["config", "diff.noprefix", "true"]).await;
    git(&runner, cwd, &["config", "color.ui", "always"]).await;
    std::fs::write(cwd.join("README.md"), b"portable patch\n").unwrap();
    let entry = shelve(&runner, cwd, &["README.md"], false).await.unwrap();
    runner
        .unshelve(cwd, &entry.id, false, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        b"portable patch\n"
    );
}

#[tokio::test]
async fn keep_changes_preserves_distinct_index_and_worktree_versions() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    git(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(cwd.join("README.md"), b"staged version\n").unwrap();
    git(&runner, cwd, &["add", "README.md"]).await;
    std::fs::write(cwd.join("README.md"), b"working version\n").unwrap();
    let entry = shelve(&runner, cwd, &["README.md"], true).await.unwrap();
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        b"working version\n"
    );
    assert_eq!(
        git(&runner, cwd, &["show", ":README.md"]).await,
        b"staged version\n"
    );
    let common = runner
        .git_common_dir(cwd, &CancellationToken::new())
        .await
        .unwrap();
    assert!(
        String::from_utf8(gitx_meta::read_shelf_patch(&common, &entry.id).unwrap())
            .unwrap()
            .contains("+working version")
    );
}

#[tokio::test]
async fn backup_ref_failure_or_cancellation_never_clears_changes() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    std::fs::write(cwd.join("README.md"), b"keep this work\n").unwrap();
    let common = runner
        .git_common_dir(cwd, &CancellationToken::new())
        .await
        .unwrap();
    let sha = String::from_utf8(git(&runner, cwd, &["rev-parse", "HEAD"]).await).unwrap();
    let refs = common.join("refs/gitx");
    std::fs::create_dir_all(&refs).unwrap();
    std::fs::write(
        refs.join(format!("shelf-base-{}.lock", sha.trim())),
        b"lock",
    )
    .unwrap();
    assert!(shelve(&runner, cwd, &["README.md"], false).await.is_err());
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        b"keep this work\n"
    );
    assert!(runner
        .shelf_list(cwd, &CancellationToken::new())
        .await
        .unwrap()
        .is_empty());
    let stopped = CancellationToken::new();
    stopped.cancel();
    assert_eq!(
        runner
            .shelve_changes(
                cwd,
                "cancel",
                &["README.md".into()],
                false,
                None,
                false,
                &stopped
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::Cancelled
    );
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        b"keep this work\n"
    );
}

#[tokio::test]
async fn file_changes_during_shelf_publication_are_not_removed() {
    for stage_change in [false, true] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        let runner = GitRunner::new("git");
        git(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
        std::fs::write(cwd.join("README.md"), b"snapshot version\n").unwrap();
        let common = runner
            .git_common_dir(cwd, &CancellationToken::new())
            .await
            .unwrap();
        let hook = common.join("hooks/reference-transaction");
        let action = if stage_change {
            "git add -- README.md"
        } else {
            "printf 'new editor version\\n' > README.md"
        };
        std::fs::write(&hook, format!("#!/bin/sh\n[ \"$1\" = committed ] || exit 0\nwhile read old new ref; do\ncase \"$ref\" in\nrefs/gitx/shelf/*) {action} ;;\nesac\ndone\n")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let error = shelve(&runner, cwd, &["README.md"], false)
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::ShelfFailed);
        let expected: &[u8] = if stage_change {
            b"snapshot version\n"
        } else {
            b"new editor version\n"
        };
        assert_eq!(std::fs::read(cwd.join("README.md")).unwrap(), expected);
        if stage_change {
            assert_eq!(git(&runner, cwd, &["show", ":README.md"]).await, expected);
        }
        let entries = runner
            .shelf_list(cwd, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(entries.len(), 1);
        assert!(error.message.contains(&entries[0].id));
        assert!(
            String::from_utf8(gitx_meta::read_shelf_patch(&common, &entries[0].id).unwrap())
                .unwrap()
                .contains("+snapshot version")
        );
    }
}

#[tokio::test]
async fn binary_additions_deletions_and_unicode_paths_roundtrip() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    git(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    let path = "文件 [1].bin";
    std::fs::write(cwd.join(path), [0, 1, 2, 9, 0, 3]).unwrap();
    git(&runner, cwd, &["add", "--", path]).await;
    git(&runner, cwd, &["rm", "README.md"]).await;
    let entry = shelve(&runner, cwd, &[path, "README.md"], false)
        .await
        .unwrap();
    assert!(entry.binary);
    assert_eq!(entry.paths, ["README.md", path]);
    assert!(cwd.join("README.md").exists());
    assert!(!cwd.join(path).exists());
    runner
        .unshelve(cwd, &entry.id, false, &CancellationToken::new())
        .await
        .unwrap();
    assert!(!cwd.join("README.md").exists());
    assert_eq!(std::fs::read(cwd.join(path)).unwrap(), [0, 1, 2, 9, 0, 3]);
}
