use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::{path::Path, process::Command};
use tokio_util::sync::CancellationToken;

fn git(path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[tokio::test]
async fn listing_recognizes_main_and_linked_worktrees_with_unicode_and_space_paths() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let parent = tempfile::tempdir().unwrap();
    let linked = parent.path().join("中文 review 工作树");
    git(
        repo.path(),
        &[
            "worktree",
            "add",
            "-b",
            "qa/listing",
            linked.to_str().unwrap(),
        ],
    );
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for (current, branch, is_main) in [
        (repo.path(), "main", true),
        (linked.as_path(), "qa/listing", false),
    ] {
        let canonical = current.canonicalize().unwrap();
        let list = runner
            .worktree_list(current, Some(&canonical.to_string_lossy()), &cancel)
            .await
            .unwrap();
        assert_eq!(list.len(), 2);
        let selected: Vec<_> = list.iter().filter(|entry| entry.is_current).collect();
        assert_eq!(selected.len(), 1, "{list:?}");
        assert_eq!(selected[0].branch.as_deref(), Some(branch));
        assert_eq!(selected[0].is_main, is_main);
        assert_eq!(
            Path::new(&selected[0].path).canonicalize().unwrap(),
            canonical
        );
    }
}

#[tokio::test]
async fn listing_preserves_quoted_multiline_lock_reasons() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let parent = tempfile::tempdir().unwrap();
    let linked = parent.path().join("locked");
    git(
        repo.path(),
        &["worktree", "add", "--detach", linked.to_str().unwrap()],
    );
    let reason = "中文锁定\t第一行\n\"第二行\"\\尾部  ";
    git(
        repo.path(),
        &[
            "worktree",
            "lock",
            "--reason",
            reason,
            linked.to_str().unwrap(),
        ],
    );
    let list = GitRunner::new("git")
        .worktree_list(repo.path(), None, &CancellationToken::new())
        .await
        .unwrap();
    let entry = list.iter().find(|entry| entry.locked).unwrap();
    // Git itself strips trailing whitespace from the stored lock reason.
    assert_eq!(entry.lock_reason.as_deref(), Some(reason.trim_end()));
    assert!(entry.detached);
    assert!(entry.branch.is_none());
}
