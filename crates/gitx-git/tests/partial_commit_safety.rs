//! The partial-commit transaction must not damage an existing index or blobs.
use gitx_core::PartialFileSelection;
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

async fn commit(
    cwd: &Path,
    path: &str,
    lines: &[u32],
) -> Result<gitx_core::CommitResult, gitx_core::AppError> {
    GitRunner::new("git")
        .commit_create_ex(
            cwd,
            "selected change",
            false,
            false,
            None,
            Some(&[PartialFileSelection {
                path: path.into(),
                selected_lines: lines.to_vec(),
            }]),
            &CancellationToken::new(),
        )
        .await
}

#[tokio::test]
async fn index_lock_rejects_before_creating_a_commit() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\n").unwrap();
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let index = std::fs::read(cwd.join(".git/index")).unwrap();
    std::fs::write(cwd.join(".git/index.lock"), b"other client").unwrap();
    let result = commit(cwd, "README.md", &[2]).await;
    assert_eq!(
        git(cwd, &["rev-parse", "HEAD"]).await,
        head,
        "locked index must prevent HEAD advancing"
    );
    assert!(result.is_err());
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(
        std::fs::read(cwd.join(".git/index.lock")).unwrap(),
        b"other client"
    );
}

#[tokio::test]
async fn same_file_unselected_staged_changes_remain_staged() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let base = (0..30).map(|i| format!("line {i}\n")).collect::<String>();
    std::fs::write(cwd.join("README.md"), &base).unwrap();
    git(cwd, &["add", "README.md"]).await;
    git(cwd, &["commit", "-m", "base"]).await;
    let staged = base.replace("line 2\n", "keep staged\n");
    std::fs::write(cwd.join("README.md"), &staged).unwrap();
    git(cwd, &["add", "README.md"]).await;
    let work = staged.replace("line 25\n", "selected\n");
    std::fs::write(cwd.join("README.md"), &work).unwrap();
    let result = commit(cwd, "README.md", &[26]).await.unwrap();
    assert!(result.warning.is_none(), "{:?}", result.warning);
    assert_eq!(
        git(cwd, &["show", "HEAD:README.md"]).await,
        base.replace("line 25\n", "selected\n").as_bytes()
    );
    assert_eq!(
        git(cwd, &["show", ":README.md"]).await,
        work.as_bytes(),
        "unselected staged change must not be reset away"
    );
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        work.as_bytes()
    );
}

#[tokio::test]
async fn invalid_utf8_is_rejected_without_lossy_commit() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let bytes = b"# clean\n\xff selected\n";
    std::fs::write(cwd.join("README.md"), bytes).unwrap();
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let index = std::fs::read(cwd.join(".git/index")).unwrap();
    assert!(
        commit(cwd, "README.md", &[2]).await.is_err(),
        "non UTF-8 must not be replacement-decoded into a commit"
    );
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(std::fs::read(cwd.join("README.md")).unwrap(), bytes);
}

#[tokio::test]
async fn preparation_failure_cleans_temporary_index() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\n").unwrap();
    std::fs::write(cwd.join(".gitattributes"), "README.md filter=reject\n").unwrap();
    git(cwd, &["config", "filter.reject.clean", "false"]).await;
    git(cwd, &["config", "filter.reject.required", "true"]).await;
    assert!(commit(cwd, "README.md", &[2]).await.is_err());
    let leftovers = std::fs::read_dir(cwd.join(".git/gitx"))
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect::<Vec<_>>();
    assert!(
        leftovers.is_empty(),
        "temporary state leaked: {leftovers:?}"
    );
}

#[tokio::test]
async fn stale_line_numbers_are_rejected_even_when_another_line_is_valid() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\n").unwrap();
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    assert!(commit(cwd, "README.md", &[2, 900]).await.is_err());
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
}

fn hook(cwd: &Path, name: &str, script: &str) {
    let file = cwd.join(".git/hooks").join(name);
    std::fs::write(&file, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

fn assert_clean_temporary(cwd: &Path) {
    assert!(!cwd.join(".git/index.lock").exists());
    if let Ok(entries) = std::fs::read_dir(cwd.join(".git/gitx")) {
        assert_eq!(entries.count(), 0);
    }
}

#[tokio::test]
async fn overlapping_staged_content_is_rejected_before_commit() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "staged replacement\n").unwrap();
    git(cwd, &["add", "README.md"]).await;
    std::fs::write(cwd.join("README.md"), "different selected replacement\n").unwrap();
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let index = std::fs::read(cwd.join(".git/index")).unwrap();
    let result = commit(cwd, "README.md", &[1]).await.unwrap_err();
    assert!(result.message.contains("overlap"), "{}", result.message);
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_clean_temporary(cwd);
}

#[tokio::test]
async fn selecting_already_staged_content_keeps_remaining_worktree_edits() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\n").unwrap();
    git(cwd, &["add", "README.md"]).await;
    std::fs::write(cwd.join("README.md"), "# clean\nselected\nremaining\n").unwrap();
    let result = commit(cwd, "README.md", &[2]).await.unwrap();
    assert!(result.warning.is_none());
    assert_eq!(
        git(cwd, &["show", "HEAD:README.md"]).await,
        b"# clean\nselected\n"
    );
    assert_eq!(
        git(cwd, &["show", ":README.md"]).await,
        b"# clean\nselected\n"
    );
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        b"# clean\nselected\nremaining\n"
    );
    assert_clean_temporary(cwd);
}

#[tokio::test]
async fn crlf_and_missing_final_newline_are_preserved_exactly() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(cwd.join(".gitattributes"), "README.md -text\n").unwrap();
    let base = "first\r\nsecond\r\nlast";
    std::fs::write(cwd.join("README.md"), base).unwrap();
    git(cwd, &["add", "README.md", ".gitattributes"]).await;
    git(cwd, &["commit", "-m", "exact base"]).await;
    let work = "selected\r\nsecond\r\nremaining";
    std::fs::write(cwd.join("README.md"), work).unwrap();
    assert!(commit(cwd, "README.md", &[1])
        .await
        .unwrap()
        .warning
        .is_none());
    assert_eq!(
        git(cwd, &["show", "HEAD:README.md"]).await,
        b"selected\r\nsecond\r\nlast"
    );
    assert_eq!(
        git(cwd, &["show", ":README.md"]).await,
        b"selected\r\nsecond\r\nlast"
    );
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        work.as_bytes()
    );
    assert_clean_temporary(cwd);
}

#[tokio::test]
async fn empty_duplicate_and_mixed_selections_never_fall_back_to_full_index() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\n").unwrap();
    git(cwd, &["add", "README.md"]).await;
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let index = std::fs::read(cwd.join(".git/index")).unwrap();
    let selected = PartialFileSelection {
        path: "README.md".into(),
        selected_lines: vec![2],
    };
    for partial in [
        vec![],
        vec![PartialFileSelection {
            path: "README.md".into(),
            selected_lines: vec![],
        }],
        vec![selected.clone(), selected.clone()],
    ] {
        assert!(GitRunner::new("git")
            .commit_create_ex(
                cwd,
                "must reject",
                false,
                false,
                None,
                Some(&partial),
                &CancellationToken::new()
            )
            .await
            .is_err());
    }
    assert!(GitRunner::new("git")
        .commit_create_ex(
            cwd,
            "must reject",
            false,
            false,
            Some(&["README.md".into()]),
            Some(&[selected]),
            &CancellationToken::new()
        )
        .await
        .is_err());
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_clean_temporary(cwd);
}

#[tokio::test]
async fn binary_and_ignored_files_are_rejected_without_index_changes() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let index = std::fs::read(cwd.join(".git/index")).unwrap();
    std::fs::write(cwd.join("README.md"), b"# clean\n\0binary\n").unwrap();
    assert!(commit(cwd, "README.md", &[2]).await.is_err());
    std::fs::write(cwd.join(".gitignore"), "private.txt\n").unwrap();
    std::fs::write(cwd.join("private.txt"), "ignored\n").unwrap();
    assert!(commit(cwd, "private.txt", &[1]).await.is_err());
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_clean_temporary(cwd);
}

#[tokio::test]
async fn hook_changes_to_prepared_tree_report_success_with_recovery_warning() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\n").unwrap();
    let index = std::fs::read(cwd.join(".git/index")).unwrap();
    hook(
        cwd,
        "pre-commit",
        "#!/bin/sh\nprintf 'hook content\\n' > hook.txt\ngit add hook.txt\n",
    );
    let result = commit(cwd, "README.md", &[2]).await.unwrap();
    assert!(result.warning.as_deref().unwrap().contains("hook changed"));
    assert_eq!(
        git(cwd, &["rev-parse", "HEAD"]).await,
        format!("{}\n", result.sha).as_bytes()
    );
    assert_eq!(
        git(cwd, &["show", "HEAD:hook.txt"]).await,
        b"hook content\n"
    );
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index);
    assert!(!cwd.join(".git/index.lock").exists());
    let recovery = std::fs::read_dir(cwd.join(".git/gitx"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(
        std::fs::read(recovery.join("original-index")).unwrap(),
        index
    );
    assert!(recovery.join("commit-index").exists());
}

#[tokio::test]
async fn hook_worktree_edits_remain_uncommitted_when_hook_does_not_stage_them() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\n").unwrap();
    hook(
        cwd,
        "pre-commit",
        "#!/bin/sh\nprintf 'formatted worktree\\n' > README.md\n",
    );
    assert!(commit(cwd, "README.md", &[2])
        .await
        .unwrap()
        .warning
        .is_none());
    assert_eq!(
        git(cwd, &["show", "HEAD:README.md"]).await,
        b"# clean\nselected\n"
    );
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        b"formatted worktree\n"
    );
    assert_clean_temporary(cwd);
}

async fn wait_for_file(path: &Path) {
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        while !path.exists() {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("hook start marker");
}

#[tokio::test]
async fn cancellation_and_concurrent_request_preserve_index_and_release_lock() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\n").unwrap();
    hook(
        cwd,
        "pre-commit",
        "#!/bin/sh\nprintf started > hook-started\nsleep 60\n",
    );
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let index = std::fs::read(cwd.join(".git/index")).unwrap();
    let cancel = CancellationToken::new();
    let task_cancel = cancel.clone();
    let task_cwd = cwd.to_path_buf();
    let task = tokio::spawn(async move {
        GitRunner::new("git")
            .commit_create_ex(
                &task_cwd,
                "first message",
                false,
                false,
                None,
                Some(&[PartialFileSelection {
                    path: "README.md".into(),
                    selected_lines: vec![2],
                }]),
                &task_cancel,
            )
            .await
    });
    wait_for_file(&cwd.join("hook-started")).await;
    assert!(commit(cwd, "README.md", &[2]).await.is_err());
    cancel.cancel();
    let outcome = tokio::time::timeout(std::time::Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    assert!(outcome.is_err());
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_clean_temporary(cwd);
}

#[tokio::test]
async fn cancellation_after_commit_does_not_report_a_retryable_commit_failure() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\n").unwrap();
    hook(
        cwd,
        "post-commit",
        "#!/bin/sh\nprintf started > hook-started\nsleep 60\n",
    );
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let index = std::fs::read(cwd.join(".git/index")).unwrap();
    let cancel = CancellationToken::new();
    let task_cancel = cancel.clone();
    let task_cwd = cwd.to_path_buf();
    let task = tokio::spawn(async move {
        GitRunner::new("git")
            .commit_create_ex(
                &task_cwd,
                "committed before cancel",
                false,
                false,
                None,
                Some(&[PartialFileSelection {
                    path: "README.md".into(),
                    selected_lines: vec![2],
                }]),
                &task_cancel,
            )
            .await
    });
    wait_for_file(&cwd.join("hook-started")).await;
    cancel.cancel();
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(result
        .warning
        .as_deref()
        .unwrap()
        .contains("before another commit"));
    assert_ne!(git(cwd, &["rev-parse", "HEAD"]).await, head);
    assert_eq!(
        git(cwd, &["show", "HEAD:README.md"]).await,
        b"# clean\nselected\n"
    );
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index);
    assert!(!cwd.join(".git/index.lock").exists());
}

#[tokio::test]
async fn multiple_files_and_amend_commit_only_selected_lines() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\nremaining\n").unwrap();
    std::fs::write(cwd.join("new.txt"), "selected new\nremaining new\n").unwrap();
    let result = GitRunner::new("git")
        .commit_create_ex(
            cwd,
            "amended selected",
            true,
            false,
            None,
            Some(&[
                PartialFileSelection {
                    path: "README.md".into(),
                    selected_lines: vec![2],
                },
                PartialFileSelection {
                    path: "new.txt".into(),
                    selected_lines: vec![1],
                },
            ]),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(result.amended);
    assert!(result.warning.is_none());
    assert_eq!(git(cwd, &["rev-list", "--count", "HEAD"]).await, b"1\n");
    assert_eq!(
        git(cwd, &["show", "HEAD:README.md"]).await,
        b"# clean\nselected\n"
    );
    assert_eq!(git(cwd, &["show", "HEAD:new.txt"]).await, b"selected new\n");
    assert_eq!(
        std::fs::read(cwd.join("new.txt")).unwrap(),
        b"selected new\nremaining new\n"
    );
    assert_clean_temporary(cwd);
}

#[tokio::test]
async fn literal_path_with_spaces_and_brackets_selects_only_that_file() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("a [b].txt"), "selected\nremaining\n").unwrap();
    std::fs::write(cwd.join("a b.txt"), "unrelated\n").unwrap();
    assert!(commit(cwd, "a [b].txt", &[1])
        .await
        .unwrap()
        .warning
        .is_none());
    assert_eq!(git(cwd, &["show", "HEAD:a [b].txt"]).await, b"selected\n");
    assert_eq!(
        git(
            cwd,
            &["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]
        )
        .await,
        b"a [b].txt\n"
    );
    assert_clean_temporary(cwd);
}

#[tokio::test]
async fn index_changed_by_a_hook_is_not_overwritten() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\n").unwrap();
    hook(
        cwd,
        "post-commit",
        "#!/bin/sh\nprintf 'external index replacement' > .git/index\n",
    );
    let result = commit(cwd, "README.md", &[2]).await.unwrap();
    assert!(result
        .warning
        .as_deref()
        .unwrap()
        .contains("real index changed"));
    assert_eq!(
        std::fs::read(cwd.join(".git/index")).unwrap(),
        b"external index replacement"
    );
    assert_eq!(
        git(cwd, &["show", "HEAD:README.md"]).await,
        b"# clean\nselected\n"
    );
    assert!(!cwd.join(".git/index.lock").exists());
}

#[tokio::test]
async fn no_verify_bypasses_rejecting_hook_and_cleans_transaction() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\n").unwrap();
    hook(
        cwd,
        "pre-commit",
        "#!/bin/sh\necho 'pre-commit hook rejects test' >&2\nexit 1\n",
    );
    assert_eq!(
        commit(cwd, "README.md", &[2]).await.unwrap_err().code,
        gitx_core::ErrorCode::HookFailed
    );
    assert_clean_temporary(cwd);
    let result = GitRunner::new("git")
        .commit_create_ex(
            cwd,
            "skip hook",
            false,
            true,
            None,
            Some(&[PartialFileSelection {
                path: "README.md".into(),
                selected_lines: vec![2],
            }]),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(result.warning.is_none());
    assert_eq!(
        git(cwd, &["show", "HEAD:README.md"]).await,
        b"# clean\nselected\n"
    );
    assert_clean_temporary(cwd);
}

#[tokio::test]
async fn wsl_partial_commit_is_rejected_before_using_a_native_index_path() {
    for (runner, cwd) in [
        (
            GitRunner::new("git").with_wsl("NonexistentTestDistro"),
            Path::new("C:/never-open-test"),
        ),
        (
            GitRunner::new("git"),
            Path::new(r"\\wsl.localhost\NonexistentTestDistro\repo"),
        ),
        (
            GitRunner::new("wsl.exe -d NonexistentTestDistro git"),
            Path::new("C:/never-open-test"),
        ),
    ] {
        let error = runner
            .commit_create_ex(
                cwd,
                "must reject",
                false,
                false,
                None,
                Some(&[PartialFileSelection {
                    path: "file.txt".into(),
                    selected_lines: vec![1],
                }]),
                &CancellationToken::new(),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, gitx_core::ErrorCode::InvalidArgument);
        assert!(error.message.contains("WSL"), "{}", error.message);
    }
}

#[tokio::test]
async fn split_index_keeps_other_staged_files_after_partial_commit() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("README.md"), "# clean\nselected\nremaining\n").unwrap();
    std::fs::write(cwd.join("other.txt"), "keep staged\n").unwrap();
    git(cwd, &["add", "other.txt"]).await;
    git(cwd, &["update-index", "--split-index"]).await;
    assert!(commit(cwd, "README.md", &[2])
        .await
        .unwrap()
        .warning
        .is_none());
    assert_eq!(
        git(cwd, &["show", "HEAD:README.md"]).await,
        b"# clean\nselected\n"
    );
    assert_eq!(git(cwd, &["show", ":other.txt"]).await, b"keep staged\n");
    assert_eq!(
        git(cwd, &["diff", "--cached", "--name-only"]).await,
        b"other.txt\n"
    );
    assert_clean_temporary(cwd);
}
