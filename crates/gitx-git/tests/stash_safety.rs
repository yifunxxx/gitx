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
    assert!(runner.stash_clear(cwd, &cancel).await.is_err());
    assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap()[0].sha, sha);
    assert!(runner.stash_pop(cwd, &sha, false, &cancel).await.is_err());
    assert!(git_text(&runner, cwd, &["diff"]).await.is_empty());
}

#[tokio::test]
async fn selected_stash_paths_are_literal_and_empty_selection_never_stashes_all() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    git_text(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    for name in ["part[1].txt", "part1.txt"] {
        std::fs::write(cwd.join(name), "original\n").unwrap();
    }
    git_text(&runner, cwd, &["add", "-A"]).await;
    git_text(&runner, cwd, &["commit", "-m", "files"]).await;
    for name in ["part[1].txt", "part1.txt"] {
        std::fs::write(cwd.join(name), "edited\n").unwrap();
    }
    assert_eq!(
        runner
            .stash_create(cwd, "empty", false, false, Some(&[]), &cancel)
            .await
            .unwrap_err()
            .code,
        gitx_core::ErrorCode::NothingToCommit
    );
    for path in ["", ".", "../outside", "a\0b", "/absolute"] {
        assert_eq!(
            runner
                .stash_create(cwd, "invalid", false, false, Some(&[path.into()]), &cancel)
                .await
                .unwrap_err()
                .code,
            gitx_core::ErrorCode::InvalidArgument
        );
    }
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
    runner
        .stash_create(
            cwd,
            "one file",
            false,
            false,
            Some(&["part[1].txt".into()]),
            &cancel,
        )
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(cwd.join("part[1].txt")).unwrap(),
        "original\n"
    );
    assert_eq!(
        std::fs::read_to_string(cwd.join("part1.txt")).unwrap(),
        "edited\n"
    );
    let sha = runner.stash_list(cwd, &cancel).await.unwrap()[0]
        .sha
        .clone();
    runner.stash_apply(cwd, &sha, false, &cancel).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(cwd.join("part[1].txt")).unwrap(),
        "edited\n"
    );
}

#[tokio::test]
async fn stash_keep_index_and_restore_index_are_explicit() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    git_text(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(cwd.join("README.md"), "staged\n").unwrap();
    runner
        .stage_paths(cwd, &["README.md".into()], &cancel)
        .await
        .unwrap();
    std::fs::write(cwd.join("README.md"), "staged\nunstaged\n").unwrap();
    runner
        .stash_create(cwd, "keep staged", true, false, None, &cancel)
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(cwd.join("README.md")).unwrap(),
        "staged\n"
    );
    assert!(git_text(&runner, cwd, &["diff", "--cached"])
        .await
        .contains("+staged"));
    let sha = runner.stash_list(cwd, &cancel).await.unwrap()[0]
        .sha
        .clone();
    git_text(&runner, cwd, &["reset", "--hard", "HEAD"]).await;
    runner.stash_pop(cwd, &sha, true, &cancel).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(cwd.join("README.md")).unwrap(),
        "staged\nunstaged\n"
    );
    let cached = git_text(&runner, cwd, &["diff", "--cached"]).await;
    assert!(cached.contains("+staged"));
    assert!(!cached.contains("+unstaged"));
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
    runner
        .stash_restore_from_backup(cwd, &sha, "restored", &cancel)
        .await
        .unwrap();
    assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap()[0].sha, sha);
}

// A real Git hook inserts a stash precisely between the backup and deletion,
// without sleeps or timing-dependent concurrent test processes.
async fn inject_stash_on_backup(runner: &GitRunner, cwd: &std::path::Path, sha: &str) {
    let dir = runner
        .git_dir(cwd, &CancellationToken::new())
        .await
        .unwrap();
    let hook = dir.join("hooks/reference-transaction");
    let body = format!("#!/bin/sh\n[ \"$1\" = committed ] || exit 0\nwhile read old new ref; do\ncase \"$ref\" in\nrefs/gitx/backup/*)\n if [ ! -f \"{}/injected\" ]; then\n touch \"{}/injected\"\n git stash store -m injected {}\n fi\n ;;\nesac\ndone\n", dir.to_string_lossy().replace('\\', "/"), dir.to_string_lossy().replace('\\', "/"), sha);
    std::fs::write(&hook, body).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[tokio::test]
async fn drop_re_resolves_after_backup_and_clear_rejects_an_unbacked_tip() {
    for clear in [false, true] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let cwd = repo.path();
        std::fs::write(cwd.join("README.md"), "external\n").unwrap();
        runner
            .stash_create(cwd, "external", false, false, None, &cancel)
            .await
            .unwrap();
        let external = runner.stash_list(cwd, &cancel).await.unwrap()[0]
            .sha
            .clone();
        git_text(&runner, cwd, &["stash", "drop"]).await;
        std::fs::write(cwd.join("README.md"), "target\n").unwrap();
        runner
            .stash_create(cwd, "target", false, false, None, &cancel)
            .await
            .unwrap();
        let target = runner.stash_list(cwd, &cancel).await.unwrap()[0]
            .sha
            .clone();
        inject_stash_on_backup(&runner, cwd, &external).await;
        if clear {
            assert!(runner.stash_clear(cwd, &cancel).await.is_err());
            assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap().len(), 2);
        } else {
            runner.stash_drop(cwd, &target, &cancel).await.unwrap();
            assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap().len(), 1);
        }
        assert_eq!(
            runner.stash_list(cwd, &cancel).await.unwrap()[0].sha,
            external
        );
    }
}

#[tokio::test]
async fn stash_branch_uses_the_requested_object_and_keeps_a_backup() {
    let repo = FixtureBuilder::new().build("dirty").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    runner
        .stash_create(cwd, "branch", false, false, None, &cancel)
        .await
        .unwrap();
    let sha = runner.stash_list(cwd, &cancel).await.unwrap()[0]
        .sha
        .clone();
    assert!(runner
        .stash_branch(cwd, "--help", &sha, &cancel)
        .await
        .is_err());
    assert!(runner
        .stash_restore_from_backup(cwd, "--help", "invalid", &cancel)
        .await
        .is_err());
    runner
        .stash_branch(cwd, "from-stash", &sha, &cancel)
        .await
        .unwrap();
    assert_eq!(
        git_text(&runner, cwd, &["branch", "--show-current"])
            .await
            .trim(),
        "from-stash"
    );
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
    assert!(!git_text(&runner, cwd, &["diff", "HEAD"]).await.is_empty());
    assert_eq!(
        git_text(
            &runner,
            cwd,
            &["rev-parse", &format!("refs/gitx/backup/stash-{sha}")]
        )
        .await
        .trim(),
        sha
    );
}

#[tokio::test]
async fn clear_preserves_every_object_for_restore_and_can_be_repeated() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    for message in ["first", "second"] {
        std::fs::write(cwd.join("README.md"), message).unwrap();
        runner
            .stash_create(cwd, message, false, false, None, &cancel)
            .await
            .unwrap();
    }
    let entries = runner.stash_list(cwd, &cancel).await.unwrap();
    runner.stash_clear(cwd, &cancel).await.unwrap();
    assert!(runner.stash_list(cwd, &cancel).await.unwrap().is_empty());
    runner.stash_clear(cwd, &cancel).await.unwrap();
    for entry in entries {
        assert_eq!(
            git_text(
                &runner,
                cwd,
                &[
                    "rev-parse",
                    &format!("refs/gitx/backup/stash-{}", entry.sha)
                ]
            )
            .await
            .trim(),
            entry.sha
        );
        runner
            .stash_restore_from_backup(cwd, &entry.sha, &entry.message, &cancel)
            .await
            .unwrap();
    }
    assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap().len(), 2);
}

#[tokio::test]
async fn pop_conflicts_remain_visible_and_keep_the_saved_stash() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "saved side\n").unwrap();
    runner
        .stash_create(cwd, "saved", false, false, None, &cancel)
        .await
        .unwrap();
    let sha = runner.stash_list(cwd, &cancel).await.unwrap()[0]
        .sha
        .clone();
    std::fs::write(cwd.join("README.md"), "committed side\n").unwrap();
    git_text(&runner, cwd, &["add", "README.md"]).await;
    git_text(&runner, cwd, &["commit", "-m", "divergent change"]).await;
    assert!(runner.stash_pop(cwd, &sha, false, &cancel).await.is_err());
    assert!(!git_text(&runner, cwd, &["ls-files", "-u"]).await.is_empty());
    let content = std::fs::read_to_string(cwd.join("README.md")).unwrap();
    assert!(content.contains("saved side"));
    assert!(content.contains("committed side"));
    assert_eq!(runner.stash_list(cwd, &cancel).await.unwrap()[0].sha, sha);
}

#[tokio::test]
async fn stash_apply_index_failure_is_not_retried() {
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
        .stash_apply(cwd, &sha, true, &cancel)
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
