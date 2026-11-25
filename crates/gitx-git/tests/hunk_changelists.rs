use gitx_core::{ChangelistCommitFile, DiffSide};
use gitx_git::{GitInvocation, GitRunner};
use gitx_testkit::FixtureBuilder;
use std::path::Path;
use tokio_util::sync::CancellationToken;

async fn git(cwd: &Path, args: &[&str]) -> Vec<u8> {
    GitRunner::new("git")
        .run(
            GitInvocation::new(cwd, args.iter().copied()),
            &CancellationToken::new(),
        )
        .await
        .unwrap()
        .stdout
}
async fn preview(cwd: &Path, path: &str) -> Vec<gitx_core::DiffHunk> {
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let base = runner
        .read_blob_side(cwd, path, DiffSide::Head, &cancel)
        .await
        .unwrap();
    let work = runner
        .read_blob_side(cwd, path, DiffSide::Worktree, &cancel)
        .await
        .unwrap();
    gitx_diff::compute_hunks(
        gitx_diff::decode_lossy(base.as_deref()).as_deref(),
        gitx_diff::decode_lossy(work.as_deref()).as_deref(),
        &Default::default(),
    )
}
async fn selection(cwd: &Path, path: &str, id: &str) -> ChangelistCommitFile {
    let state = GitRunner::new("git")
        .changelist_resolve(cwd, &CancellationToken::new())
        .await
        .unwrap();
    ChangelistCommitFile {
        path: path.into(),
        list_ids: vec![id.into()],
        expected_token: state
            .partial_files
            .iter()
            .find(|file| file.path == path)
            .map(|file| file.content_token.clone()),
    }
}
async fn setup(cwd: &Path) -> (String, String, String) {
    git(cwd, &["config", "core.autocrlf", "false"]).await;
    let base = (0..40).map(|i| format!("line {i}\n")).collect::<String>();
    std::fs::write(cwd.join("README.md"), &base).unwrap();
    git(cwd, &["add", "README.md"]).await;
    git(cwd, &["commit", "-m", "base"]).await;
    let work = base
        .replace("line 12\n", "first change\n")
        .replace("line 30\n", "second change\n");
    std::fs::write(cwd.join("README.md"), &work).unwrap();
    let state = gitx_meta::create_changelist(&cwd.join(".git"), "Feature", "", false).unwrap();
    let id = state.lists.last().unwrap().id.clone();
    let hunks = preview(cwd, "README.md").await;
    assert_eq!(hunks.len(), 2);
    GitRunner::new("git")
        .changelist_move_hunks(
            cwd,
            "README.md",
            &[1],
            &hunks,
            &id,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    (base, work, id)
}

#[tokio::test]
async fn two_lists_commit_only_their_own_hunks_and_keep_other_staged_content() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let (base, work, id) = setup(cwd).await;
    let staged = base.replace("line 12\n", "first change\n");
    std::fs::write(cwd.join("README.md"), &staged).unwrap();
    git(cwd, &["add", "README.md"]).await;
    std::fs::write(cwd.join("README.md"), &work).unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let files = vec![selection(cwd, "README.md", &id).await];
    let first = runner
        .commit_changelist_files(cwd, "feature only", false, false, &files, &cancel)
        .await
        .unwrap();
    assert!(first.warning.is_none());
    assert_eq!(
        git(cwd, &["show", "HEAD:README.md"]).await,
        base.replace("line 30\n", "second change\n").as_bytes()
    );
    assert_eq!(git(cwd, &["show", ":README.md"]).await, work.as_bytes());
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        work.as_bytes()
    );
    let files = vec![selection(cwd, "README.md", "default").await];
    runner
        .commit_changelist_files(cwd, "other list", false, false, &files, &cancel)
        .await
        .unwrap();
    assert_eq!(git(cwd, &["show", "HEAD:README.md"]).await, work.as_bytes());
    assert!(git(cwd, &["status", "--porcelain"]).await.is_empty());
}

#[tokio::test]
async fn new_lines_relocate_unique_anchors_but_old_commit_snapshot_is_rejected() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let (_, work, id) = setup(cwd).await;
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let old = selection(cwd, "README.md", &id).await;
    std::fs::write(cwd.join("README.md"), format!("intro\n{work}")).unwrap();
    let state = runner.changelist_resolve(cwd, &cancel).await.unwrap();
    let file = &state.partial_files[0];
    assert!(file.problem.is_none());
    assert_eq!(
        file.hunks.iter().filter(|hunk| hunk.list_id == id).count(),
        1
    );
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    assert!(runner
        .commit_changelist_files(cwd, "stale", false, false, &[old], &cancel)
        .await
        .is_err());
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
    runner
        .commit_changelist_files(
            cwd,
            "relocated",
            false,
            false,
            &[selection(cwd, "README.md", &id).await],
            &cancel,
        )
        .await
        .unwrap();
    assert!(
        !String::from_utf8(git(cwd, &["show", "HEAD:README.md"]).await)
            .unwrap()
            .starts_with("intro")
    );
}

#[tokio::test]
async fn changed_block_requires_review_and_reassignment() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let (_, work, id) = setup(cwd).await;
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    std::fs::write(
        cwd.join("README.md"),
        work.replace("second change", "different second"),
    )
    .unwrap();
    assert!(runner
        .changelist_resolve(cwd, &cancel)
        .await
        .unwrap()
        .partial_files[0]
        .problem
        .is_some());
    let selected = selection(cwd, "README.md", &id).await;
    assert!(runner
        .commit_changelist_files(cwd, "unreviewed", false, false, &[selected], &cancel)
        .await
        .is_err());
    runner
        .changelist_move_hunks(
            cwd,
            "README.md",
            &[1],
            &preview(cwd, "README.md").await,
            &id,
            &cancel,
        )
        .await
        .unwrap();
    assert!(runner
        .changelist_resolve(cwd, &cancel)
        .await
        .unwrap()
        .partial_files[0]
        .problem
        .is_none());
    runner
        .commit_changelist_files(
            cwd,
            "reviewed",
            false,
            false,
            &[selection(cwd, "README.md", &id).await],
            &cancel,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn whole_move_replaces_all_assignments_and_list_deletion_preserves_hunks() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let (_, _, id) = setup(cwd).await;
    let state = gitx_meta::delete_changelist(&cwd.join(".git"), &id, Some("default")).unwrap();
    assert_eq!(
        state
            .assignments
            .iter()
            .flat_map(|assignment| &assignment.hunk_ranges)
            .count(),
        2
    );
    let resolved = GitRunner::new("git")
        .changelist_resolve(cwd, &CancellationToken::new())
        .await
        .unwrap();
    assert!(resolved.partial_files[0]
        .hunks
        .iter()
        .all(|hunk| hunk.list_id == "default"));
    let state = gitx_meta::move_paths(&cwd.join(".git"), &["README.md".into()], "default").unwrap();
    assert_eq!(state.assignments.len(), 1);
    assert!(state.assignments[0].hunk_ranges.is_empty());
}

#[tokio::test]
async fn pure_deletion_and_mixed_whole_files_use_one_precise_commit() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let (base, work, id) = setup(cwd).await;
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    std::fs::write(cwd.join("whole.txt"), "whole file\n").unwrap();
    let selection = vec![
        selection(cwd, "README.md", &id).await,
        ChangelistCommitFile {
            path: "whole.txt".into(),
            list_ids: vec![],
            expected_token: None,
        },
    ];
    runner
        .commit_changelist_files(cwd, "mixed", false, false, &selection, &cancel)
        .await
        .unwrap();
    assert_eq!(
        git(cwd, &["show", "HEAD:README.md"]).await,
        base.replace("line 30\n", "second change\n").as_bytes()
    );
    assert_eq!(git(cwd, &["show", "HEAD:whole.txt"]).await, b"whole file\n");
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        work.as_bytes()
    );
    std::fs::remove_file(cwd.join("whole.txt")).unwrap();
    runner
        .changelist_move_hunks(
            cwd,
            "whole.txt",
            &[0],
            &preview(cwd, "whole.txt").await,
            &id,
            &cancel,
        )
        .await
        .unwrap();
    runner
        .commit_changelist_files(
            cwd,
            "delete file",
            false,
            false,
            &[crate::selection(cwd, "whole.txt", &id).await],
            &cancel,
        )
        .await
        .unwrap();
    assert!(git(cwd, &["ls-tree", "HEAD", "whole.txt"]).await.is_empty());
    assert!(!cwd.join("whole.txt").exists());
}

#[tokio::test]
async fn unborn_repository_can_assign_and_commit_a_new_file_without_losing_other_new_files() {
    let root = tempfile::tempdir().unwrap();
    let cwd = root.path();
    git(cwd, &["init", "-b", "main"]).await;
    git(cwd, &["config", "user.name", "QA"]).await;
    git(cwd, &["config", "user.email", "qa@example.invalid"]).await;
    git(cwd, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(cwd.join("new.txt"), "first file\nlast line").unwrap();
    std::fs::write(cwd.join("keep.txt"), "unselected\n").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .changelist_move_hunks(
            cwd,
            "new.txt",
            &[0],
            &preview(cwd, "new.txt").await,
            "default",
            &cancel,
        )
        .await
        .unwrap();
    runner
        .commit_changelist_files(
            cwd,
            "initial",
            false,
            false,
            &[selection(cwd, "new.txt", "default").await],
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(
        git(cwd, &["show", "HEAD:new.txt"]).await,
        b"first file\nlast line"
    );
    assert!(git(cwd, &["ls-tree", "HEAD", "keep.txt"]).await.is_empty());
    assert_eq!(
        std::fs::read(cwd.join("keep.txt")).unwrap(),
        b"unselected\n"
    );
}

#[tokio::test]
async fn both_directions_of_whole_partial_conversion_reject_the_old_commit_scope() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let (_, _, id) = setup(cwd).await;
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let index = std::fs::read(cwd.join(".git/index")).unwrap();
    let whole = ChangelistCommitFile {
        path: "README.md".into(),
        list_ids: vec!["default".into()],
        expected_token: None,
    };
    assert!(runner
        .commit_changelist_files(cwd, "stale whole", false, false, &[whole], &cancel)
        .await
        .is_err());
    let partial = selection(cwd, "README.md", &id).await;
    gitx_meta::move_paths(&cwd.join(".git"), &["README.md".into()], &id).unwrap();
    assert!(runner
        .commit_changelist_files(cwd, "stale partial", false, false, &[partial], &cancel)
        .await
        .is_err());
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index);
}

#[tokio::test]
async fn list_rename_and_deletion_invalidate_old_selections_without_advancing_head() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let (_, _, id) = setup(cwd).await;
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let old = selection(cwd, "README.md", &id).await;
    gitx_meta::rename_changelist(&cwd.join(".git"), &id, "Renamed").unwrap();
    assert!(runner
        .commit_changelist_files(cwd, "old name", false, false, &[old], &cancel)
        .await
        .is_err());
    let old = selection(cwd, "README.md", &id).await;
    gitx_meta::delete_changelist(&cwd.join(".git"), &id, Some("default")).unwrap();
    assert!(runner
        .commit_changelist_files(cwd, "deleted", false, false, &[old], &cancel)
        .await
        .is_err());
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
}

#[tokio::test]
async fn crlf_worktree_and_no_final_newline_preserve_only_selected_content() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let (base, work, id) = setup(cwd).await;
    git(cwd, &["config", "core.autocrlf", "true"]).await;
    let work = work.trim_end_matches('\n').replace('\n', "\r\n");
    std::fs::write(cwd.join("README.md"), &work).unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    // The no-final-newline change is a separate active-list block.
    let state = runner.changelist_resolve(cwd, &cancel).await.unwrap();
    assert!(state.partial_files[0].problem.is_none());
    runner
        .commit_changelist_files(
            cwd,
            "CRLF subset",
            false,
            false,
            &[selection(cwd, "README.md", &id).await],
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(
        git(cwd, &["show", "HEAD:README.md"]).await,
        base.replace("line 30\n", "second change\n").as_bytes()
    );
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        work.as_bytes()
    );
}

#[tokio::test]
async fn staged_deletion_can_be_assigned_and_committed() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["rm", "README.md"]).await;
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .changelist_move_hunks(
            cwd,
            "README.md",
            &[0],
            &preview(cwd, "README.md").await,
            "default",
            &cancel,
        )
        .await
        .unwrap();
    runner
        .commit_changelist_files(
            cwd,
            "delete",
            false,
            false,
            &[selection(cwd, "README.md", "default").await],
            &cancel,
        )
        .await
        .unwrap();
    assert!(git(cwd, &["ls-tree", "HEAD", "README.md"]).await.is_empty());
    assert!(git(cwd, &["status", "--porcelain"]).await.is_empty());
}

#[tokio::test]
async fn unsupported_filters_and_stale_previews_do_not_write_metadata() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let (_, work, id) = setup(cwd).await;
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let metadata = std::fs::read(cwd.join(".git/gitx/changelists.json")).unwrap();
    let old = preview(cwd, "README.md").await;
    std::fs::write(
        cwd.join("README.md"),
        work.replace("second change", "changed again"),
    )
    .unwrap();
    assert!(runner
        .changelist_move_hunks(cwd, "README.md", &[1], &old, &id, &cancel)
        .await
        .is_err());
    std::fs::write(cwd.join(".gitattributes"), "README.md filter=custom\n").unwrap();
    assert!(runner
        .changelist_move_hunks(
            cwd,
            "README.md",
            &[1],
            &preview(cwd, "README.md").await,
            &id,
            &cancel
        )
        .await
        .is_err());
    assert_eq!(
        std::fs::read(cwd.join(".git/gitx/changelists.json")).unwrap(),
        metadata
    );
}

#[tokio::test]
async fn cancelled_and_hook_rejected_mixed_commits_keep_the_original_index_and_worktree() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let (_, work, id) = setup(cwd).await;
    std::fs::write(cwd.join("whole.txt"), "whole\n").unwrap();
    let files = vec![
        selection(cwd, "README.md", &id).await,
        ChangelistCommitFile {
            path: "whole.txt".into(),
            list_ids: vec![],
            expected_token: None,
        },
    ];
    let index = std::fs::read(cwd.join(".git/index")).unwrap();
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(runner
        .commit_changelist_files(cwd, "cancelled", false, false, &files, &cancel)
        .await
        .is_err());
    let hook = cwd.join(".git/hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    assert!(runner
        .commit_changelist_files(
            cwd,
            "hook rejected",
            false,
            false,
            &files,
            &CancellationToken::new()
        )
        .await
        .is_err());
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        work.as_bytes()
    );
    assert!(!cwd.join(".git/index.lock").exists());
}
