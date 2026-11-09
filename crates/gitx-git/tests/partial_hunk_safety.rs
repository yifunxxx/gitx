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
async fn empty_or_invalid_hunk_selection_does_not_add_an_untracked_file() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    fs::write(cwd.join("new.txt"), "new\n").unwrap();
    let index = fs::read(cwd.join(".git/index")).unwrap();
    for hunks in [vec![], vec![999], vec![0, 999]] {
        let result = GitRunner::new("git")
            .stage_hunks(cwd, "new.txt", &hunks, &CancellationToken::new())
            .await;
        if !hunks.is_empty() {
            assert!(result.is_err());
        }
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(cwd.join("new.txt")).unwrap(), b"new\n");
    }
}

#[tokio::test]
async fn new_file_filter_runs_once_without_an_intermediate_full_file_add() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    fs::write(cwd.join(".gitattributes"), "new.txt filter=qa\n").unwrap();
    fs::write(cwd.join(".git/qa-clean.sh"), "#!/bin/sh\nif test -f .git/qa-called; then exit 1; fi\nprintf called > .git/qa-called\ncat\n").unwrap();
    git(cwd, &["config", "filter.qa.clean", "sh .git/qa-clean.sh"]);
    git(cwd, &["config", "filter.qa.required", "true"]);
    fs::write(cwd.join("new.txt"), "new\n").unwrap();
    let result = GitRunner::new("git")
        .stage_hunks(cwd, "new.txt", &[0], &CancellationToken::new())
        .await;
    assert!(result.is_ok(), "{result:?}");
    assert_eq!(git(cwd, &["show", ":new.txt"]), b"new\n");
    assert_eq!(fs::read(cwd.join("new.txt")).unwrap(), b"new\n");
}

#[tokio::test]
async fn selected_deletion_removes_index_entry_instead_of_staging_empty_file() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    fs::remove_file(cwd.join("README.md")).unwrap();
    GitRunner::new("git")
        .stage_hunks(cwd, "README.md", &[0], &CancellationToken::new())
        .await
        .unwrap();
    assert!(git(cwd, &["ls-files", "--stage", "--", "README.md"]).is_empty());
    assert!(!cwd.join("README.md").exists());
}

#[tokio::test]
async fn hunk_staging_rejects_binary_invalid_utf8_and_symlink_bases() {
    for (base, work, symlink) in [
        (b"old\0binary\n".as_slice(), b"new\n".as_slice(), false),
        (b"old\xff\n".as_slice(), b"new\n".as_slice(), false),
        (b"old\n".as_slice(), b"new\xff\n".as_slice(), false),
        (b"old-target".as_slice(), b"new-target".as_slice(), true),
    ] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]);
        fs::write(cwd.join("file.txt"), base).unwrap();
        git(cwd, &["add", "file.txt"]);
        if symlink {
            let oid = String::from_utf8(git(cwd, &["rev-parse", ":file.txt"])).unwrap();
            git(
                cwd,
                &[
                    "update-index",
                    "--cacheinfo",
                    &format!("120000,{},file.txt", oid.trim()),
                ],
            );
        }
        fs::write(cwd.join("file.txt"), work).unwrap();
        let index = fs::read(cwd.join(".git/index")).unwrap();
        assert!(GitRunner::new("git")
            .stage_hunks(cwd, "file.txt", &[0], &CancellationToken::new())
            .await
            .is_err());
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), work);
    }
}

#[tokio::test]
async fn hunk_staging_does_not_resolve_conflicts() {
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
        .stage_hunks(cwd, "file.txt", &[0], &CancellationToken::new())
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), work);
}

#[tokio::test]
async fn selected_hunk_preserves_other_changes_crlf_and_unselected_eof() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let base = (1..=40)
        .map(|i| format!("line {i}{}", if i < 40 { "\r\n" } else { "" }))
        .collect::<String>();
    let path = "中文,part[1].txt";
    fs::write(cwd.join(".gitattributes"), "*.txt -text\n").unwrap();
    fs::write(cwd.join(path), &base).unwrap();
    fs::write(cwd.join("other.txt"), "keep staged\n").unwrap();
    git(
        cwd,
        &[
            "--literal-pathspecs",
            "add",
            "--",
            path,
            ".gitattributes",
            "other.txt",
        ],
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
    let head = git(cwd, &["rev-parse", "HEAD"]);
    let other = git(cwd, &["ls-files", "--stage", "--", "other.txt"]);
    let work = base.replacen("line 2\r\n", "selected\r\n", 1) + "\r\n";
    fs::write(cwd.join(path), &work).unwrap();
    GitRunner::new("git")
        .stage_hunks(cwd, path, &[0, 0], &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        git(cwd, &["show", &format!(":{path}")]),
        base.replacen("line 2\r\n", "selected\r\n", 1).as_bytes()
    );
    assert!(git(
        cwd,
        &["--literal-pathspecs", "ls-files", "--stage", "--", path]
    )
    .starts_with(b"100755 "));
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]), head);
    assert_eq!(git(cwd, &["ls-files", "--stage", "--", "other.txt"]), other);
    assert_eq!(fs::read(cwd.join(path)).unwrap(), work.as_bytes());
}

#[tokio::test]
async fn ignored_files_lock_and_filter_failures_never_change_index() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    fs::write(cwd.join(".gitignore"), "ignored.txt\n").unwrap();
    fs::write(cwd.join("ignored.txt"), "ignored\n").unwrap();
    fs::write(cwd.join("new.txt"), "new\n").unwrap();
    fs::write(cwd.join(".gitattributes"), "new.txt filter=qa\n").unwrap();
    git(cwd, &["config", "filter.qa.clean", "exit 1"]);
    git(cwd, &["config", "filter.qa.required", "true"]);
    let index = fs::read(cwd.join(".git/index")).unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for path in ["ignored.txt", "new.txt"] {
        assert!(runner.stage_hunks(cwd, path, &[0], &cancel).await.is_err());
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    }
    fs::write(cwd.join("README.md"), "new readme\n").unwrap();
    fs::write(cwd.join(".git/index.lock"), "QA lock").unwrap();
    assert!(runner
        .stage_hunks(cwd, "README.md", &[0], &cancel)
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(cwd.join(".git/index.lock")).unwrap(), b"QA lock");
    assert_eq!(fs::read(cwd.join("new.txt")).unwrap(), b"new\n");
    assert_eq!(fs::read(cwd.join("README.md")).unwrap(), b"new readme\n");
}

#[tokio::test]
async fn truncating_a_present_file_preserves_an_empty_index_entry() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    fs::write(cwd.join("README.md"), "").unwrap();
    GitRunner::new("git")
        .stage_hunks(cwd, "README.md", &[0], &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(git(cwd, &["show", ":README.md"]), b"");
    assert!(cwd.join("README.md").exists());
    assert!(!git(cwd, &["ls-files", "--stage", "--", "README.md"]).is_empty());
}
