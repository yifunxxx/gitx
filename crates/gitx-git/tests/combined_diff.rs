use gitx_core::{ErrorCode, IgnoreWhitespace};
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
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

fn changed_files() -> FixtureRepo {
    let repo = FixtureBuilder::new().build("empty").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    for path in ["a.txt", "z broken [中文].txt"] {
        std::fs::write(cwd.join(path), format!("old {path}\n")).unwrap();
    }
    git(cwd, &["add", "."]);
    git(cwd, &["commit", "-m", "base"]);
    for path in ["a.txt", "z broken [中文].txt"] {
        std::fs::write(cwd.join(path), format!("new {path}\n")).unwrap();
    }
    git(cwd, &["add", "."]);
    git(cwd, &["commit", "-m", "destination"]);
    repo
}

async fn missing_blob_fails(rev: &str) {
    let repo = changed_files();
    let cwd = repo.path();
    let spec = format!("{rev}:z broken [中文].txt");
    let oid = git(cwd, &["rev-parse", &spec]);
    let object = cwd.join(".git/objects").join(&oid[..2]).join(&oid[2..]);
    let saved = std::fs::read(&object).unwrap();
    std::fs::remove_file(&object).unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    // The names are readable; failure occurs only when reading the second
    // file's content, after a complete first file was already collected.
    assert_eq!(
        runner
            .diff_refs_name_status(cwd, "HEAD~1", "HEAD", &cancel)
            .await
            .unwrap()
            .len(),
        2
    );
    let error = runner
        .combined_diff(cwd, "HEAD", "HEAD~1", IgnoreWhitespace::None, 50, &cancel)
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::GitCommandFailed);
    assert!(error.message.contains("z broken [中文].txt"));
    assert!(error.message.contains(rev));
    assert!(error.command.as_deref().unwrap_or("").contains("cat-file"));
    assert!(error.git_stderr.is_some());
    assert_eq!(error.exit_code, Some(128));
    std::fs::write(object, saved).unwrap();
    let retried = runner
        .combined_diff(cwd, "HEAD", "HEAD~1", IgnoreWhitespace::None, 50, &cancel)
        .await
        .unwrap();
    assert_eq!(retried.files.len(), 2);
    for file in retried.files {
        assert_eq!(file.status, "M");
        assert!(file
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .any(|l| l.starts_with('+')));
        assert!(file
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .any(|l| l.starts_with('-')));
    }
}

#[tokio::test]
async fn missing_destination_blob_is_an_error_and_can_be_retried() {
    missing_blob_fails("HEAD").await;
}

#[tokio::test]
async fn missing_base_blob_is_an_error_and_can_be_retried() {
    missing_blob_fails("HEAD~1").await;
}

#[cfg(windows)]
#[tokio::test]
async fn locked_local_file_does_not_become_a_deletion() {
    use std::os::windows::fs::OpenOptionsExt;
    let repo = changed_files();
    let cwd = repo.path();
    std::fs::write(cwd.join("a.txt"), "local edit\n").unwrap();
    let locked = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(cwd.join("a.txt"))
        .unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    assert!(runner
        .combined_diff(cwd, "WORKTREE", "HEAD", IgnoreWhitespace::None, 50, &cancel)
        .await
        .is_err());
    drop(locked);
    let result = runner
        .combined_diff(cwd, "WORKTREE", "HEAD", IgnoreWhitespace::None, 50, &cancel)
        .await
        .unwrap();
    assert_eq!(result.files.len(), 1);
    assert_eq!(result.files[0].status, "M");
    assert!(result.files[0]
        .hunks
        .iter()
        .flat_map(|h| &h.lines)
        .any(|l| l.contains("local edit")));
}

#[tokio::test]
async fn file_directory_replacements_keep_addition_and_deletion_contents() {
    let repo = changed_files();
    let cwd = repo.path();
    std::fs::remove_file(cwd.join("a.txt")).unwrap();
    std::fs::create_dir(cwd.join("a.txt")).unwrap();
    std::fs::write(cwd.join("a.txt/child"), "child content\n").unwrap();
    git(cwd, &["add", "-A"]);
    git(cwd, &["commit", "-m", "file to directory"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for (destination, base) in [("HEAD", "HEAD~1"), ("HEAD~1", "HEAD")] {
        let result = runner
            .combined_diff(cwd, destination, base, IgnoreWhitespace::None, 50, &cancel)
            .await
            .unwrap();
        assert_eq!(result.files.len(), 2);
        assert_eq!(result.left, destination);
        assert_eq!(result.right, base);
        for file in result.files {
            let expected = if file.status == "A" { '+' } else { '-' };
            assert!(file
                .hunks
                .iter()
                .flat_map(|h| &h.lines)
                .all(|l| l.starts_with(expected)));
            assert_eq!(file.hunks.iter().flat_map(|h| &h.lines).count(), 1);
        }
    }
}

#[tokio::test]
async fn normal_rename_add_delete_and_binary_files_keep_their_metadata() {
    let repo = changed_files();
    let cwd = repo.path();
    git(cwd, &["mv", "a.txt", "renamed.txt"]);
    git(cwd, &["rm", "z broken [中文].txt"]);
    std::fs::write(cwd.join("added.txt"), "independent addition\n").unwrap();
    std::fs::write(cwd.join("binary.bin"), [0, 255, 10]).unwrap();
    git(cwd, &["add", "."]);
    git(cwd, &["commit", "-m", "mixed changes"]);
    let result = GitRunner::new("git")
        .combined_diff(
            cwd,
            "HEAD",
            "HEAD~1",
            IgnoreWhitespace::None,
            50,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.files.len(), 4);
    let renamed = result
        .files
        .iter()
        .find(|f| f.path == "renamed.txt")
        .unwrap();
    assert_eq!(renamed.orig_path.as_deref(), Some("a.txt"));
    assert!(renamed.hunks.is_empty());
    let binary = result
        .files
        .iter()
        .find(|f| f.path == "binary.bin")
        .unwrap();
    assert!(binary.binary);
    assert!(binary.hunks.is_empty());
    for path in ["added.txt", "z broken [中文].txt"] {
        assert!(!result
            .files
            .iter()
            .find(|f| f.path == path)
            .unwrap()
            .hunks
            .is_empty());
    }
}

#[tokio::test]
async fn empty_base_limits_and_cancelled_or_invalid_requests_keep_their_contract() {
    let repo = changed_files();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = runner
        .combined_diff(cwd, "HEAD", "EMPTY", IgnoreWhitespace::None, 50, &cancel)
        .await
        .unwrap();
    assert_eq!(result.files.len(), 2);
    assert!(result
        .files
        .iter()
        .all(|f| f.status == "A" && !f.hunks.is_empty()));
    let limited = runner
        .combined_diff(cwd, "HEAD", "HEAD~1", IgnoreWhitespace::None, 1, &cancel)
        .await
        .unwrap();
    assert_eq!(limited.files.len(), 1);
    assert!(runner
        .combined_diff(
            cwd,
            "missing-revision",
            "HEAD",
            IgnoreWhitespace::None,
            50,
            &cancel
        )
        .await
        .is_err());
    cancel.cancel();
    assert_eq!(
        runner
            .combined_diff(cwd, "HEAD", "HEAD~1", IgnoreWhitespace::None, 50, &cancel)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Cancelled
    );
}
