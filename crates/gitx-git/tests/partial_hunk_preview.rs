use gitx_core::DiffHunk;
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::{fs, path::Path, process::Command};
use tokio_util::sync::CancellationToken;

fn git(cwd: &Path, args: &[&str]) -> Vec<u8> {
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
    output.stdout
}
fn preview(base: &str, work: &str) -> Vec<DiffHunk> {
    gitx_diff::compute_hunks(Some(base), Some(work), &Default::default())
}
fn base() -> String {
    (1..=30)
        .map(|n| format!("line {n}\r\n"))
        .collect::<String>()
        .trim_end()
        .to_string()
}
fn tracked(cwd: &Path, path: &str, content: &str) {
    git(cwd, &["config", "core.autocrlf", "false"]);
    if let Some(parent) = cwd.join(path).parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(cwd.join(path), content).unwrap();
    git(cwd, &["--literal-pathspecs", "add", "--", path]);
    git(cwd, &["commit", "-m", "text baseline"]);
}

#[tokio::test]
async fn unchecked_legacy_index_accepts_new_content_at_the_same_number() {
    // Controlled reproduction of the old contract; the reviewed API below must reject this.
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    tracked(cwd, "file.txt", "old\n");
    let old_preview = preview("old\n", "reviewed\n");
    fs::write(cwd.join("file.txt"), "unreviewed\n").unwrap();
    GitRunner::new("git")
        .stage_hunks(
            cwd,
            "file.txt",
            &[old_preview[0].index],
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(git(cwd, &["show", ":file.txt"]), b"unreviewed\n");
}

#[tokio::test]
async fn checked_stage_rejects_changed_worktree_or_index_even_when_indexes_still_exist() {
    for changed_side in ["worktree", "index"] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        tracked(cwd, "file.txt", "old\n");
        let expected = preview("old\n", "reviewed\n");
        fs::write(cwd.join("file.txt"), "external edit\n").unwrap();
        if changed_side == "index" {
            git(cwd, &["add", "file.txt"]);
            fs::write(cwd.join("file.txt"), "reviewed\n").unwrap();
        }
        let index = fs::read(cwd.join(".git/index")).unwrap();
        let work = fs::read(cwd.join("file.txt")).unwrap();
        let err = GitRunner::new("git")
            .stage_hunks_checked(
                cwd,
                "file.txt",
                &[0],
                Some(&expected),
                &CancellationToken::new(),
            )
            .await
            .unwrap_err();
        assert!(err.message.contains("changed since preview"));
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), work);
    }
}

#[tokio::test]
async fn checked_unstage_rejects_changed_index_or_head_and_preserves_worktree() {
    for changed_side in ["index", "head"] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        tracked(cwd, "file.txt", "old\n");
        let expected = preview("old\n", "reviewed\n");
        fs::write(cwd.join("file.txt"), "external edit\n").unwrap();
        git(cwd, &["add", "file.txt"]);
        if changed_side == "head" {
            git(cwd, &["commit", "-m", "external commit"]);
            fs::write(cwd.join("file.txt"), "reviewed\n").unwrap();
            git(cwd, &["add", "file.txt"]);
        }
        fs::write(cwd.join("file.txt"), "independent local changes\n").unwrap();
        let index = fs::read(cwd.join(".git/index")).unwrap();
        let err = GitRunner::new("git")
            .unstage_hunks_checked(
                cwd,
                "file.txt",
                &[0],
                Some(&expected),
                &CancellationToken::new(),
            )
            .await
            .unwrap_err();
        assert!(err.message.contains("changed since preview"));
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(cwd.join("file.txt")).unwrap(),
            b"independent local changes\n"
        );
    }
}

#[tokio::test]
async fn checked_stage_and_unstage_keep_other_blocks_crlf_and_missing_final_newline() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let path = "中文,part[1].txt";
    let base = base();
    let first = base.replace("line 2\r", "FIRST\r");
    let both = first.replace("line 28\r", "LAST\r");
    tracked(cwd, path, &base);
    fs::write(cwd.join(path), &both).unwrap();
    let expected = preview(&base, &both);
    assert_eq!(expected.len(), 2);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .stage_hunks_checked(cwd, path, &[0], Some(&expected), &cancel)
        .await
        .unwrap();
    assert_eq!(git(cwd, &["show", &format!(":{path}")]), first.as_bytes());
    assert_eq!(fs::read(cwd.join(path)).unwrap(), both.as_bytes());
    git(cwd, &["--literal-pathspecs", "add", "--", path]);
    runner
        .unstage_hunks_checked(cwd, path, &[1], Some(&expected), &cancel)
        .await
        .unwrap();
    assert_eq!(git(cwd, &["show", &format!(":{path}")]), first.as_bytes());
    assert_eq!(fs::read(cwd.join(path)).unwrap(), both.as_bytes());
}

#[tokio::test]
async fn rollback_one_block_keeps_staged_and_other_local_changes_byte_for_byte() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let base = base();
    tracked(cwd, "file.txt", &base);
    let staged = base.replace("line 15\r", "STAGED\r");
    let work = staged
        .replace("line 2\r", "FIRST\r")
        .replace("line 28\r", "LAST\r");
    fs::write(cwd.join("file.txt"), &staged).unwrap();
    git(cwd, &["add", "file.txt"]);
    fs::write(cwd.join("file.txt"), &work).unwrap();
    let index = fs::read(cwd.join(".git/index")).unwrap();
    let refs = git(cwd, &["show-ref"]);
    let expected = preview(&staged, &work);
    assert_eq!(expected.len(), 2);
    GitRunner::new("git")
        .revert_hunks(cwd, "file.txt", &[0], &expected, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        fs::read(cwd.join("file.txt")).unwrap(),
        staged.replace("line 28\r", "LAST\r").as_bytes()
    );
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(git(cwd, &["show-ref"]), refs);
}

#[tokio::test]
async fn rollback_pure_deletion_preserves_other_edits() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let base = base();
    tracked(cwd, "file.txt", &base);
    let work = base
        .replace("line 2\r\n", "")
        .replace("line 28\r", "LAST\r");
    let expected = preview(&base, &work);
    assert_eq!(expected.len(), 2);
    fs::write(cwd.join("file.txt"), &work).unwrap();
    GitRunner::new("git")
        .revert_hunks(cwd, "file.txt", &[0], &expected, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        fs::read(cwd.join("file.txt")).unwrap(),
        base.replace("line 28\r", "LAST\r").as_bytes()
    );
}

#[tokio::test]
async fn rollback_deleted_file_restores_missing_parents_and_keeps_index() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let path = "nested/deeper/file.txt";
    tracked(cwd, path, "original\r\nend");
    fs::remove_file(cwd.join(path)).unwrap();
    fs::remove_dir(cwd.join("nested/deeper")).unwrap();
    fs::remove_dir(cwd.join("nested")).unwrap();
    let index = fs::read(cwd.join(".git/index")).unwrap();
    GitRunner::new("git")
        .revert_hunks(
            cwd,
            path,
            &[0],
            &preview("original\r\nend", ""),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(fs::read(cwd.join(path)).unwrap(), b"original\r\nend");
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read_dir(cwd.join("nested/deeper")).unwrap().count(), 1);
}

#[tokio::test]
async fn rollback_new_file_restores_absence_even_when_path_exists_in_head() {
    for existing_head in [false, true] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        if existing_head {
            tracked(cwd, "file.txt", "head\n");
            git(cwd, &["rm", "--cached", "file.txt"]);
        }
        fs::write(cwd.join("file.txt"), "new work\r\n").unwrap();
        let index = fs::read(cwd.join(".git/index")).unwrap();
        GitRunner::new("git")
            .revert_hunks(
                cwd,
                "file.txt",
                &[0],
                &preview("", "new work\r\n"),
                &CancellationToken::new(),
            )
            .await
            .unwrap();
        assert!(!cwd.join("file.txt").exists());
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    }
}

#[tokio::test]
async fn stale_rollback_preview_never_writes_worktree_or_index() {
    for side in ["worktree", "index"] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        tracked(cwd, "file.txt", "old\n");
        let expected = preview("old\n", "reviewed\n");
        fs::write(cwd.join("file.txt"), "later\n").unwrap();
        if side == "index" {
            git(cwd, &["add", "file.txt"]);
            fs::write(cwd.join("file.txt"), "reviewed\n").unwrap();
        }
        let work = fs::read(cwd.join("file.txt")).unwrap();
        let index = fs::read(cwd.join(".git/index")).unwrap();
        let err = GitRunner::new("git")
            .revert_hunks(cwd, "file.txt", &[0], &expected, &CancellationToken::new())
            .await
            .unwrap_err();
        assert!(err.message.contains("changed since preview"));
        assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), work);
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    }
}

#[tokio::test]
async fn invalid_cancelled_and_readonly_rollbacks_do_not_leave_temporary_files() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    tracked(cwd, "file.txt", "old\n");
    fs::write(cwd.join("file.txt"), "work\n").unwrap();
    let expected = preview("old\n", "work\n");
    let runner = GitRunner::new("git");
    let count = fs::read_dir(cwd).unwrap().count();
    for path in ["../file.txt", "C:/file.txt", ""] {
        assert!(runner
            .revert_hunks(cwd, path, &[0], &expected, &CancellationToken::new())
            .await
            .is_err());
    }
    assert!(runner
        .revert_hunks(
            cwd,
            "file.txt",
            &[0, 99],
            &expected,
            &CancellationToken::new()
        )
        .await
        .is_err());
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(runner
        .revert_hunks(cwd, "file.txt", &[0], &expected, &cancel)
        .await
        .is_err());
    let original = fs::metadata(cwd.join("file.txt")).unwrap().permissions();
    let mut readonly = original.clone();
    readonly.set_readonly(true);
    fs::set_permissions(cwd.join("file.txt"), readonly).unwrap();
    let result = runner
        .revert_hunks(cwd, "file.txt", &[0], &expected, &CancellationToken::new())
        .await;
    fs::set_permissions(cwd.join("file.txt"), original).unwrap();
    assert!(result.is_err());
    assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), b"work\n");
    assert_eq!(fs::read_dir(cwd).unwrap().count(), count);
}

#[tokio::test]
async fn conflicts_binary_directory_and_link_entries_are_rejected() {
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let expected = preview("old\n", "work\n");
    let repo = FixtureBuilder::new().build("merge-conflict").unwrap();
    let cwd = repo.path();
    assert!(!Command::new("git")
        .current_dir(cwd)
        .args(["merge", "feature"])
        .output()
        .unwrap()
        .status
        .success());
    let original = fs::read(cwd.join("file.txt")).unwrap();
    assert!(runner
        .revert_hunks(cwd, "file.txt", &[0], &expected, &cancel)
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), original);
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    tracked(cwd, "file.txt", "old\n");
    for bytes in [b"work\0\n".as_slice(), b"work\xff\n".as_slice()] {
        fs::write(cwd.join("file.txt"), bytes).unwrap();
        assert!(runner
            .revert_hunks(cwd, "file.txt", &[0], &expected, &cancel)
            .await
            .is_err());
        assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), bytes);
    }
    fs::remove_file(cwd.join("file.txt")).unwrap();
    fs::create_dir(cwd.join("file.txt")).unwrap();
    assert!(runner
        .revert_hunks(cwd, "file.txt", &[0], &expected, &cancel)
        .await
        .is_err());
    fs::remove_dir(cwd.join("file.txt")).unwrap();
    let oid = String::from_utf8(git(cwd, &["rev-parse", ":file.txt"])).unwrap();
    git(
        cwd,
        &[
            "update-index",
            "--cacheinfo",
            &format!("120000,{},file.txt", oid.trim()),
        ],
    );
    fs::write(cwd.join("file.txt"), "work\n").unwrap();
    assert!(runner
        .revert_hunks(cwd, "file.txt", &[0], &expected, &cancel)
        .await
        .is_err());
    assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), b"work\n");
}
