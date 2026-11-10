use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn compares_initial_commit_and_local_changes_with_an_empty_tree() {
    let repo = FixtureBuilder::new().build("dirty").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    let added = runner
        .diff_refs_name_status(cwd, "EMPTY", "HEAD", &cancel)
        .await
        .expect("initial commit vs empty tree");
    assert!(!added.is_empty());
    assert!(added.iter().all(|file| file.status == "A"));
    let deleted = runner
        .diff_refs_name_status(cwd, "HEAD", "EMPTY", &cancel)
        .await
        .expect("swapped empty tree comparison");
    assert_eq!(added.len(), deleted.len());
    assert!(deleted.iter().all(|file| file.status == "D"));
    assert!(runner
        .read_blob_at(cwd, "EMPTY", &added[0].path, &cancel)
        .await
        .expect("absent file")
        .is_none());
    assert!(runner
        .read_blob_at(cwd, "HEAD", &added[0].path, &cancel)
        .await
        .expect("committed file")
        .is_some());
    let local = runner
        .diff_refs_name_status(cwd, "HEAD", "WORKTREE", &cancel)
        .await
        .expect("local comparison");
    assert!(local.iter().any(|file| file.path == "README.md"));
}

#[tokio::test]
async fn log_changed_files_includes_root_and_only_first_parent_merge_changes() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    let root = runner
        .commit_changed_files(cwd, "HEAD", &cancel)
        .await
        .unwrap();
    assert_eq!(root.len(), 1);
    assert_eq!(root[0].path, "README.md");
    assert_eq!(root[0].status, "A");

    for args in [vec!["branch", "feature"], vec!["checkout", "feature"]] {
        runner
            .run(gitx_git::GitInvocation::new(cwd, args), &cancel)
            .await
            .unwrap();
    }
    std::fs::write(cwd.join("feature.txt"), "feature\n").unwrap();
    runner
        .stage_paths(cwd, &["feature.txt".into()], &cancel)
        .await
        .unwrap();
    runner
        .commit_create(cwd, "feature", false, false, &cancel)
        .await
        .unwrap();
    runner
        .run(
            gitx_git::GitInvocation::new(cwd, ["checkout", "main"]),
            &cancel,
        )
        .await
        .unwrap();
    std::fs::write(cwd.join("main.txt"), "main\n").unwrap();
    runner
        .stage_paths(cwd, &["main.txt".into()], &cancel)
        .await
        .unwrap();
    runner
        .commit_create(cwd, "main", false, false, &cancel)
        .await
        .unwrap();
    runner
        .run(
            gitx_git::GitInvocation::new(
                cwd,
                ["merge", "--no-ff", "-m", "merge feature", "feature"],
            ),
            &cancel,
        )
        .await
        .unwrap();
    let files = runner
        .commit_changed_files(cwd, "HEAD", &cancel)
        .await
        .unwrap();
    assert_eq!(
        files.len(),
        1,
        "first-parent changes must not include main.txt or duplicates"
    );
    assert_eq!(files[0].path, "feature.txt");
    assert_eq!(files[0].status, "A");
}
