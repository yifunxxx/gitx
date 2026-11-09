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
async fn invalid_or_empty_line_selection_never_removes_or_rewrites_entries() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    fs::write(cwd.join("empty.txt"), "").unwrap();
    fs::write(cwd.join("file.txt"), "new\n").unwrap();
    git(cwd, &["add", "empty.txt", "file.txt"]);
    let index = fs::read(cwd.join(".git/index")).unwrap();
    let runner = GitRunner::new("git");
    for (path, lines) in [
        ("empty.txt", vec![]),
        ("file.txt", vec![0]),
        ("file.txt", vec![1, 999]),
        ("absent.txt", vec![1]),
    ] {
        let result = runner
            .unstage_lines(cwd, path, &lines, &CancellationToken::new())
            .await;
        if !lines.is_empty() {
            assert!(result.is_err(), "{path} {lines:?}");
        }
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    }
}

#[tokio::test]
async fn unstaging_never_runs_clean_filters_on_already_clean_index_content() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    fs::write(cwd.join("file.txt"), "old\nkeep\n").unwrap();
    git(cwd, &["add", "file.txt"]);
    git(cwd, &["commit", "-m", "base"]);
    fs::write(cwd.join("file.txt"), "new\nkeep\n").unwrap();
    git(cwd, &["add", "file.txt"]);
    fs::write(cwd.join(".gitattributes"), "file.txt filter=qa\n").unwrap();
    git(cwd, &["config", "filter.qa.clean", "printf FILTERED; cat"]);
    git(cwd, &["config", "filter.qa.required", "true"]);
    GitRunner::new("git")
        .unstage_lines(cwd, "file.txt", &[1], &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(git(cwd, &["show", ":file.txt"]), b"old\nkeep\n");
    assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), b"new\nkeep\n");
}

#[tokio::test]
async fn binary_and_invalid_utf8_on_either_side_are_rejected_without_changes() {
    for (base, index_text) in [
        (b"old\0binary\n".as_slice(), b"new\n".as_slice()),
        (b"old\xff\n".as_slice(), b"new\n".as_slice()),
        (b"old\n".as_slice(), b"new\xff\n".as_slice()),
        (b"old\n".as_slice(), b"new\0\n".as_slice()),
    ] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]);
        fs::write(cwd.join("file.txt"), base).unwrap();
        git(cwd, &["add", "file.txt"]);
        git(cwd, &["commit", "-m", "base"]);
        fs::write(cwd.join("file.txt"), index_text).unwrap();
        git(cwd, &["add", "file.txt"]);
        let index = fs::read(cwd.join(".git/index")).unwrap();
        assert!(GitRunner::new("git")
            .unstage_lines(cwd, "file.txt", &[1], &CancellationToken::new())
            .await
            .is_err());
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), index_text);
    }
}

#[tokio::test]
async fn unresolved_conflict_cannot_be_resolved_by_unstaging_a_line() {
    let repo = FixtureBuilder::new().build("merge-conflict").unwrap();
    let cwd = repo.path();
    assert!(!Command::new("git")
        .current_dir(cwd)
        .args(["merge", "feature"])
        .output()
        .unwrap()
        .status
        .success());
    let index = fs::read(cwd.join(".git/index")).unwrap();
    let work = fs::read(cwd.join("file.txt")).unwrap();
    assert!(GitRunner::new("git")
        .unstage_lines(cwd, "file.txt", &[1], &CancellationToken::new())
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), work);
}

#[tokio::test]
async fn symlink_entries_and_broken_head_are_not_treated_as_regular_new_files() {
    for broken_head in [false, true] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        fs::write(cwd.join("link.txt"), "new-target").unwrap();
        git(cwd, &["add", "link.txt"]);
        if broken_head {
            fs::write(
                cwd.join(".git/HEAD"),
                "0123456789012345678901234567890123456789\n",
            )
            .unwrap();
        } else {
            let oid = String::from_utf8(git(cwd, &["rev-parse", ":link.txt"])).unwrap();
            git(
                cwd,
                &[
                    "update-index",
                    "--cacheinfo",
                    &format!("120000,{},link.txt", oid.trim()),
                ],
            );
        }
        let index = fs::read(cwd.join(".git/index")).unwrap();
        assert!(GitRunner::new("git")
            .unstage_lines(cwd, "link.txt", &[1], &CancellationToken::new())
            .await
            .is_err());
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(cwd.join("link.txt")).unwrap(), b"new-target");
    }
}

#[tokio::test]
async fn cancellation_and_lock_failures_preserve_index_and_worktree() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    fs::write(cwd.join("file.txt"), "new\nkeep\n").unwrap();
    git(cwd, &["add", "file.txt"]);
    let index = fs::read(cwd.join(".git/index")).unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(runner
        .unstage_lines(cwd, "file.txt", &[1], &cancel)
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    fs::write(cwd.join(".git/index.lock"), "QA lock").unwrap();
    assert!(runner
        .unstage_lines(cwd, "file.txt", &[1], &CancellationToken::new())
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(cwd.join(".git/index.lock")).unwrap(), b"QA lock");
    assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), b"new\nkeep\n");
}

#[tokio::test]
async fn first_commit_partial_and_complete_unstage_preserve_worktree() {
    let repo = tempfile::tempdir().unwrap();
    let cwd = repo.path();
    git(cwd, &["init", "-b", "main"]);
    git(cwd, &["config", "core.autocrlf", "false"]);
    fs::write(cwd.join("new.txt"), "first\nsecond\n").unwrap();
    git(cwd, &["add", "new.txt"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .unstage_lines(cwd, "new.txt", &[1], &cancel)
        .await
        .unwrap();
    assert_eq!(git(cwd, &["show", ":new.txt"]), b"second\n");
    runner
        .unstage_hunks(cwd, "new.txt", &[0], &cancel)
        .await
        .unwrap();
    assert!(git(cwd, &["ls-files", "--stage"]).is_empty());
    assert_eq!(fs::read(cwd.join("new.txt")).unwrap(), b"first\nsecond\n");
    assert_eq!(git(cwd, &["symbolic-ref", "HEAD"]), b"refs/heads/main\n");
}

#[tokio::test]
async fn hunk_unstage_preserves_special_paths_modes_other_entries_and_exact_endings() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let path = "中文,part[1].txt";
    let base = (1..=40)
        .map(|i| format!("line {i}{}", if i < 40 { "\r\n" } else { "" }))
        .collect::<String>();
    fs::write(cwd.join(".gitattributes"), "*.txt -text\n").unwrap();
    fs::write(cwd.join(path), &base).unwrap();
    git(
        cwd,
        &["--literal-pathspecs", "add", "--", path, ".gitattributes"],
    );
    git(
        cwd,
        &[
            "--literal-pathspecs",
            "update-index",
            "--chmod=+x",
            "--",
            path,
        ],
    );
    git(cwd, &["commit", "-m", "byte fixture"]);
    let head = git(cwd, &["rev-parse", "HEAD"]);
    let work = base
        .replacen("line 2\r\n", "early\r\n", 1)
        .replace("line 25\r\n", "later\r\n");
    fs::write(cwd.join(path), &work).unwrap();
    fs::write(cwd.join("other.txt"), "other staged\n").unwrap();
    git(
        cwd,
        &["--literal-pathspecs", "add", "--", path, "other.txt"],
    );
    git(
        cwd,
        &[
            "--literal-pathspecs",
            "update-index",
            "--chmod=+x",
            "--",
            path,
        ],
    );
    let other = git(cwd, &["ls-files", "--stage", "--", "other.txt"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .unstage_hunks(cwd, path, &[0, 0], &cancel)
        .await
        .unwrap();
    assert_eq!(
        git(cwd, &["show", &format!(":{path}")]),
        base.replace("line 25\r\n", "later\r\n").as_bytes()
    );
    assert!(git(
        cwd,
        &["--literal-pathspecs", "ls-files", "--stage", "--", path]
    )
    .starts_with(b"100755 "));
    assert_eq!(fs::read(cwd.join(path)).unwrap(), work.as_bytes());
    assert_eq!(git(cwd, &["ls-files", "--stage", "--", "other.txt"]), other);
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]), head);
    let index = fs::read(cwd.join(".git/index")).unwrap();
    assert!(runner
        .unstage_hunks(cwd, path, &[0, 999], &cancel)
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    runner.unstage_hunks(cwd, path, &[], &cancel).await.unwrap();
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
}

#[tokio::test]
async fn hunk_unstage_restores_staged_deletion_without_creating_worktree_file() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let base = git(cwd, &["show", "HEAD:README.md"]);
    git(cwd, &["rm", "README.md"]);
    GitRunner::new("git")
        .unstage_hunks(cwd, "README.md", &[0], &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(git(cwd, &["show", ":README.md"]), base);
    assert!(!cwd.join("README.md").exists());
}

#[tokio::test]
async fn hunk_unstage_rejects_binary_conflict_and_oversized_entries() {
    for content in [b"binary\0\n".to_vec(), vec![b'x'; 5 * 1024 * 1024 + 1]] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        fs::write(cwd.join("file.txt"), &content).unwrap();
        git(cwd, &["add", "file.txt"]);
        let index = fs::read(cwd.join(".git/index")).unwrap();
        assert!(GitRunner::new("git")
            .unstage_hunks(cwd, "file.txt", &[0], &CancellationToken::new())
            .await
            .is_err());
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), content);
    }
    let repo = FixtureBuilder::new().build("merge-conflict").unwrap();
    let cwd = repo.path();
    assert!(!Command::new("git")
        .current_dir(cwd)
        .args(["merge", "feature"])
        .output()
        .unwrap()
        .status
        .success());
    let index = fs::read(cwd.join(".git/index")).unwrap();
    assert!(GitRunner::new("git")
        .unstage_hunks(cwd, "file.txt", &[0], &CancellationToken::new())
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
}
