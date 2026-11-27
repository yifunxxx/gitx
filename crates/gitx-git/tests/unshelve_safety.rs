use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use tokio_util::sync::CancellationToken;

async fn git_text(runner: &GitRunner, cwd: &std::path::Path, args: &[&str]) -> String {
    let output = runner
        .run(
            gitx_git::GitInvocation::new(cwd, args.iter().copied()),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    String::from_utf8(output.stdout).unwrap()
}

// Capture each stage immediately: resolving common-dir only after a failure
// cannot tell us where the entry was published. Read metadata, never contents,
// and retain IO errors so a missing path is distinct from a failed inspection.
fn shelf_snapshot(common: &std::path::Path, id: &str) -> String {
    let root = gitx_meta::shelf_root(common);
    let entry = gitx_meta::shelf_dir(common, id);
    let paths = [
        common.to_path_buf(),
        common.join("gitx"),
        root.clone(),
        entry.clone(),
        entry.join("meta.json"),
        entry.join("changes.patch"),
    ]
    .map(|path| {
        let state = std::fs::symlink_metadata(&path)
            .map(|meta| (meta.file_type(), meta.len()))
            .map_err(|error| (error.kind(), error.raw_os_error()));
        (path, state)
    });
    let entries = std::fs::read_dir(&root).map(|items| {
        items
            .take(33)
            .map(|item| item.map(|entry| entry.file_name()))
            .collect::<Vec<_>>()
    });
    let canonical = std::fs::canonicalize(common);
    format!("canonical_common={canonical:?}; paths={paths:?}; root_entries_first_33={entries:?}")
}

#[tokio::test]
async fn unshelve_failure_preserves_local_edits_index_and_saved_shelf() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "shelved version\n").unwrap();
    let entry = runner
        .shelve_changes(
            cwd,
            "saved",
            &["README.md".into()],
            false,
            None,
            false,
            &cancel,
        )
        .await
        .unwrap();
    let index_path = runner.git_dir(cwd, &cancel).await.unwrap().join("index");
    let index = std::fs::read(&index_path).unwrap();
    std::fs::write(cwd.join("README.md"), "local unsaved version\n").unwrap();
    assert!(runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .is_err());
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        b"local unsaved version\n"
    );
    assert_eq!(std::fs::read(index_path).unwrap(), index);
    assert_eq!(
        runner.shelf_list(cwd, &cancel).await.unwrap()[0].id,
        entry.id
    );
}

#[tokio::test]
async fn unshelve_conflict_keeps_the_shelf_for_resolution() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "shelved version\n").unwrap();
    let entry = runner
        .shelve_changes(
            cwd,
            "saved",
            &["README.md".into()],
            false,
            None,
            false,
            &cancel,
        )
        .await
        .unwrap();
    std::fs::write(cwd.join("README.md"), "committed other version\n").unwrap();
    runner
        .stage_paths(cwd, &["README.md".into()], &cancel)
        .await
        .unwrap();
    runner
        .commit_create(cwd, "other", false, false, &cancel)
        .await
        .unwrap();
    assert!(runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .is_err());
    assert_eq!(
        runner.shelf_list(cwd, &cancel).await.unwrap()[0].id,
        entry.id
    );
    let text = std::fs::read_to_string(cwd.join("README.md")).unwrap();
    assert!(text.contains("<<<<<<<"));
    assert!(text.contains("shelved version"));
    assert!(text.contains("committed other version"));
}

#[tokio::test]
async fn successful_unshelve_retains_the_shelf_unless_removal_is_requested() {
    for remove in [false, true] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let cwd = repo.path();
        git_text(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
        std::fs::write(cwd.join("README.md"), "saved shelf\n").unwrap();
        let entry = runner
            .shelve_changes(
                cwd,
                "saved",
                &["README.md".into()],
                false,
                None,
                false,
                &cancel,
            )
            .await
            .unwrap();
        let (applied, failed) = runner
            .unshelve(cwd, &entry.id, remove, &cancel)
            .await
            .unwrap();
        assert_eq!(applied, ["README.md"]);
        assert!(failed.is_empty());
        assert_eq!(
            std::fs::read_to_string(cwd.join("README.md")).unwrap(),
            "saved shelf\n"
        );
        assert_eq!(
            runner.shelf_list(cwd, &cancel).await.unwrap().len(),
            usize::from(!remove)
        );
        assert_eq!(
            runner.shelf_list_deleted(cwd, &cancel).await.unwrap().len(),
            usize::from(remove)
        );
        if remove {
            runner.shelf_restore(cwd, &entry.id, &cancel).await.unwrap();
            assert_eq!(
                runner.shelf_list(cwd, &cancel).await.unwrap()[0].id,
                entry.id
            );
        }
    }
}

#[tokio::test]
async fn empty_invalid_and_cancelled_unshelve_keep_the_shelf_and_index() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let base = git_text(&runner, cwd, &["rev-parse", "HEAD"]).await;
    let before = std::fs::read(cwd.join("README.md")).unwrap();
    let index = std::fs::read(common.join("index")).unwrap();
    for patch in [b"".as_slice(), b"malformed patch".as_slice()] {
        let entry = gitx_meta::create_shelf_entry(
            &common,
            "invalid",
            base.trim(),
            &["README.md".into()],
            patch,
            None,
            false,
            false,
        )
        .unwrap();
        assert!(runner
            .unshelve(cwd, &entry.id, true, &cancel)
            .await
            .is_err());
        assert!(gitx_meta::shelf_dir(&common, &entry.id).exists());
        let stopped = CancellationToken::new();
        stopped.cancel();
        assert_eq!(
            runner
                .unshelve(cwd, &entry.id, true, &stopped)
                .await
                .unwrap_err()
                .code,
            gitx_core::ErrorCode::Cancelled
        );
        assert_eq!(std::fs::read(cwd.join("README.md")).unwrap(), before);
        assert_eq!(std::fs::read(common.join("index")).unwrap(), index);
    }
}

#[tokio::test]
async fn unshelve_preserves_an_untracked_file_that_collides_with_a_saved_addition() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    git_text(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(cwd.join("new.txt"), "saved addition\n").unwrap();
    runner
        .stage_paths(cwd, &["new.txt".into()], &cancel)
        .await
        .unwrap();
    let entry = runner
        .shelve_changes(
            cwd,
            "added",
            &["new.txt".into()],
            true,
            None,
            false,
            &cancel,
        )
        .await
        .unwrap();
    git_text(&runner, cwd, &["reset", "--", "new.txt"]).await;
    std::fs::write(cwd.join("new.txt"), "local untracked content\n").unwrap();
    assert!(runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .is_err());
    assert_eq!(
        std::fs::read_to_string(cwd.join("new.txt")).unwrap(),
        "local untracked content\n"
    );
    assert_eq!(
        runner.shelf_list(cwd, &cancel).await.unwrap()[0].id,
        entry.id
    );
    assert!(git_text(&runner, cwd, &["diff", "--cached"])
        .await
        .is_empty());
}

#[tokio::test]
async fn binary_unshelve_roundtrip_retains_unrelated_staged_changes() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    std::fs::write(cwd.join("asset.bin"), [0, 1, 2, 3, 4]).unwrap();
    git_text(&runner, cwd, &["add", "asset.bin"]).await;
    git_text(&runner, cwd, &["commit", "-m", "binary base"]).await;
    let saved = [0, 9, 8, 7, 6, 5];
    std::fs::write(cwd.join("asset.bin"), saved).unwrap();
    let diagnostic_started = std::time::Instant::now();
    let expected_common = cwd.join(".git");
    let original_common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let entry = runner
        .shelve_changes(
            cwd,
            "binary",
            &["asset.bin".into()],
            false,
            None,
            false,
            &cancel,
        )
        .await
        .unwrap();
    let published = (
        diagnostic_started.elapsed(),
        shelf_snapshot(&original_common, &entry.id),
    );
    std::fs::write(cwd.join("README.md"), "unrelated staged\n").unwrap();
    git_text(&runner, cwd, &["add", "README.md"]).await;
    let staged = git_text(&runner, cwd, &["show", ":README.md"]).await;
    let before_unshelve = (
        diagnostic_started.elapsed(),
        shelf_snapshot(&original_common, &entry.id),
    );
    if let Err(error) = runner.unshelve(cwd, &entry.id, false, &cancel).await {
        // Inspect the original location before running another Git process.
        let failed_original = (
            diagnostic_started.elapsed(),
            shelf_snapshot(&original_common, &entry.id),
        );
        let expected_state = shelf_snapshot(&expected_common, &entry.id);
        let resolved_after = runner.git_common_dir(cwd, &cancel).await;
        let resolved_state = resolved_after
            .as_ref()
            .map(|common| shelf_snapshot(common, &entry.id));
        panic!(
            "binary Shelf {} failed: {error:?}; cwd={cwd:?}; expected_common={expected_common:?}; \
             original_common={original_common:?}; published={published:?}; before_unshelve={before_unshelve:?}; \
             failed_original={failed_original:?}; expected_state={expected_state}; \
             resolved_after={resolved_after:?}; resolved_state={resolved_state:?}",
            entry.id
        );
    }
    assert_eq!(std::fs::read(cwd.join("asset.bin")).unwrap(), saved);
    assert_eq!(
        git_text(&runner, cwd, &["show", ":README.md"]).await,
        staged
    );
}
