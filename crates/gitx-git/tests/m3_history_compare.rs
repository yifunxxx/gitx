//! M3 history / compare integration: file history, blame, diff_refs, tree.

use gitx_core::LogFilters;
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn file_history_blame_diff_refs_and_tree() {
    let repo = FixtureBuilder::new().build("dirty").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    // Commit the dirty README so history has ≥2 commits after another edit.
    runner
        .stage_paths(cwd, &["README.md".into()], &cancel)
        .await
        .expect("stage");
    let c1 = runner
        .commit_create(cwd, "first change", false, false, &cancel)
        .await
        .expect("commit1");

    std::fs::write(cwd.join("README.md"), "line1\nline2\n").expect("write");
    runner
        .stage_paths(cwd, &["README.md".into()], &cancel)
        .await
        .expect("stage2");
    let c2 = runner
        .commit_create(cwd, "second change", false, false, &cancel)
        .await
        .expect("commit2");

    let hist = runner
        .file_history(cwd, "README.md", 0, 20, false, &cancel)
        .await
        .expect("history");
    assert!(
        hist.commits.len() >= 2,
        "expected ≥2 history entries, got {}",
        hist.commits.len()
    );
    assert!(hist.commits.iter().any(|c| c.subject == "second change"));

    let blame = runner
        .blame_file(cwd, "README.md", "HEAD", false, &cancel)
        .await
        .expect("blame");
    assert!(!blame.lines.is_empty());
    assert!(blame.lines.iter().any(|l| !l.sha.is_empty()));

    let files = runner
        .diff_refs_name_status(cwd, &c1.sha, &c2.sha, &cancel)
        .await
        .expect("diff_refs");
    assert!(
        files.iter().any(|f| f.path == "README.md"),
        "expected README.md in diff_refs"
    );

    let tree = runner
        .tree_list(cwd, "HEAD", "", &cancel)
        .await
        .expect("tree");
    assert!(tree.iter().any(|e| e.name == "README.md"));

    let blob = runner
        .blob_read(cwd, "HEAD", "README.md", &cancel)
        .await
        .expect("blob");
    assert!(!blob.binary);
    assert!(blob.text.as_deref().unwrap_or("").contains("line"));

    let (page, _) = runner
        .log_page(
            cwd,
            0,
            50,
            &LogFilters {
                text: Some("second".into()),
                ..Default::default()
            },
            &cancel,
        )
        .await
        .expect("filtered log");
    assert!(page.iter().any(|c| c.subject.contains("second")));
}
