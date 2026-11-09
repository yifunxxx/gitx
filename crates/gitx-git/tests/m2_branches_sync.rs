//! M2: branches CRUD + fetch/push against a local bare remote.

use gitx_core::{FetchTagsPolicy, UpdateMethod};
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::collections::HashSet;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn pull_without_commit_reports_staged_updates_and_preserves_head() {
    for squash in [false, true] {
        let repo = FixtureBuilder::new().build("with-remote").unwrap();
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let cwd = repo.path();
        std::fs::write(cwd.join("incoming.txt"), "incoming\n").unwrap();
        runner
            .stage_paths(cwd, &["incoming.txt".into()], &cancel)
            .await
            .unwrap();
        runner
            .commit_create(cwd, "incoming", false, false, &cancel)
            .await
            .unwrap();
        runner
            .push_run(
                cwd,
                "origin",
                "main",
                None,
                false,
                false,
                None,
                &[],
                &cancel,
            )
            .await
            .unwrap();
        runner
            .run(
                gitx_git::GitInvocation::new(cwd, ["reset", "--hard", "HEAD~1"]),
                &cancel,
            )
            .await
            .unwrap();
        // A local commit forces a merge when --no-commit is selected.
        runner
            .run(
                gitx_git::GitInvocation::new(cwd, ["commit", "--allow-empty", "-m", "local"]),
                &cancel,
            )
            .await
            .unwrap();
        std::fs::write(cwd.join("README.md"), "local unfinished\n").unwrap();
        let output = runner
            .run(
                gitx_git::GitInvocation::new(cwd, ["rev-parse", "HEAD"]),
                &cancel,
            )
            .await
            .unwrap();
        let old = String::from_utf8(output.stdout).unwrap().trim().to_string();
        let result = runner
            .pull_run(
                cwd, "origin", "main", false, false, !squash, squash, true, false, &cancel,
            )
            .await
            .unwrap();
        assert_eq!(result.old_head, old);
        assert_eq!(result.new_head, old);
        assert!(result.updated, "{result:?}");
        assert_eq!(result.message, "Changes applied; commit required");
        assert_eq!(result.updated_files.len(), 1);
        assert_eq!(result.updated_files[0].path, "incoming.txt");
        assert!(result.commits.is_empty(), "No commits were created");
        assert_eq!(
            std::fs::read_to_string(cwd.join("README.md")).unwrap(),
            "local unfinished\n"
        );
    }
}

#[tokio::test]
async fn squash_of_an_up_to_date_branch_does_not_report_existing_staged_work() {
    let repo = FixtureBuilder::new().build("with-remote").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    std::fs::write(repo.path().join("local.txt"), "staged locally\n").unwrap();
    runner
        .stage_paths(repo.path(), &["local.txt".into()], &cancel)
        .await
        .unwrap();
    let result = runner
        .pull_run(
            repo.path(),
            "origin",
            "main",
            false,
            false,
            false,
            true,
            false,
            false,
            &cancel,
        )
        .await
        .unwrap();
    assert!(!result.updated);
    assert!(result.updated_files.is_empty());
    assert_eq!(result.message, "Already up to date");
}

#[tokio::test]
async fn push_preview_and_execution_use_the_selected_source_remote_and_target() {
    let repo = FixtureBuilder::new().build("with-remote").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    runner
        .branch_create(cwd, "feature/local", Some("main"), false, false, &cancel)
        .await
        .unwrap();
    runner
        .branch_checkout(cwd, "feature/local", "local", &cancel)
        .await
        .unwrap();
    std::fs::write(cwd.join("feature.txt"), "only feature\n").unwrap();
    runner
        .stage_paths(cwd, &["feature.txt".into()], &cancel)
        .await
        .unwrap();
    runner
        .commit_create(cwd, "feature only", false, false, &cancel)
        .await
        .unwrap();
    // Previewing a new branch excludes the history already present on origin/main.
    let new_branch = runner
        .push_preview(
            cwd,
            Some("origin"),
            Some("feature/local"),
            Some("review/remote"),
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(new_branch.commits.len(), 1);
    assert!(new_branch.commits[0].ends_with("feature only"));
    assert!(new_branch.set_upstream);
    assert!(!new_branch.commits_truncated);
    // Leave HEAD on main: preview and push must still use feature/local.
    runner
        .branch_checkout(cwd, "main", "local", &cancel)
        .await
        .unwrap();
    let result = runner
        .push_run(
            cwd,
            "origin",
            "feature/local",
            Some("review/remote"),
            true,
            false,
            None,
            &[],
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(result.outcome, gitx_core::PushOutcome::Success);
    let tracked = runner
        .push_preview(cwd, None, Some("feature/local"), None, &cancel)
        .await
        .unwrap();
    assert_eq!(tracked.remote, "origin");
    assert_eq!(tracked.refs[0].local, "feature/local");
    assert_eq!(tracked.refs[0].remote_branch, "review/remote");
    assert!(!tracked.set_upstream);
    assert!(tracked.commits.is_empty());

    let remote_url = runner.remote_list(cwd, &cancel).await.unwrap()[0]
        .fetch_url
        .clone();
    runner
        .remote_add(cwd, "backup", &remote_url, &cancel)
        .await
        .unwrap();
    runner
        .run(
            gitx_git::GitInvocation::new(
                cwd,
                ["update-ref", "refs/remotes/backup/review/remote", "main"],
            ),
            &cancel,
        )
        .await
        .unwrap();
    let other_remote = runner
        .push_preview(
            cwd,
            Some("backup"),
            Some("feature/local"),
            Some("review/remote"),
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(other_remote.commits.len(), 1);
    assert!(other_remote.set_upstream);
    let other_target = runner
        .push_preview(
            cwd,
            Some("origin"),
            Some("feature/local"),
            Some("main"),
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(other_target.commits.len(), 1);
    assert!(other_target.set_upstream);
    // Protection is checked against the remote target, even with a different source name.
    let protected = runner
        .push_run(
            cwd,
            "origin",
            "feature/local",
            Some("main"),
            false,
            true,
            None,
            &["main".into()],
            &cancel,
        )
        .await
        .unwrap_err();
    assert_eq!(protected.code, gitx_core::ErrorCode::ProtectedBranch);
    for invalid in [":main", "main:other", "--all", "HEAD"] {
        assert!(runner
            .push_preview(cwd, Some("origin"), Some(invalid), None, &cancel)
            .await
            .is_err());
    }
    assert!(runner
        .push_preview(cwd, Some("missing"), Some("main"), None, &cancel)
        .await
        .is_err());

    // An unchanged branch plus a newly pushed tag is a successful update.
    runner
        .tag_create(
            cwd,
            "qa-push-tag",
            "main",
            Some("tag alongside unchanged branch"),
            false,
            &cancel,
        )
        .await
        .unwrap();
    let tag_push = runner
        .push_run(
            cwd,
            "origin",
            "feature/local",
            Some("review/remote"),
            false,
            false,
            Some("all"),
            &[],
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(tag_push.outcome, gitx_core::PushOutcome::Success);
    let again = runner
        .push_run(
            cwd,
            "origin",
            "feature/local",
            Some("review/remote"),
            false,
            false,
            Some("all"),
            &[],
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(again.outcome, gitx_core::PushOutcome::UpToDate);
}

#[tokio::test]
async fn pull_reports_the_files_and_commits_it_downloaded() {
    let repo = FixtureBuilder::new().build("with-remote").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    std::fs::write(cwd.join("remote-update.txt"), "remote update\n").unwrap();
    runner
        .stage_paths(cwd, &["remote-update.txt".into()], &cancel)
        .await
        .unwrap();
    runner
        .commit_create(cwd, "remote update", false, false, &cancel)
        .await
        .unwrap();
    runner
        .push_run(
            cwd,
            "origin",
            "main",
            None,
            false,
            false,
            None,
            &[],
            &cancel,
        )
        .await
        .unwrap();
    runner
        .run(
            gitx_git::GitInvocation::new(cwd, ["reset", "--hard", "HEAD~1"])
                .kind(gitx_git::OpKind::Write),
            &cancel,
        )
        .await
        .unwrap();
    std::fs::write(cwd.join("README.md"), "local unfinished work\n").unwrap();
    let result = runner
        .pull_run(
            cwd, "origin", "main", false, true, false, false, false, false, &cancel,
        )
        .await
        .unwrap();
    assert!(result.updated);
    assert_eq!(result.updated_files.len(), 1);
    assert_eq!(result.updated_files[0].path, "remote-update.txt");
    assert_eq!(result.updated_files[0].status, "A");
    assert_eq!(result.commits.len(), 1);
    assert!(result.commits[0].ends_with("remote update"));
    assert_eq!(
        std::fs::read_to_string(cwd.join("README.md")).unwrap(),
        "local unfinished work\n"
    );
    let again = runner
        .pull_run(
            cwd, "origin", "main", false, true, false, false, false, false, &cancel,
        )
        .await
        .unwrap();
    assert!(!again.updated);
    assert!(again.updated_files.is_empty());
    assert!(again.commits.is_empty());
}

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
    assert!(refs
        .local
        .iter()
        .any(|b| b.name == "feature/a" && b.is_head));
    assert!(refs
        .local
        .iter()
        .any(|b| b.name == "feature/a" && b.is_favorite));

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
        .push_preview(cwd, Some("origin"), None, None, &cancel)
        .await
        .expect("preview");
    assert!(preview.has_remote);
    assert!(!preview.commits.is_empty());

    let push = runner
        .push_run(
            cwd,
            "origin",
            "main",
            None,
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
            None,
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
    assert!(runner
        .is_shallow(&clone_dir, &cancel)
        .await
        .expect("shallow"));
}
