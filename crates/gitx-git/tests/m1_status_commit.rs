//! M1 vertical-slice integration: status → stage → commit → log.

use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn dirty_stage_commit_appears_in_log() {
    let repo = FixtureBuilder::new().build("dirty").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    let status = runner
        .status_get(cwd, &cwd.display().to_string(), 1, &cancel)
        .await
        .expect("status");
    assert!(
        status
            .files
            .iter()
            .any(|f| f.path == "README.md" && f.worktree_status == "M"),
        "expected modified README.md, got {:?}",
        status.files
    );

    runner
        .stage_paths(cwd, &["README.md".into()], &cancel)
        .await
        .expect("stage");

    let status2 = runner
        .status_get(cwd, &cwd.display().to_string(), 2, &cancel)
        .await
        .expect("status after stage");
    assert!(
        status2
            .files
            .iter()
            .any(|f| f.path == "README.md" && f.index_status == "M"),
        "expected staged README.md"
    );

    let result = runner
        .commit_create(cwd, "update readme", false, false, &cancel)
        .await
        .expect("commit");
    assert_eq!(result.subject, "update readme");
    assert!(!result.sha.is_empty());

    let (commits, _) = runner
        .log_page(cwd, 0, 10, &gitx_core::LogFilters::default(), &cancel)
        .await
        .expect("log");
    assert!(commits.iter().any(|c| c.subject == "update readme"));
}
