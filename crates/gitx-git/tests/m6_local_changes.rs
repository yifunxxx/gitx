//! M6: line stage, changelists, stash, shelf, ignore, partial commit.

use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn line_stage_only_selected_lines() {
    let repo = FixtureBuilder::new().build("clean").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    std::fs::write(
        cwd.join("README.md"),
        "# clean\nline-a\nline-b\nline-c\n",
    )
    .unwrap();

    // Stage only the first added line (new-side line 2 = "line-a").
    // After edit: line1="# clean", line2="line-a", line3="line-b", line4="line-c"
    // Original was "# clean\n" so + lines are 2,3,4.
    runner
        .stage_lines(cwd, "README.md", &[2], &cancel)
        .await
        .expect("stage_lines");

    let cached = std::process::Command::new("git")
        .args(["diff", "--cached", "--", "README.md"])
        .current_dir(cwd)
        .output()
        .unwrap();
    let diff = String::from_utf8_lossy(&cached.stdout);
    assert!(
        diff.contains("line-a"),
        "cached should contain line-a: {diff}"
    );
    assert!(
        !diff.contains("line-b"),
        "cached should not contain line-b yet: {diff}"
    );
}

#[tokio::test]
async fn changelist_create_move_persist() {
    let repo = FixtureBuilder::new().build("dirty").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    let git_dir = runner.git_dir(cwd, &cancel).await.unwrap();

    let state = gitx_meta::create_changelist(&git_dir, "Feature", "wip", true).unwrap();
    assert!(state.lists.iter().any(|l| l.name == "Feature" && l.active));

    let feature_id = state
        .lists
        .iter()
        .find(|l| l.name == "Feature")
        .unwrap()
        .id
        .clone();
    let state = gitx_meta::move_paths(&git_dir, &["README.md".into()], &feature_id).unwrap();
    assert!(
        state
            .assignments
            .iter()
            .any(|a| a.path == "README.md" && a.list_id == feature_id)
    );

    let reloaded = gitx_meta::load_changelists(&git_dir).unwrap();
    assert_eq!(reloaded.lists.len(), 2);
    assert!(
        reloaded
            .assignments
            .iter()
            .any(|a| a.path == "README.md")
    );
}

#[tokio::test]
async fn stash_create_list_pop() {
    let repo = FixtureBuilder::new().build("dirty").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    runner
        .stash_create(cwd, "m6-stash", false, false, None, &cancel)
        .await
        .expect("stash");

    let list = runner.stash_list(cwd, &cancel).await.expect("list");
    assert!(!list.is_empty());
    assert!(list[0].message.contains("m6-stash") || list[0].message.contains("WIP"));

    runner
        .stash_pop(cwd, "stash@{0}", false, &cancel)
        .await
        .expect("pop");

    let status = runner
        .status_get(cwd, &cwd.display().to_string(), 1, &cancel)
        .await
        .unwrap();
    assert!(status.files.iter().any(|f| f.path == "README.md"));
}

#[tokio::test]
async fn shelve_unshelve_roundtrip() {
    let repo = FixtureBuilder::new().build("dirty").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    let entry = runner
        .shelve_changes(
            cwd,
            "m6-shelf",
            &["README.md".into()],
            false,
            None,
            false,
            &cancel,
        )
        .await
        .expect("shelve");

    let status = runner
        .status_get(cwd, &cwd.display().to_string(), 1, &cancel)
        .await
        .unwrap();
    assert!(
        !status
            .files
            .iter()
            .any(|f| f.path == "README.md" && f.worktree_status == "M"),
        "worktree should be clean for README after shelve: {:?}",
        status.files
    );

    // Clean round-trip unshelve.
    let (applied, _failed) = runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .expect("unshelve");
    assert!(!applied.is_empty());
    let text = std::fs::read_to_string(cwd.join("README.md")).unwrap();
    assert!(
        text.contains("modified") || text.contains("dirty"),
        "unshelved content restored: {text}"
    );
}

#[tokio::test]
async fn ignore_add_moves_untracked() {
    let repo = FixtureBuilder::new().build("untracked").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    let pattern = GitRunner::escape_ignore_pattern("new.txt", false);
    let result = runner
        .ignore_add(cwd, &cwd.join(".gitignore"), &[pattern], &cancel)
        .await
        .expect("ignore_add");
    assert!(result.ignore_file.ends_with(".gitignore"));

    let status = runner
        .status_get_with_ignored(cwd, &cwd.display().to_string(), 1, true, &cancel)
        .await
        .unwrap();
    assert!(
        status
            .files
            .iter()
            .any(|f| f.path == "new.txt" && f.kind == gitx_core::FileChangeKind::Ignored)
            || !status.files.iter().any(|f| f.path == "new.txt"),
        "new.txt should be ignored or gone from untracked: {:?}",
        status.files
    );
}

#[tokio::test]
async fn rm_cached_stop_tracking() {
    let repo = FixtureBuilder::new().build("clean").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    runner
        .rm_cached(cwd, &["README.md".into()], &cancel)
        .await
        .expect("rm_cached");

    assert!(cwd.join("README.md").exists());
    let status = runner
        .status_get(cwd, &cwd.display().to_string(), 1, &cancel)
        .await
        .unwrap();
    assert!(
        status
            .files
            .iter()
            .any(|f| f.path == "README.md" && (f.index_status == "D" || f.kind == gitx_core::FileChangeKind::Deleted)),
        "README.md should show as deleted in index: {:?}",
        status.files
    );
}

#[tokio::test]
async fn pathspec_commit_only_selected_file() {
    let repo = FixtureBuilder::new().build("clean").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    std::fs::write(cwd.join("a.txt"), "aaa\n").unwrap();
    std::fs::write(cwd.join("b.txt"), "bbb\n").unwrap();
    std::fs::write(cwd.join("README.md"), "# clean changed\n").unwrap();

    runner
        .commit_create_ex(
            cwd,
            "only a",
            false,
            false,
            Some(&["a.txt".into()]),
            None,
            &cancel,
        )
        .await
        .expect("commit only a");

    let show = std::process::Command::new("git")
        .args(["show", "--name-only", "--pretty=format:", "HEAD"])
        .current_dir(cwd)
        .output()
        .unwrap();
    let names = String::from_utf8_lossy(&show.stdout);
    assert!(names.contains("a.txt"), "commit should include a.txt: {names}");
    assert!(!names.contains("b.txt"), "commit should not include b.txt: {names}");
    assert!(
        !names.contains("README.md"),
        "commit should not include README: {names}"
    );
}
