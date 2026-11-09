use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::{fs, path::Path, process::Command};
use tokio_util::sync::CancellationToken;

fn git(cwd: &Path, args: &[&str]) -> Vec<u8> {
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
    out.stdout
}

#[tokio::test]
async fn empty_or_invalid_selection_does_not_create_or_rewrite_worktree_files() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .revert_lines(cwd, "absent.txt", &[], &cancel)
        .await
        .unwrap();
    assert!(!cwd.join("absent.txt").exists());
    fs::write(cwd.join("new.txt"), "new\n").unwrap();
    for lines in [vec![0], vec![1, 999]] {
        assert!(runner
            .revert_lines(cwd, "new.txt", &lines, &cancel)
            .await
            .is_err());
        assert_eq!(fs::read(cwd.join("new.txt")).unwrap(), b"new\n");
    }
}

#[tokio::test]
async fn nontext_bytes_on_either_side_are_never_decoded_and_overwritten() {
    for (base, work) in [
        (b"old\xff\n".as_slice(), b"new\n".as_slice()),
        (b"old\n".as_slice(), b"new\xff\n".as_slice()),
        (b"old\0\n".as_slice(), b"new\n".as_slice()),
        (b"old\n".as_slice(), b"new\0\n".as_slice()),
    ] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]);
        fs::write(cwd.join("file.txt"), base).unwrap();
        git(cwd, &["add", "file.txt"]);
        fs::write(cwd.join("file.txt"), work).unwrap();
        let index = fs::read(cwd.join(".git/index")).unwrap();
        assert!(GitRunner::new("git")
            .revert_lines(cwd, "file.txt", &[1], &CancellationToken::new())
            .await
            .is_err());
        assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), work);
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    }
}

#[tokio::test]
async fn unresolved_conflicts_and_symlink_entries_are_not_written() {
    let repo = FixtureBuilder::new().build("merge-conflict").unwrap();
    let cwd = repo.path();
    assert!(!Command::new("git")
        .current_dir(cwd)
        .args(["merge", "feature"])
        .output()
        .unwrap()
        .status
        .success());
    let work = fs::read(cwd.join("file.txt")).unwrap();
    let index = fs::read(cwd.join(".git/index")).unwrap();
    assert!(GitRunner::new("git")
        .revert_lines(cwd, "file.txt", &[1], &CancellationToken::new())
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), work);
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    fs::write(cwd.join("link.txt"), "old-target").unwrap();
    git(cwd, &["add", "link.txt"]);
    let oid = String::from_utf8(git(cwd, &["rev-parse", ":link.txt"])).unwrap();
    git(
        cwd,
        &[
            "update-index",
            "--cacheinfo",
            &format!("120000,{},link.txt", oid.trim()),
        ],
    );
    fs::write(cwd.join("link.txt"), "new-target").unwrap();
    assert!(GitRunner::new("git")
        .revert_lines(cwd, "link.txt", &[1], &CancellationToken::new())
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join("link.txt")).unwrap(), b"new-target");
}

#[tokio::test]
async fn oversized_worktree_is_not_rewritten() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let work = vec![b'x'; 5 * 1024 * 1024 + 1];
    fs::write(cwd.join("large.txt"), &work).unwrap();
    assert!(GitRunner::new("git")
        .revert_lines(cwd, "large.txt", &[1], &CancellationToken::new())
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join("large.txt")).unwrap(), work);
}

#[tokio::test]
async fn selected_revert_preserves_unselected_bytes_index_and_refs() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let path = "中文,part[1].txt";
    fs::write(cwd.join(".gitattributes"), "*.txt -text\n").unwrap();
    fs::write(cwd.join(path), "before\r\nold1\r\nold2\r\nafter").unwrap();
    git(
        cwd,
        &["--literal-pathspecs", "add", "--", ".gitattributes", path],
    );
    fs::write(cwd.join(path), "before\r\nnew1\r\nnew2\r\nafter").unwrap();
    let index = fs::read(cwd.join(".git/index")).unwrap();
    let refs = git(cwd, &["show-ref"]);
    GitRunner::new("git")
        .revert_lines(cwd, path, &[2], &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        fs::read(cwd.join(path)).unwrap(),
        b"before\r\nold1\r\nnew2\r\nafter"
    );
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(git(cwd, &["show-ref"]), refs);
}

#[tokio::test]
async fn cancelled_and_readonly_rollbacks_preserve_files_and_leave_no_temporary_files() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    fs::write(cwd.join("README.md"), "changed\n").unwrap();
    let list = || {
        let mut paths = fs::read_dir(cwd)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        paths.sort();
        paths
    };
    let before = list();
    let cancel = CancellationToken::new();
    cancel.cancel();
    let runner = GitRunner::new("git");
    assert!(runner
        .revert_lines(cwd, "README.md", &[1], &cancel)
        .await
        .is_err());
    let original_permissions = fs::metadata(cwd.join("README.md")).unwrap().permissions();
    let mut readonly = original_permissions.clone();
    readonly.set_readonly(true);
    fs::set_permissions(cwd.join("README.md"), readonly).unwrap();
    let result = runner
        .revert_lines(cwd, "README.md", &[1], &CancellationToken::new())
        .await;
    fs::set_permissions(cwd.join("README.md"), original_permissions).unwrap();
    assert!(result.is_err());
    assert_eq!(fs::read(cwd.join("README.md")).unwrap(), b"changed\n");
    assert_eq!(list(), before);
    runner
        .revert_lines(cwd, "README.md", &[1], &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        fs::read(cwd.join("README.md")).unwrap(),
        git(cwd, &["show", ":README.md"])
    );
    assert_eq!(list(), before);
}

#[tokio::test]
async fn untracked_and_staged_deleted_paths_use_the_correct_base() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    fs::write(cwd.join("new.txt"), "selected\r\nkeep").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let index = fs::read(cwd.join(".git/index")).unwrap();
    runner
        .revert_lines(cwd, "new.txt", &[1], &cancel)
        .await
        .unwrap();
    assert_eq!(fs::read(cwd.join("new.txt")).unwrap(), b"keep");
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    git(cwd, &["rm", "--cached", "README.md"]);
    fs::write(cwd.join("README.md"), "changed\n").unwrap();
    let index = fs::read(cwd.join(".git/index")).unwrap();
    runner
        .revert_lines(cwd, "README.md", &[1], &cancel)
        .await
        .unwrap();
    assert_eq!(
        fs::read(cwd.join("README.md")).unwrap(),
        git(cwd, &["show", "HEAD:README.md"])
    );
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
}

#[tokio::test]
async fn first_commit_untracked_rollback_preserves_missing_index_and_other_content() {
    let repo = tempfile::tempdir().unwrap();
    let cwd = repo.path();
    git(cwd, &["init", "-b", "main"]);
    fs::write(cwd.join("new.txt"), "selected\nkeep\n").unwrap();
    GitRunner::new("git")
        .revert_lines(cwd, "new.txt", &[1], &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(fs::read(cwd.join("new.txt")).unwrap(), b"keep\n");
    assert!(!cwd.join(".git/index").exists());
}

#[tokio::test]
async fn paths_outside_repository_and_broken_head_are_rejected() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    fs::write(cwd.join("new.txt"), "new\n").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for path in ["../outside.txt", "C:/outside.txt", ""] {
        assert!(runner.revert_lines(cwd, path, &[1], &cancel).await.is_err());
    }
    fs::write(
        cwd.join(".git/HEAD"),
        "0123456789012345678901234567890123456789\n",
    )
    .unwrap();
    assert!(runner
        .revert_lines(cwd, "new.txt", &[1], &cancel)
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join("new.txt")).unwrap(), b"new\n");
}
