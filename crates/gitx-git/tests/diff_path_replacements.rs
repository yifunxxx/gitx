use gitx_core::ErrorCode;
use gitx_diff::{compute_hunks, decode_lossy, DiffComputeOptions};
use gitx_git::GitRunner;
use gitx_testkit::{FixtureBuilder, FixtureRepo};
use std::path::Path;
use std::process::Command;
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
    String::from_utf8(out.stdout).unwrap().trim().to_string()
}

fn replacements() -> FixtureRepo {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    std::fs::write(cwd.join("replacement"), "old file\n").unwrap();
    std::fs::create_dir(cwd.join("reverse")).unwrap();
    std::fs::write(cwd.join("reverse/old.txt"), "old child\n").unwrap();
    git(cwd, &["add", "."]);
    git(cwd, &["commit", "-m", "before replacements"]);
    std::fs::remove_file(cwd.join("replacement")).unwrap();
    std::fs::create_dir(cwd.join("replacement")).unwrap();
    std::fs::write(cwd.join("replacement/new.txt"), "new child\n").unwrap();
    std::fs::remove_file(cwd.join("reverse/old.txt")).unwrap();
    std::fs::remove_dir(cwd.join("reverse")).unwrap();
    std::fs::write(cwd.join("reverse"), "new file\n").unwrap();
    repo
}

async fn assert_replacements(cwd: &Path, before: &str, after: &str) {
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for (path, old, new) in [
        ("replacement", Some("old file\n"), None),
        ("replacement/new.txt", None, Some("new child\n")),
        ("reverse", None, Some("new file\n")),
        ("reverse/old.txt", Some("old child\n"), None),
    ] {
        let left = runner
            .read_diff_blob_at(cwd, before, path, &cancel)
            .await
            .unwrap_or_else(|error| panic!("{before}:{path}: {error:?}"));
        let right = runner
            .read_diff_blob_at(cwd, after, path, &cancel)
            .await
            .unwrap_or_else(|error| panic!("{after}:{path}: {error:?}"));
        let left_text = decode_lossy(left.as_deref());
        let right_text = decode_lossy(right.as_deref());
        assert_eq!(left_text.as_deref(), old, "{before}:{path}");
        assert_eq!(right_text.as_deref(), new, "{after}:{path}");
        assert!(
            !compute_hunks(
                left_text.as_deref(),
                right_text.as_deref(),
                &DiffComputeOptions::default()
            )
            .is_empty(),
            "{path}"
        );
    }
}

#[tokio::test]
async fn history_replacements_show_additions_and_deletions() {
    let repo = replacements();
    git(repo.path(), &["add", "-A"]);
    git(repo.path(), &["commit", "-m", "replace both ways"]);
    assert_replacements(repo.path(), "HEAD~1", "HEAD").await;
}

#[tokio::test]
async fn staged_replacements_keep_independent_file_and_child_sides() {
    let repo = replacements();
    git(repo.path(), &["add", "-A"]);
    assert_replacements(repo.path(), "HEAD", "INDEX").await;
    assert_replacements(repo.path(), "HEAD", ":0").await;
}

#[tokio::test]
async fn unstaged_replacements_handle_directories_and_file_ancestors() {
    let repo = replacements();
    assert_replacements(repo.path(), "INDEX", "WORKTREE").await;
    assert_replacements(repo.path(), "HEAD", "").await;
}

#[tokio::test]
async fn literal_directory_names_and_neighbouring_files_remain_distinct() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    for dir in ["[x]", "中文 空格"] {
        std::fs::create_dir(cwd.join(dir)).unwrap();
        std::fs::write(cwd.join(dir).join("file.txt"), "child").unwrap();
    }
    std::fs::write(cwd.join("x"), "neighbour").unwrap();
    git(cwd, &["add", "."]);
    git(cwd, &["commit", "-m", "literal directories"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for rev in ["HEAD", "INDEX", "WORKTREE"] {
        for path in ["[x]", "中文 空格", "[x]/missing", "x/missing", "x-prefix"] {
            assert_eq!(
                runner
                    .read_diff_blob_at(cwd, rev, path, &cancel)
                    .await
                    .unwrap(),
                None,
                "{rev}:{path}"
            );
        }
        assert_eq!(
            runner
                .read_diff_blob_at(cwd, rev, "x", &cancel)
                .await
                .unwrap()
                .unwrap(),
            b"neighbour"
        );
        let wildcard = runner.read_diff_blob_at(cwd, rev, "*.txt", &cancel).await;
        if cfg!(windows) && rev == "WORKTREE" {
            // This is an invalid Windows filename, not a missing literal path.
            assert!(wildcard.is_err());
        } else {
            assert_eq!(wildcard.unwrap(), None);
        }
    }
}

#[tokio::test]
async fn missing_objects_are_errors_even_when_a_tree_entry_exists() {
    for object in ["HEAD", "HEAD^{tree}", "HEAD:reverse", "HEAD:replacement"] {
        let repo = replacements();
        let cwd = repo.path();
        let oid = git(cwd, &["rev-parse", object]);
        std::fs::remove_file(cwd.join(".git/objects").join(&oid[..2]).join(&oid[2..])).unwrap();
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let path = if object == "HEAD:reverse" {
            "reverse"
        } else {
            "replacement"
        };
        assert!(
            runner
                .read_diff_blob_at(cwd, "HEAD", path, &cancel)
                .await
                .is_err(),
            "{object}"
        );
        if object == "HEAD:replacement" {
            assert!(runner
                .read_diff_blob_at(cwd, "INDEX", path, &cancel)
                .await
                .is_err());
        }
    }
}

#[tokio::test]
async fn invalid_revisions_corrupt_index_and_cancellation_remain_errors() {
    let repo = replacements();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for rev in ["missing-revision", "HEAD~100"] {
        assert!(runner
            .read_diff_blob_at(cwd, rev, "reverse", &cancel)
            .await
            .is_err());
    }
    std::fs::write(cwd.join(".git/index"), "broken index").unwrap();
    assert!(runner
        .read_diff_blob_at(cwd, "INDEX", "reverse", &cancel)
        .await
        .is_err());
    cancel.cancel();
    for rev in ["HEAD", "INDEX", "WORKTREE"] {
        assert_eq!(
            runner
                .read_diff_blob_at(cwd, rev, "reverse", &cancel)
                .await
                .unwrap_err()
                .code,
            ErrorCode::Cancelled
        );
    }
}

#[tokio::test]
async fn conflicted_index_entries_and_gitlinks_are_not_empty_file_sides() {
    let repo = FixtureBuilder::new().build("merge-conflict").unwrap();
    let cwd = repo.path();
    let out = Command::new("git")
        .current_dir(cwd)
        .args(["merge", "feature"])
        .output()
        .unwrap();
    assert!(!out.status.success());
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    assert!(runner
        .read_diff_blob_at(cwd, "INDEX", "file.txt", &cancel)
        .await
        .is_err());
    git(cwd, &["merge", "--abort"]);
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
    git(cwd, &["commit", "-m", "gitlink"]);
    for rev in ["HEAD", "INDEX"] {
        assert!(
            runner
                .read_diff_blob_at(cwd, rev, "submodule", &cancel)
                .await
                .is_err(),
            "{rev}"
        );
    }
}

#[tokio::test]
async fn unborn_head_and_regular_content_keep_existing_diff_semantics() {
    let repo = FixtureBuilder::new().build("empty").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for (path, contents) in [("empty.txt", &b""[..]), ("binary.bin", &b"\0\xff\r\n"[..])] {
        std::fs::write(cwd.join(path), contents).unwrap();
        git(cwd, &["add", path]);
        for rev in ["HEAD", "EMPTY"] {
            assert_eq!(
                runner
                    .read_diff_blob_at(cwd, rev, path, &cancel)
                    .await
                    .unwrap(),
                None
            );
        }
        for rev in ["INDEX", "WORKTREE"] {
            assert_eq!(
                runner
                    .read_diff_blob_at(cwd, rev, path, &cancel)
                    .await
                    .unwrap()
                    .unwrap(),
                contents
            );
        }
    }
}

#[cfg(windows)]
#[tokio::test]
async fn locked_worktree_files_remain_errors() {
    use std::os::windows::fs::OpenOptionsExt;
    let repo = replacements();
    let cwd = repo.path();
    let _locked = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(cwd.join("reverse"))
        .unwrap();
    assert!(GitRunner::new("git")
        .read_diff_blob_at(cwd, "WORKTREE", "reverse", &CancellationToken::new())
        .await
        .is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn a_symlink_to_a_directory_is_not_classified_as_an_absent_file() {
    let repo = replacements();
    let cwd = repo.path();
    std::os::unix::fs::symlink("replacement", cwd.join("link")).unwrap();
    // Keep the existing worktree symlink error; a link is a Git file entry,
    // even when following its target would find a directory.
    assert!(GitRunner::new("git")
        .read_diff_blob_at(cwd, "WORKTREE", "link", &CancellationToken::new())
        .await
        .is_err());
}
