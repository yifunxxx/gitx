//! M6: line stage, changelists, stash, shelf, ignore, partial commit.

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

#[tokio::test]
async fn partial_commit_excludes_unrelated_staged_files() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\nremaining\n").unwrap();
    std::fs::write(cwd.join("unrelated.txt"), "keep staged\n").unwrap();
    runner
        .stage_paths(cwd, &["unrelated.txt".into()], &cancel)
        .await
        .unwrap();
    runner
        .commit_create_ex(
            cwd,
            "selected lines only",
            false,
            false,
            None,
            Some(&[gitx_core::PartialFileSelection {
                path: "README.md".into(),
                selected_lines: vec![2],
            }]),
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(
        git_text(&runner, cwd, &["show", "HEAD:README.md"]).await,
        "# clean\nselected\n"
    );
    let committed = git_text(
        &runner,
        cwd,
        &["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
    )
    .await;
    assert_eq!(committed.trim(), "README.md");
    assert_eq!(
        git_text(&runner, cwd, &["diff", "--cached", "--name-only"])
            .await
            .trim(),
        "unrelated.txt"
    );
    assert!(git_text(&runner, cwd, &["diff", "--", "README.md"])
        .await
        .contains("+remaining"));
    let gitx = runner.git_dir(cwd, &cancel).await.unwrap().join("gitx");
    assert_eq!(std::fs::read_dir(gitx).unwrap().count(), 0);
}

#[tokio::test]
async fn failed_partial_commit_preserves_the_real_index() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nstaged\n").unwrap();
    runner
        .stage_paths(cwd, &["README.md".into()], &cancel)
        .await
        .unwrap();
    std::fs::write(cwd.join("README.md"), "# clean\nstaged\nunstaged\n").unwrap();
    let git_dir = runner.git_dir(cwd, &cancel).await.unwrap();
    let hook = git_dir.join("hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let before = std::fs::read(git_dir.join("index")).unwrap();
    let result = runner
        .commit_create_ex(
            cwd,
            "hook rejects this",
            false,
            false,
            None,
            Some(&[gitx_core::PartialFileSelection {
                path: "README.md".into(),
                selected_lines: vec![3],
            }]),
            &cancel,
        )
        .await;
    assert!(result.is_err());
    assert_eq!(std::fs::read(git_dir.join("index")).unwrap(), before);
    assert_eq!(
        std::fs::read_to_string(cwd.join("README.md")).unwrap(),
        "# clean\nstaged\nunstaged\n"
    );
    assert_eq!(std::fs::read_dir(git_dir.join("gitx")).unwrap().count(), 0);
}

#[tokio::test]
async fn partial_commit_can_create_the_first_commit() {
    let repo = FixtureBuilder::new().build("empty").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    std::fs::write(cwd.join("new.txt"), "selected\nremaining\n").unwrap();
    runner
        .commit_create_ex(
            cwd,
            "first selected line",
            false,
            false,
            None,
            Some(&[gitx_core::PartialFileSelection {
                path: "new.txt".into(),
                selected_lines: vec![1],
            }]),
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(
        git_text(&runner, cwd, &["show", "HEAD:new.txt"]).await,
        "selected\n"
    );
    assert!(git_text(&runner, cwd, &["diff", "--", "new.txt"])
        .await
        .contains("+remaining"));
}

#[tokio::test]
async fn line_stage_only_selected_lines() {
    let repo = FixtureBuilder::new().build("clean").expect("fixture");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();

    std::fs::write(cwd.join("README.md"), "# clean\nline-a\nline-b\nline-c\n").unwrap();

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
    assert!(state
        .assignments
        .iter()
        .any(|a| a.path == "README.md" && a.list_id == feature_id));

    let reloaded = gitx_meta::load_changelists(&git_dir).unwrap();
    assert_eq!(reloaded.lists.len(), 2);
    assert!(reloaded.assignments.iter().any(|a| a.path == "README.md"));
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
async fn stash_reports_no_changes_and_respects_untracked_option() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    git_text(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    for untracked_only in [false, true] {
        if untracked_only {
            std::fs::write(cwd.join("new.txt"), "untracked content\n").unwrap();
        }
        let error = runner
            .stash_create(cwd, "empty", false, false, None, &cancel)
            .await
            .unwrap_err();
        assert_eq!(error.code, gitx_core::ErrorCode::NothingToCommit);
        assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
    }
    runner
        .stash_create(cwd, "中文说明\nsecond line", false, true, None, &cancel)
        .await
        .unwrap();
    let entries = runner.stash_list(cwd, &cancel).await.unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].message.contains("中文说明"));
    assert!(!cwd.join("new.txt").exists());
    runner
        .stash_apply(cwd, &entries[0].sha, false, &cancel)
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(cwd.join("new.txt")).unwrap(),
        "untracked content\n"
    );
}

#[tokio::test]
async fn stash_sha_survives_reordering_and_drop_keeps_a_backup() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    git_text(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(cwd.join("README.md"), "first stash\n").unwrap();
    runner
        .stash_create(cwd, "first", false, false, None, &cancel)
        .await
        .unwrap();
    let first = runner.stash_list(cwd, &cancel).await.unwrap()[0]
        .sha
        .clone();
    std::fs::write(cwd.join("README.md"), "second stash\n").unwrap();
    runner
        .stash_create(cwd, "second", false, false, None, &cancel)
        .await
        .unwrap();
    let error = runner
        .stash_apply(cwd, "", false, &cancel)
        .await
        .unwrap_err();
    assert_eq!(error.code, gitx_core::ErrorCode::InvalidArgument);
    runner
        .stash_apply(cwd, &first, false, &cancel)
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(cwd.join("README.md")).unwrap(),
        "first stash\n"
    );
    runner.stash_drop(cwd, &first, &cancel).await.unwrap();
    let entries = runner.stash_list(cwd, &cancel).await.unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].message.contains("second"));
    assert_eq!(
        git_text(
            &runner,
            cwd,
            &["rev-parse", &format!("refs/gitx/backup/stash-{first}")]
        )
        .await
        .trim(),
        first
    );
    assert!(runner.stash_drop(cwd, &first, &cancel).await.is_err());
    assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap().len(), 1);
}

#[tokio::test]
async fn stash_index_failure_is_not_retried_and_keeps_the_stash() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "saved staged change\n").unwrap();
    runner
        .stage_paths(cwd, &["README.md".into()], &cancel)
        .await
        .unwrap();
    runner
        .stash_create(cwd, "staged", false, false, None, &cancel)
        .await
        .unwrap();
    let sha = runner.stash_list(cwd, &cancel).await.unwrap()[0]
        .sha
        .clone();
    std::fs::write(cwd.join("README.md"), "current staged change\n").unwrap();
    runner
        .stage_paths(cwd, &["README.md".into()], &cancel)
        .await
        .unwrap();
    let before = git_text(&runner, cwd, &["diff", "--cached"]).await;
    let error = runner
        .stash_pop(cwd, &sha, true, &cancel)
        .await
        .unwrap_err();
    assert!(error.command.unwrap_or_default().contains("--index"));
    assert_eq!(git_text(&runner, cwd, &["diff", "--cached"]).await, before);
    assert_eq!(
        std::fs::read_to_string(cwd.join("README.md")).unwrap(),
        "current staged change\n"
    );
    assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap()[0].sha, sha);
}

#[tokio::test]
async fn stash_is_not_dropped_when_its_backup_cannot_be_written() {
    let repo = FixtureBuilder::new().build("dirty").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    runner
        .stash_create(cwd, "keep me", false, false, None, &cancel)
        .await
        .unwrap();
    let sha = runner.stash_list(cwd, &cancel).await.unwrap()[0]
        .sha
        .clone();
    let dir = runner
        .git_dir(cwd, &cancel)
        .await
        .unwrap()
        .join("refs/gitx/backup");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(format!("stash-{sha}.lock")), "test lock").unwrap();
    assert!(runner.stash_drop(cwd, &sha, &cancel).await.is_err());
    assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap()[0].sha, sha);
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
async fn shelve_reports_empty_work_and_restore_errors_instead_of_success() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    let empty = runner
        .shelve_changes(
            cwd,
            "empty",
            &["README.md".into()],
            false,
            None,
            false,
            &cancel,
        )
        .await
        .unwrap_err();
    assert_eq!(empty.code, gitx_core::ErrorCode::NothingToCommit);
    assert!(runner.shelf_list(cwd, &cancel).await.unwrap().is_empty());
    std::fs::write(cwd.join("README.md"), "keep on failure\n").unwrap();
    let lock = runner
        .git_dir(cwd, &cancel)
        .await
        .unwrap()
        .join("index.lock");
    std::fs::write(lock, "test lock").unwrap();
    assert!(runner
        .shelve_changes(
            cwd,
            "saved but not restored",
            &["README.md".into()],
            false,
            None,
            false,
            &cancel
        )
        .await
        .is_err());
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        b"keep on failure\n"
    );
    assert_eq!(runner.shelf_list(cwd, &cancel).await.unwrap().len(), 1);
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
async fn shelf_roundtrip_before_the_first_commit_preserves_the_initial_files() {
    let temp = tempfile::tempdir().unwrap();
    let cwd = temp.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    git_text(&runner, cwd, &["init", "-b", "main"]).await;
    git_text(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(cwd.join("first.txt"), b"before first commit\n").unwrap();
    runner
        .stage_paths(cwd, &["first.txt".into()], &cancel)
        .await
        .unwrap();
    let entry = runner
        .shelve_changes(
            cwd,
            "initial work",
            &["first.txt".into()],
            false,
            None,
            false,
            &cancel,
        )
        .await
        .unwrap();
    assert!(!cwd.join("first.txt").exists());
    assert!(git_text(&runner, cwd, &["status", "--porcelain"])
        .await
        .is_empty());
    runner
        .unshelve(cwd, &entry.id, false, &cancel)
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(cwd.join("first.txt")).unwrap(),
        b"before first commit\n"
    );
    assert_eq!(
        git_text(&runner, cwd, &["show", ":first.txt"]).await,
        "before first commit\n"
    );
    assert_eq!(
        runner.shelf_list(cwd, &cancel).await.unwrap()[0].id,
        entry.id
    );
    assert!(
        runner
            .run(
                gitx_git::GitInvocation::new(cwd, ["rev-parse", "--verify", "HEAD"]),
                &cancel,
            )
            .await
            .is_err(),
        "shelving must not create the first commit"
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
        status.files.iter().any(|f| f.path == "README.md"
            && (f.index_status == "D" || f.kind == gitx_core::FileChangeKind::Deleted)),
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
    assert!(
        names.contains("a.txt"),
        "commit should include a.txt: {names}"
    );
    assert!(
        !names.contains("b.txt"),
        "commit should not include b.txt: {names}"
    );
    assert!(
        !names.contains("README.md"),
        "commit should not include README: {names}"
    );
}
