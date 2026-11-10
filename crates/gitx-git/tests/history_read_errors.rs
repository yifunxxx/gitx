use gitx_core::{DiffSide, ErrorCode};
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::path::Path;
use std::process::Command;
use tokio_util::sync::CancellationToken;

fn git(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}

fn remove_object(cwd: &Path, revision: &str) -> Vec<u8> {
    let oid = git(cwd, &["rev-parse", revision]);
    let path = cwd.join(".git/objects").join(&oid[..2]).join(&oid[2..]);
    let bytes = std::fs::read(&path).unwrap();
    std::fs::remove_file(path).unwrap();
    bytes
}

#[tokio::test]
async fn invalid_revisions_and_directories_are_errors_instead_of_empty_results() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    assert!(runner
        .file_history(repo.path(), "missing.txt", 0, 20, false, &cancel)
        .await
        .unwrap()
        .commits
        .is_empty());
    for rev in ["missing-revision", "HEAD~10"] {
        assert!(
            runner
                .tree_list(repo.path(), rev, "", &cancel)
                .await
                .is_err(),
            "tree {rev}"
        );
        assert!(
            runner
                .read_blob_at(repo.path(), rev, "README.md", &cancel)
                .await
                .is_err(),
            "blob {rev}"
        );
        assert!(runner
            .blob_read(repo.path(), rev, "README.md", &cancel)
            .await
            .is_err());
        assert!(runner
            .blame_file(repo.path(), "README.md", rev, false, &cancel)
            .await
            .is_err());
    }
    for dir in ["missing-dir", "README.md"] {
        assert!(
            runner
                .tree_list(repo.path(), "HEAD", dir, &cancel)
                .await
                .is_err(),
            "directory {dir}"
        );
    }
}

#[tokio::test]
async fn non_repository_errors_reach_every_history_reader() {
    let directory = tempfile::tempdir().unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = directory.path();
    for all in [false, true] {
        assert!(runner
            .file_history(cwd, "file.txt", 0, 20, all, &cancel)
            .await
            .is_err());
    }
    assert!(runner.tree_list(cwd, "HEAD", "", &cancel).await.is_err());
    assert!(runner
        .blob_read(cwd, "HEAD", "file.txt", &cancel)
        .await
        .is_err());
    assert!(runner
        .blame_file(cwd, "file.txt", "HEAD", false, &cancel)
        .await
        .is_err());
    for side in [DiffSide::Head, DiffSide::Index] {
        assert!(runner
            .read_blob_side(cwd, "file.txt", side, &cancel)
            .await
            .is_err());
    }
}

#[tokio::test]
async fn genuinely_missing_files_remain_absent_for_diff_but_fail_explicit_preview() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for rev in ["HEAD", "INDEX", ":0", "WORKTREE", "EMPTY"] {
        assert!(
            runner
                .read_blob_at(cwd, rev, "missing.txt", &cancel)
                .await
                .unwrap()
                .is_none(),
            "{rev}"
        );
    }
    assert_eq!(
        runner
            .blob_read(cwd, "HEAD", "missing.txt", &cancel)
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    assert!(runner
        .blame_file(cwd, "missing.txt", "HEAD", false, &cancel)
        .await
        .is_err());
    std::fs::write(cwd.join("empty.txt"), []).unwrap();
    git(cwd, &["add", "empty.txt"]);
    git(cwd, &["commit", "-m", "empty file"]);
    assert_eq!(
        runner
            .blob_read(cwd, "HEAD", "empty.txt", &cancel)
            .await
            .unwrap()
            .text
            .as_deref(),
        Some("")
    );
    assert!(runner
        .blame_file(cwd, "empty.txt", "HEAD", false, &cancel)
        .await
        .unwrap()
        .lines
        .is_empty());
}

#[tokio::test]
async fn unborn_head_allows_empty_history_and_new_file_diff() {
    let repo = FixtureBuilder::new().build("empty").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    std::fs::write(cwd.join("new.txt"), "new content\n").unwrap();
    git(cwd, &["add", "new.txt"]);
    for all in [false, true] {
        let history = runner
            .file_history(cwd, "new.txt", 7, 20, all, &cancel)
            .await
            .unwrap();
        assert!(history.commits.is_empty());
        assert_eq!(history.next_offset, 7);
        assert!(!history.truncated);
    }
    assert!(runner
        .read_blob_at(cwd, "HEAD", "new.txt", &cancel)
        .await
        .unwrap()
        .is_none());
    assert!(runner
        .read_blob_side(cwd, "new.txt", DiffSide::Head, &cancel)
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        runner
            .read_blob_at(cwd, "INDEX", "new.txt", &cancel)
            .await
            .unwrap()
            .unwrap(),
        b"new content\n"
    );
    assert!(runner.tree_list(cwd, "HEAD", "", &cancel).await.is_err());
}

#[tokio::test]
async fn corrupt_head_ref_does_not_look_like_an_unborn_repository() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join(".git/refs/heads/main"), "not a valid object id\n").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    assert!(runner
        .file_history(cwd, "README.md", 0, 20, false, &cancel)
        .await
        .is_err());
    assert!(runner
        .read_blob_at(cwd, "HEAD", "README.md", &cancel)
        .await
        .is_err());
    assert!(runner
        .read_blob_side(cwd, "README.md", DiffSide::Head, &cancel)
        .await
        .is_err());
}

#[tokio::test]
async fn missing_commit_object_is_not_empty_history_or_absent_content() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    remove_object(cwd, "HEAD");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for all in [false, true] {
        assert!(runner
            .file_history(cwd, "README.md", 0, 20, all, &cancel)
            .await
            .is_err());
    }
    assert!(runner.tree_list(cwd, "HEAD", "", &cancel).await.is_err());
    assert!(runner
        .read_blob_at(cwd, "HEAD", "README.md", &cancel)
        .await
        .is_err());
}

#[tokio::test]
async fn missing_tree_object_is_not_an_empty_directory_or_deleted_file() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    remove_object(cwd, "HEAD^{tree}");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    assert!(runner.tree_list(cwd, "HEAD", "", &cancel).await.is_err());
    assert!(runner
        .read_blob_at(cwd, "HEAD", "README.md", &cancel)
        .await
        .is_err());
}

#[tokio::test]
async fn missing_blob_is_an_error_and_restoring_the_object_allows_retry() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let oid = git(cwd, &["rev-parse", "HEAD:README.md"]);
    let contents = remove_object(cwd, "HEAD:README.md");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for rev in ["HEAD", "INDEX"] {
        assert!(
            runner
                .read_blob_at(cwd, rev, "README.md", &cancel)
                .await
                .is_err(),
            "{rev}"
        );
    }
    assert!(runner
        .blob_read(cwd, "HEAD", "README.md", &cancel)
        .await
        .is_err());
    assert!(runner
        .blame_file(cwd, "README.md", "HEAD", false, &cancel)
        .await
        .is_err());
    std::fs::write(
        cwd.join(".git/objects").join(&oid[..2]).join(&oid[2..]),
        contents,
    )
    .unwrap();
    assert_eq!(
        runner
            .blob_read(cwd, "HEAD", "README.md", &cancel)
            .await
            .unwrap()
            .text
            .as_deref(),
        Some("# clean\n")
    );
}

#[tokio::test]
async fn corrupt_index_is_not_an_absent_staged_file() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join(".git/index"), "corrupt index").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    assert!(runner
        .read_blob_at(cwd, "INDEX", "README.md", &cancel)
        .await
        .is_err());
    assert!(runner
        .read_blob_side(cwd, "README.md", DiffSide::Index, &cancel)
        .await
        .is_err());
}

#[tokio::test]
async fn conflict_stages_do_not_look_like_a_deleted_index_file() {
    let repo = FixtureBuilder::new().build("merge-conflict").unwrap();
    let cwd = repo.path();
    let output = Command::new("git")
        .current_dir(cwd)
        .args(["merge", "feature"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    assert!(runner
        .read_blob_at(cwd, "INDEX", "file.txt", &cancel)
        .await
        .is_err());
}

#[tokio::test]
async fn cancellation_and_missing_git_remain_errors() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let cancel = CancellationToken::new();
    cancel.cancel();
    let runner = GitRunner::new("git");
    assert_eq!(
        runner
            .file_history(cwd, "README.md", 0, 20, false, &cancel)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Cancelled
    );
    assert_eq!(
        runner
            .tree_list(cwd, "HEAD", "", &cancel)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Cancelled
    );
    assert_eq!(
        runner
            .blob_read(cwd, "HEAD", "README.md", &cancel)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Cancelled
    );
    assert_eq!(
        runner
            .blame_file(cwd, "README.md", "HEAD", false, &cancel)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Cancelled
    );
    let runner = GitRunner::new("gitx-nonexistent-test-binary");
    let cancel = CancellationToken::new();
    assert!(runner
        .file_history(cwd, "README.md", 0, 20, false, &cancel)
        .await
        .is_err());
    assert!(runner
        .read_blob_at(cwd, "HEAD", "README.md", &cancel)
        .await
        .is_err());
}

#[tokio::test]
async fn deleted_and_renamed_files_keep_valid_absent_sides() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    git(cwd, &["mv", "README.md", "renamed.txt"]);
    git(cwd, &["commit", "-m", "rename"]);
    assert!(runner
        .read_blob_at(cwd, "HEAD", "README.md", &cancel)
        .await
        .unwrap()
        .is_none());
    assert!(runner
        .read_blob_at(cwd, "HEAD~1", "renamed.txt", &cancel)
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        runner
            .read_blob_at(cwd, "HEAD~1", "README.md", &cancel)
            .await
            .unwrap(),
        runner
            .read_blob_at(cwd, "HEAD", "renamed.txt", &cancel)
            .await
            .unwrap()
    );
    git(cwd, &["rm", "renamed.txt"]);
    assert!(runner
        .read_blob_at(cwd, "INDEX", "renamed.txt", &cancel)
        .await
        .unwrap()
        .is_none());
    assert!(runner
        .read_blob_at(cwd, "WORKTREE", "renamed.txt", &cancel)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn literal_paths_binary_and_nested_blobs_keep_exact_content() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::create_dir(cwd.join("nested")).unwrap();
    let paths = [
        "[x].txt",
        "x.txt",
        "--option.txt",
        "中文 空格.txt",
        "nested/file.txt",
    ];
    for path in paths {
        std::fs::write(cwd.join(path), path.as_bytes()).unwrap();
    }
    std::fs::write(cwd.join("binary.bin"), [0, 255, 13, 10]).unwrap();
    git(cwd, &["add", "."]);
    git(cwd, &["commit", "-m", "literal files"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for rev in ["HEAD", "INDEX"] {
        for path in paths {
            assert_eq!(
                runner
                    .read_blob_at(cwd, rev, path, &cancel)
                    .await
                    .unwrap()
                    .unwrap(),
                path.as_bytes()
            );
        }
        for absent in ["*.txt", ":(glob)*", "nested/missing.txt"] {
            assert!(
                runner
                    .read_blob_at(cwd, rev, absent, &cancel)
                    .await
                    .unwrap()
                    .is_none(),
                "{rev} {absent}"
            );
        }
        assert_eq!(
            runner
                .read_blob_at(cwd, rev, "binary.bin", &cancel)
                .await
                .unwrap()
                .unwrap(),
            [0, 255, 13, 10]
        );
        let blob = runner
            .blob_read(cwd, rev, "binary.bin", &cancel)
            .await
            .unwrap();
        assert!(blob.binary);
        assert_eq!(blob.size, 4);
        assert!(blob.text.is_none());
    }
    assert!(runner
        .tree_list(cwd, "HEAD", "nested", &cancel)
        .await
        .unwrap()
        .iter()
        .any(|entry| entry.path == "nested/file.txt"));
}

#[tokio::test]
async fn directories_and_gitlinks_are_not_text_or_absent_files() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::create_dir(cwd.join("nested")).unwrap();
    std::fs::write(cwd.join("nested/file.txt"), "child").unwrap();
    git(cwd, &["add", "."]);
    let head = git(cwd, &["rev-parse", "HEAD"]);
    git(
        cwd,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("160000,{head},submodule"),
        ],
    );
    git(cwd, &["commit", "-m", "directory and gitlink"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for rev in ["HEAD", "INDEX"] {
        for path in ["nested", "submodule"] {
            assert!(
                runner.read_blob_at(cwd, rev, path, &cancel).await.is_err(),
                "{rev} {path}"
            );
        }
    }
    assert!(runner
        .read_blob_at(cwd, "WORKTREE", "nested", &cancel)
        .await
        .is_err());
}

#[tokio::test]
async fn valid_empty_tree_and_unborn_head_with_other_refs_remain_usable() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let empty_tree = runner.empty_tree(cwd, &cancel).await.unwrap();
    assert!(runner
        .tree_list(cwd, &empty_tree, "", &cancel)
        .await
        .unwrap()
        .is_empty());
    assert!(runner
        .read_blob_at(cwd, &empty_tree, "missing.txt", &cancel)
        .await
        .unwrap()
        .is_none());
    git(cwd, &["symbolic-ref", "HEAD", "refs/heads/unborn"]);
    assert!(runner
        .file_history(cwd, "README.md", 0, 20, false, &cancel)
        .await
        .unwrap()
        .commits
        .is_empty());
    assert_eq!(
        runner
            .file_history(cwd, "README.md", 0, 20, true, &cancel)
            .await
            .unwrap()
            .commits
            .len(),
        1
    );
    assert!(runner
        .read_blob_at(cwd, "HEAD", "README.md", &cancel)
        .await
        .unwrap()
        .is_none());
    // --all must not hide a broken existing ref just because HEAD is unborn.
    std::fs::write(
        cwd.join(".git/refs/heads/main"),
        format!("{}\n", "1".repeat(40)),
    )
    .unwrap();
    assert!(runner
        .file_history(cwd, "README.md", 0, 20, true, &cancel)
        .await
        .is_err());
}

#[tokio::test]
async fn detached_missing_commit_is_not_unborn() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["checkout", "--detach"]);
    remove_object(cwd, "HEAD");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    assert!(runner
        .read_blob_at(cwd, "HEAD", "README.md", &cancel)
        .await
        .is_err());
    assert!(runner
        .file_history(cwd, "README.md", 0, 20, false, &cancel)
        .await
        .is_err());
}

#[tokio::test]
async fn symlink_blob_is_read_without_following_its_target() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let oid = git(cwd, &["rev-parse", "HEAD:README.md"]);
    git(
        cwd,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("120000,{oid},link"),
        ],
    );
    git(cwd, &["commit", "-m", "symlink"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for rev in ["HEAD", "INDEX"] {
        assert_eq!(
            runner
                .read_blob_at(cwd, rev, "link", &cancel)
                .await
                .unwrap()
                .unwrap(),
            b"# clean\n"
        );
    }
}
