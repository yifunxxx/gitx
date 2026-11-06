//! M2: branches CRUD + fetch/push against a local bare remote.

use gitx_core::{FetchTagsPolicy, UpdateMethod};
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::collections::HashSet;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn branch_create_checkout_rename_delete_and_favorite_list() {
    let repo = FixtureBuilder::new().build("clean").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    runner
        .branch_create(cwd, "feature/a", Some("main"), false, false, &cancel)
        .await
        .expect("create");
    runner
        .branch_checkout(cwd, "feature/a", "local", &cancel)
        .await
        .expect("checkout");

    let favs: HashSet<String> = ["refs/heads/feature/a".into()].into_iter().collect();
    let refs = runner.refs_list(cwd, &favs, &cancel).await.expect("refs");
    assert!(refs.local.iter().any(|b| b.name == "feature/a" && b.is_head));
    assert!(
        refs.local
            .iter()
            .any(|b| b.name == "feature/a" && b.is_favorite)
    );

    runner
        .branch_rename(cwd, "feature/a", "feature/b", false, false, &cancel)
        .await
        .expect("rename");

    let refs2 = runner
        .refs_list(cwd, &HashSet::new(), &cancel)
        .await
        .expect("refs2");
    assert!(refs2.local.iter().any(|b| b.name == "feature/b"));
    assert!(!refs2.local.iter().any(|b| b.name == "feature/a"));

    runner
        .branch_checkout(cwd, "main", "local", &cancel)
        .await
        .expect("back to main");
    let sha = runner
        .branch_delete(cwd, "feature/b", true, &cancel)
        .await
        .expect("delete");
    assert!(!sha.is_empty());

    runner
        .branch_restore(cwd, "feature/b", &sha, &cancel)
        .await
        .expect("restore");
    let refs3 = runner
        .refs_list(cwd, &HashSet::new(), &cancel)
        .await
        .expect("refs3");
    assert!(refs3.local.iter().any(|b| b.name == "feature/b"));
}

#[tokio::test]
async fn remote_fetch_push_update_roundtrip() {
    let repo = FixtureBuilder::new().build("with-remote").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    let remotes = runner.remote_list(cwd, &cancel).await.expect("remotes");
    assert_eq!(remotes.len(), 1);
    assert_eq!(remotes[0].name, "origin");

    // Local commit then push.
    std::fs::write(cwd.join("README.md"), "# with-remote v2\n").unwrap();
    runner
        .stage_paths(cwd, &["README.md".into()], &cancel)
        .await
        .expect("stage");
    runner
        .commit_create(cwd, "second", false, false, &cancel)
        .await
        .expect("commit");

    let preview = runner
        .push_preview(cwd, Some("origin"), &cancel)
        .await
        .expect("preview");
    assert!(preview.has_remote);
    assert!(!preview.commits.is_empty());

    let push = runner
        .push_run(
            cwd,
            "origin",
            "main",
            false,
            false,
            None,
            &["main".into(), "master".into()],
            &cancel,
        )
        .await
        .expect("push");
    assert!(!push.rejected);

    // Force-with-lease to protected branch must fail.
    let forced = runner
        .push_run(
            cwd,
            "origin",
            "main",
            false,
            true,
            None,
            &["main".into()],
            &cancel,
        )
        .await;
    assert!(forced.is_err());

    let fetch = runner
        .fetch_run(cwd, Some("origin"), true, FetchTagsPolicy::Auto, &cancel)
        .await
        .expect("fetch");
    assert!(!fetch.message.is_empty());

    // Update project (merge) should be a no-op when already synced.
    let update = runner
        .update_project_run(cwd, UpdateMethod::Merge, &cancel)
        .await
        .expect("update");
    assert_eq!(update.old_head, update.new_head);

    // Tag create + list.
    runner
        .tag_create(cwd, "v1.0", "HEAD", Some("release"), false, &cancel)
        .await
        .expect("tag");
    let refs = runner
        .refs_list(cwd, &HashSet::new(), &cancel)
        .await
        .expect("refs");
    assert!(refs.tags.iter().any(|t| t.name == "v1.0"));

    let cmp = runner
        .compare_range(cwd, "main", "main", &cancel)
        .await
        .expect("compare");
    assert!(cmp.left_only.is_empty() && cmp.right_only.is_empty());
}

#[tokio::test]
async fn clone_from_bare_and_shallow() {
    let src = FixtureBuilder::new().build("with-remote").expect("src");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();

    // Find bare path from remote url.
    let remotes = runner
        .remote_list(src.path(), &cancel)
        .await
        .expect("remotes");
    let url = &remotes[0].fetch_url;

    let clone_dir = src.path().parent().unwrap().join("cloned-shallow");
    let result = runner
        .clone_run(url, &clone_dir, Some(1), None, &cancel)
        .await
        .expect("clone");
    assert!(result.shallow);
    assert!(clone_dir.join("README.md").exists());
    assert!(
        runner
            .is_shallow(&clone_dir, &cancel)
            .await
            .expect("shallow")
    );
}
