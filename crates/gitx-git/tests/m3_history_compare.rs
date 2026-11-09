//! M3 history / compare integration: file history, blame, diff_refs, tree.

use gitx_core::{LogFilters, LogOrder};
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn locates_near_the_root_of_a_large_history_without_loading_metadata_pages() {
    use std::fmt::Write;
    let repo = FixtureBuilder::new().build("empty").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let mut import = String::new();
    for i in 1..=20_000 {
        let message = format!("commit {i}");
        write!(import, "commit refs/heads/main\nmark :{i}\ncommitter QA <qa@example.invalid> {} +0000\ndata {}\n{message}\n", 1_700_000_000 + i, message.len()).unwrap();
        if i > 1 {
            writeln!(import, "from :{}", i - 1).unwrap();
        }
        import.push('\n');
    }
    import.push_str("reset refs/tags/early\nfrom :100\n\n");
    runner
        .run(
            gitx_git::GitInvocation::new(repo.path(), ["fast-import", "--quiet"])
                .stdin(import.into_bytes()),
            &cancel,
        )
        .await
        .unwrap();
    let start = std::time::Instant::now();
    let location = runner
        .log_locate(repo.path(), "early", &LogFilters::default(), &cancel)
        .await
        .unwrap();
    assert_eq!(location.offset, Some(19_900));
    let (page, truncated) = runner
        .log_page(repo.path(), 19_850, 150, &LogFilters::default(), &cancel)
        .await
        .unwrap();
    assert_eq!(page.len(), 150);
    assert_eq!(page[50].sha, location.sha);
    assert!(!truncated);
    eprintln!("20,000 commit locate + context page: {:?}", start.elapsed());
}

#[tokio::test]
async fn log_location_matches_filtered_pages_and_excludes_internal_backups() {
    let repo = FixtureBuilder::new().build("merge-conflict").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    // A detached commit reachable only through an application backup must not
    // create a visible lane, but real branch commits sharing its ancestors stay.
    for args in [
        vec!["checkout", "--detach", "HEAD"],
        vec!["commit", "--allow-empty", "-m", "backup only"],
        vec!["update-ref", "refs/gitx/backup/merge-qa", "HEAD"],
        vec!["checkout", "main"],
        vec!["update-ref", "refs/gitx/backup/shared", "HEAD"],
        vec!["tag", "-a", "qa-tag", "-m", "annotated", "feature"],
    ] {
        runner
            .run(gitx_git::GitInvocation::new(cwd, args), &cancel)
            .await
            .unwrap();
    }
    let (page, _) = runner
        .log_page(cwd, 0, 100, &LogFilters::default(), &cancel)
        .await
        .unwrap();
    assert_eq!(page.len(), 3);
    assert!(page
        .iter()
        .flat_map(|c| &c.refs)
        .all(|r| !r.contains("gitx/")));
    let details = runner
        .log_commit_details(cwd, "main", &cancel)
        .await
        .unwrap();
    assert!(details.refs.iter().all(|r| !r.contains("gitx/")));
    assert!(runner
        .log_locate(
            cwd,
            "refs/gitx/backup/merge-qa",
            &LogFilters::default(),
            &cancel
        )
        .await
        .unwrap()
        .offset
        .is_none());
    let tag = runner
        .log_locate(cwd, "qa-tag", &LogFilters::default(), &cancel)
        .await
        .unwrap();
    assert_eq!(page[tag.offset.unwrap() as usize].subject, "feature edit");
    let abbrev = runner
        .log_locate(cwd, &tag.sha[..10], &LogFilters::default(), &cancel)
        .await
        .unwrap();
    assert_eq!(abbrev.sha, tag.sha);
    for filters in [
        LogFilters::default(),
        LogFilters {
            order: LogOrder::Topo,
            ..Default::default()
        },
        LogFilters {
            revisions: vec!["main".into()],
            ..Default::default()
        },
        LogFilters {
            text: Some("edit".into()),
            ..Default::default()
        },
        LogFilters {
            text: Some("^(main|feature)".into()),
            regex: true,
            ..Default::default()
        },
        LogFilters {
            paths: vec!["file.txt".into()],
            first_parent: true,
            ..Default::default()
        },
        LogFilters {
            no_merges: true,
            authors: vec!["gitx-test".into()],
            ..Default::default()
        },
        LogFilters {
            since: Some("2025-01-01".into()),
            ..Default::default()
        },
    ] {
        let (visible, _) = runner
            .log_page(cwd, 0, 100, &filters, &cancel)
            .await
            .unwrap();
        for c in &page {
            let location = runner
                .log_locate(cwd, &c.sha, &filters, &cancel)
                .await
                .unwrap();
            assert_eq!(
                location.offset.map(|n| n as usize),
                visible.iter().position(|v| v.sha == c.sha),
                "filters: {filters:?}"
            );
            if let Some(offset) = location.offset {
                let (one, _) = runner
                    .log_page(cwd, offset, 1, &filters, &cancel)
                    .await
                    .unwrap();
                assert_eq!(one[0].sha, c.sha);
            }
        }
    }
    for invalid in ["--all", "missing-ref", "main..feature"] {
        assert!(runner
            .log_locate(cwd, invalid, &LogFilters::default(), &cancel)
            .await
            .is_err());
    }
    // HEAD itself remains visible after detaching from the public refs.
    runner
        .run(
            gitx_git::GitInvocation::new(
                cwd,
                ["checkout", "--detach", "refs/gitx/backup/merge-qa"],
            ),
            &cancel,
        )
        .await
        .unwrap();
    let detached = runner
        .log_locate(cwd, "HEAD", &LogFilters::default(), &cancel)
        .await
        .unwrap();
    assert!(detached.offset.is_some());
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
