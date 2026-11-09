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
async fn invalid_or_empty_selection_does_not_add_an_untracked_file() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let index = fs::read(cwd.join(".git/index")).unwrap();
    fs::write(cwd.join("new.txt"), "first\nsecond\n").unwrap();
    for lines in [vec![], vec![0], vec![1, 999]] {
        let result = runner.stage_lines(cwd, "new.txt", &lines, &cancel).await;
        if !lines.is_empty() {
            assert!(result.is_err());
        }
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(cwd.join("new.txt")).unwrap(), b"first\nsecond\n");
    }
}

#[tokio::test]
async fn partial_new_file_does_not_stage_the_whole_file_before_a_filter_can_fail() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    fs::write(cwd.join(".gitattributes"), "new.txt filter=qa\n").unwrap();
    fs::write(cwd.join(".git/qa-clean.sh"), "#!/bin/sh\nif test -f .git/qa-clean-called; then echo 'second invocation rejected' >&2; exit 1; fi\nprintf called > .git/qa-clean-called\ncat\n").unwrap();
    git(cwd, &["config", "filter.qa.clean", "sh .git/qa-clean.sh"]);
    git(cwd, &["config", "filter.qa.required", "true"]);
    fs::write(cwd.join("new.txt"), "selected\nunselected\n").unwrap();
    let result = GitRunner::new("git")
        .stage_lines(cwd, "new.txt", &[1], &CancellationToken::new())
        .await;
    assert!(
        result.is_ok(),
        "filter must see only the intended new content once: {result:?}"
    );
    assert_eq!(git(cwd, &["show", ":new.txt"]), b"selected\n");
    assert_eq!(
        fs::read(cwd.join("new.txt")).unwrap(),
        b"selected\nunselected\n"
    );
}

#[tokio::test]
async fn binary_or_invalid_utf8_on_either_side_never_rewrites_index_bytes() {
    for (base, work) in [
        (b"old\0binary\n".as_slice(), b"new text\n".as_slice()),
        (b"old\xff\n".as_slice(), b"new text\n".as_slice()),
        (b"old text\n".as_slice(), b"new\xff\n".as_slice()),
    ] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]);
        fs::write(cwd.join("file.txt"), base).unwrap();
        git(cwd, &["add", "file.txt"]);
        let index = fs::read(cwd.join(".git/index")).unwrap();
        fs::write(cwd.join("file.txt"), work).unwrap();
        assert!(GitRunner::new("git")
            .stage_lines(cwd, "file.txt", &[1], &CancellationToken::new())
            .await
            .is_err());
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), work);
    }
}

#[tokio::test]
async fn unresolved_conflicts_are_not_resolved_by_partial_staging() {
    let repo = FixtureBuilder::new().build("merge-conflict").unwrap();
    let cwd = repo.path();
    let merge = Command::new("git")
        .current_dir(cwd)
        .args(["merge", "feature"])
        .output()
        .unwrap();
    assert!(!merge.status.success());
    let index = fs::read(cwd.join(".git/index")).unwrap();
    let bytes = fs::read(cwd.join("file.txt")).unwrap();
    assert!(GitRunner::new("git")
        .stage_lines(cwd, "file.txt", &[1], &CancellationToken::new())
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), bytes);
}

#[tokio::test]
async fn symlink_index_entries_require_whole_file_staging() {
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
    let index = fs::read(cwd.join(".git/index")).unwrap();
    fs::write(cwd.join("link.txt"), "new-target").unwrap();
    assert!(GitRunner::new("git")
        .stage_lines(cwd, "link.txt", &[1], &CancellationToken::new())
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
}

#[tokio::test]
async fn ignored_files_and_index_lock_failures_keep_original_state() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    fs::write(cwd.join(".gitignore"), "new.txt\n").unwrap();
    fs::write(cwd.join("new.txt"), "one\ntwo\n").unwrap();
    let index = fs::read(cwd.join(".git/index")).unwrap();
    assert!(runner
        .stage_lines(cwd, "new.txt", &[1], &cancel)
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    fs::write(cwd.join("README.md"), "changed\n").unwrap();
    fs::write(cwd.join(".git/index.lock"), "QA owns this lock").unwrap();
    assert!(runner
        .stage_lines(cwd, "README.md", &[1], &cancel)
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read(cwd.join(".git/index.lock")).unwrap(),
        b"QA owns this lock"
    );
}

#[tokio::test]
async fn partial_staging_treats_special_filenames_literally_and_preserves_executable_mode() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let path = "中文,part[1].txt";
    fs::write(cwd.join(path), "old\nkeep\n").unwrap();
    git(cwd, &["--literal-pathspecs", "add", "--", path]);
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
    fs::write(cwd.join(path), "new\nkeep\n").unwrap();
    GitRunner::new("git")
        .stage_lines(cwd, path, &[1, 1], &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(git(cwd, &["show", &format!(":{path}")]), b"new\nkeep\n");
    assert!(
        git(cwd, &["--literal-pathspecs", "ls-files", "-s", "--", path]).starts_with(b"100755 ")
    );
}
