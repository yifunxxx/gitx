use gitx_core::{CommitResult, ErrorCode};
use gitx_git::{GitInvocation, GitRunner};
use gitx_testkit::FixtureBuilder;
use std::{fs, path::Path};
use tokio_util::sync::CancellationToken;

async fn git(cwd: &Path, args: &[&str]) -> String {
    let output = GitRunner::new("git")
        .run(
            GitInvocation::new(cwd, args.iter().copied()),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    String::from_utf8(output.stdout).unwrap()
}

async fn commit(cwd: &Path, path: &str) -> Result<CommitResult, gitx_core::AppError> {
    commit_paths(cwd, &[path]).await
}

async fn commit_paths(cwd: &Path, paths: &[&str]) -> Result<CommitResult, gitx_core::AppError> {
    GitRunner::new("git")
        .commit_create_ex(
            cwd,
            "selected entry",
            false,
            false,
            Some(&paths.iter().map(|path| (*path).into()).collect::<Vec<_>>()),
            None,
            &CancellationToken::new(),
        )
        .await
}

async fn stage_unrelated(cwd: &Path) {
    fs::write(cwd.join("unrelated.txt"), "unrelated staged\n").unwrap();
    git(cwd, &["add", "unrelated.txt"]).await;
    fs::write(cwd.join("unrelated.txt"), "unrelated worktree\n").unwrap();
}

async fn assert_unrelated_preserved(cwd: &Path) {
    assert_eq!(
        git(cwd, &["show", ":unrelated.txt"]).await,
        "unrelated staged\n"
    );
    assert_eq!(
        fs::read(cwd.join("unrelated.txt")).unwrap(),
        b"unrelated worktree\n"
    );
    assert_eq!(
        git(cwd, &["diff", "--cached", "--name-only"]).await,
        "unrelated.txt\n"
    );
}

#[tokio::test]
async fn selected_deletion_and_rename_keep_unrelated_staging() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    fs::write(cwd.join("deleted.txt"), "delete me\n").unwrap();
    fs::write(cwd.join("old.txt"), "rename me\n").unwrap();
    git(cwd, &["add", "deleted.txt", "old.txt"]).await;
    git(cwd, &["commit", "-m", "path baseline"]).await;
    fs::remove_file(cwd.join("deleted.txt")).unwrap();
    fs::rename(cwd.join("old.txt"), cwd.join("new.txt")).unwrap();
    // Include already-staged deletion/rename, not only unstaged counterparts.
    git(
        cwd,
        &["add", "-A", "--", "deleted.txt", "old.txt", "new.txt"],
    )
    .await;
    stage_unrelated(cwd).await;

    let result = commit_paths(cwd, &["deleted.txt", "old.txt", "new.txt"])
        .await
        .unwrap();
    assert!(result.warning.is_none(), "{:?}", result.warning);
    assert_eq!(
        git(
            cwd,
            &["ls-tree", "--name-only", "HEAD", "deleted.txt", "old.txt"]
        )
        .await,
        ""
    );
    assert_eq!(git(cwd, &["show", "HEAD:new.txt"]).await, "rename me\n");
    assert_unrelated_preserved(cwd).await;
}

#[tokio::test]
async fn selected_file_directory_transitions_preserve_unrelated_staging() {
    for directory_to_file in [false, true] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        if directory_to_file {
            fs::create_dir(cwd.join("entry")).unwrap();
            fs::write(cwd.join("entry/child.txt"), "child baseline\n").unwrap();
        } else {
            fs::write(cwd.join("entry"), "file baseline\n").unwrap();
        }
        git(cwd, &["add", "entry"]).await;
        git(cwd, &["commit", "-m", "type baseline"]).await;
        if directory_to_file {
            fs::remove_file(cwd.join("entry/child.txt")).unwrap();
            fs::remove_dir(cwd.join("entry")).unwrap();
            fs::write(cwd.join("entry"), "replacement file\n").unwrap();
        } else {
            fs::remove_file(cwd.join("entry")).unwrap();
            fs::create_dir(cwd.join("entry")).unwrap();
            fs::write(cwd.join("entry/child.txt"), "replacement child\n").unwrap();
        }
        stage_unrelated(cwd).await;
        // Status exposes both the removed path and its replacement child/parent.
        let result = commit_paths(cwd, &["entry", "entry/child.txt"])
            .await
            .unwrap();
        assert!(result.warning.is_none(), "{:?}", result.warning);
        let (path, contents) = if directory_to_file {
            ("HEAD:entry", "replacement file\n")
        } else {
            ("HEAD:entry/child.txt", "replacement child\n")
        };
        assert_eq!(git(cwd, &["show", path]).await, contents);
        assert_unrelated_preserved(cwd).await;
    }
}

#[tokio::test]
async fn selected_binary_file_keeps_exact_bytes_and_unrelated_staging() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let contents = b"binary\0\xff\xfe\n";
    fs::write(cwd.join("selected.bin"), contents).unwrap();
    stage_unrelated(cwd).await;
    let result = commit(cwd, "selected.bin").await.unwrap();
    assert!(result.warning.is_none(), "{:?}", result.warning);
    let committed = GitRunner::new("git")
        .run(
            GitInvocation::new(cwd, ["show", "HEAD:selected.bin"]),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(committed.stdout, contents);
    assert_eq!(fs::read(cwd.join("selected.bin")).unwrap(), contents);
    assert_unrelated_preserved(cwd).await;
}

#[tokio::test]
async fn selected_directory_includes_tracked_and_untracked_children_only() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    fs::create_dir(cwd.join("folder")).unwrap();
    fs::write(cwd.join("folder/old.txt"), "delete me\n").unwrap();
    fs::write(cwd.join("folder/edited.txt"), "baseline\n").unwrap();
    fs::write(cwd.join(".gitignore"), "folder/ignored.txt\n").unwrap();
    git(cwd, &["add", ".gitignore", "folder"]).await;
    git(cwd, &["commit", "-m", "folder baseline"]).await;
    fs::remove_file(cwd.join("folder/old.txt")).unwrap();
    fs::write(cwd.join("folder/edited.txt"), "edited\n").unwrap();
    fs::write(cwd.join("folder/new.txt"), "new child\n").unwrap();
    fs::write(cwd.join("folder/ignored.txt"), "ignored local\n").unwrap();
    stage_unrelated(cwd).await;

    let result = commit(cwd, "folder").await.unwrap();
    assert!(result.warning.is_none(), "{:?}", result.warning);
    assert_eq!(
        git(cwd, &["ls-tree", "-r", "--name-only", "HEAD", "folder"]).await,
        "folder/edited.txt\nfolder/new.txt\n"
    );
    assert_eq!(
        git(cwd, &["show", "HEAD:folder/edited.txt"]).await,
        "edited\n"
    );
    assert_eq!(
        git(cwd, &["show", "HEAD:folder/new.txt"]).await,
        "new child\n"
    );
    assert_eq!(
        fs::read(cwd.join("folder/ignored.txt")).unwrap(),
        b"ignored local\n"
    );
    assert_unrelated_preserved(cwd).await;
}

#[tokio::test]
async fn clean_filter_result_is_shared_by_commit_and_published_index() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    fs::write(cwd.join(".gitattributes"), "selected.txt filter=count\n").unwrap();
    fs::write(
        cwd.join(".git/count-filter.sh"),
        "#!/bin/sh\nn=0\nif test -f .git/filter-count; then read n < .git/filter-count; fi\nn=$((n + 1))\nprintf '%s\\n' \"$n\" > .git/filter-count\nprintf 'filtered-%s\\n' \"$n\"\ncat\n",
    )
    .unwrap();
    git(
        cwd,
        &["config", "filter.count.clean", "sh .git/count-filter.sh"],
    )
    .await;
    git(cwd, &["config", "filter.count.required", "true"]).await;
    fs::write(cwd.join("selected.txt"), "worktree bytes\n").unwrap();
    fs::write(cwd.join("other.txt"), "other staged\n").unwrap();
    git(cwd, &["add", "other.txt"]).await;
    fs::write(cwd.join("other.txt"), "other working\n").unwrap();

    let result = commit(cwd, "selected.txt").await.unwrap();
    assert!(result.warning.is_none(), "{:?}", result.warning);
    assert_eq!(
        git(cwd, &["rev-parse", "HEAD:selected.txt"]).await,
        git(cwd, &["rev-parse", ":selected.txt"]).await,
        "the published index must contain the exact transformed blob that was committed"
    );
    assert_eq!(git(cwd, &["show", ":other.txt"]).await, "other staged\n");
    assert_eq!(
        fs::read(cwd.join("selected.txt")).unwrap(),
        b"worktree bytes\n"
    );
    assert_eq!(fs::read(cwd.join("other.txt")).unwrap(), b"other working\n");
    assert_eq!(
        git(cwd, &["diff", "--cached", "--name-only"]).await,
        "other.txt\n"
    );
}

async fn flagged_selection(flag: &str) {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["update-index", flag, "README.md"]).await;
    fs::write(cwd.join("README.md"), "selected hidden change\n").unwrap();
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let index = fs::read(cwd.join(".git/index")).unwrap();

    match commit(cwd, "README.md").await {
        Ok(result) => {
            assert!(result.warning.is_none(), "{:?}", result.warning);
            assert_eq!(
                git(cwd, &["show", "HEAD:README.md"]).await,
                "selected hidden change\n"
            );
            assert_eq!(
                git(cwd, &["rev-parse", "HEAD:README.md"]).await,
                git(cwd, &["rev-parse", ":README.md"]).await,
                "a successful explicit selection must not publish the stale flagged entry"
            );
            assert_eq!(git(cwd, &["diff", "--cached", "--name-only"]).await, "");
        }
        Err(_) => {
            // Sparse/assumed-clean entries may be conservatively rejected.
            assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
            assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        }
    }
    assert_eq!(
        fs::read(cwd.join("README.md")).unwrap(),
        b"selected hidden change\n"
    );
    assert!(!cwd.join(".git/index.lock").exists());
}

#[tokio::test]
async fn assume_unchanged_selection_never_publishes_a_stale_entry() {
    flagged_selection("--assume-unchanged").await;
}

#[tokio::test]
async fn skip_worktree_selection_never_publishes_a_stale_entry() {
    flagged_selection("--skip-worktree").await;
}

#[cfg(windows)]
#[tokio::test]
async fn case_insensitive_selection_keeps_the_canonical_index_entry_consistent() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.ignorecase", "true"]).await;
    fs::write(cwd.join("README.md"), "selected with another case\n").unwrap();
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let index = fs::read(cwd.join(".git/index")).unwrap();
    match commit(cwd, "readme.md").await {
        Ok(result) => {
            assert!(result.warning.is_none(), "{:?}", result.warning);
            assert_eq!(
                git(cwd, &["show", "HEAD:README.md"]).await,
                "selected with another case\n"
            );
            assert_eq!(
                git(cwd, &["rev-parse", "HEAD:README.md"]).await,
                git(cwd, &["rev-parse", ":README.md"]).await
            );
            assert_eq!(git(cwd, &["diff", "--cached", "--name-only"]).await, "");
        }
        Err(_) => {
            assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
            assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        }
    }
    assert_eq!(
        fs::read(cwd.join("README.md")).unwrap(),
        b"selected with another case\n"
    );
}

#[cfg(windows)]
#[tokio::test]
async fn case_colliding_index_entries_never_lose_the_unselected_staged_blob() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    // Git can contain both spellings even when the checkout filesystem cannot.
    // Construct the second entry from objects without creating another file.
    let blob = |contents: &'static [u8]| async move {
        let output = GitRunner::new("git")
            .run(
                GitInvocation::new(cwd, ["hash-object", "-w", "--stdin"]).stdin(contents.to_vec()),
                &CancellationToken::new(),
            )
            .await
            .unwrap();
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    };
    let lower_base = blob(b"lowercase baseline\n").await;
    git(
        cwd,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("100644,{lower_base},readme.md"),
        ],
    )
    .await;
    git(cwd, &["commit", "-m", "case collision baseline"]).await;
    assert_eq!(
        git(cwd, &["show", "HEAD:readme.md"]).await,
        "lowercase baseline\n"
    );
    let lower_staged = blob(b"unselected lowercase staged\n").await;
    git(
        cwd,
        &[
            "update-index",
            "--cacheinfo",
            &format!("100644,{lower_staged},readme.md"),
        ],
    )
    .await;
    fs::write(cwd.join("README.md"), "selected uppercase worktree\n").unwrap();
    let head = git(cwd, &["rev-parse", "HEAD"]).await;
    let index = fs::read(cwd.join(".git/index")).unwrap();

    match commit(cwd, "README.md").await {
        Ok(result) => {
            assert!(result.warning.is_none(), "{:?}", result.warning);
            assert_eq!(
                git(cwd, &["show", "HEAD:README.md"]).await,
                "selected uppercase worktree\n"
            );
            assert_eq!(
                git(cwd, &["show", "HEAD:readme.md"]).await,
                "lowercase baseline\n"
            );
            assert_eq!(git(cwd, &["show", ":readme.md"]).await, "unselected lowercase staged\n", "matching the selected uppercase path must not replace the unselected lowercase staged object");
        }
        Err(_) => {
            assert_eq!(git(cwd, &["rev-parse", "HEAD"]).await, head);
            assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        }
    }
    assert_eq!(
        fs::read(cwd.join("README.md")).unwrap(),
        b"selected uppercase worktree\n"
    );
}

#[tokio::test]
async fn selected_submodule_update_commits_the_gitlink_without_reading_a_directory() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let source = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let source_path = source.path().to_string_lossy().replace('\\', "/");
    git(
        cwd,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            &source_path,
            "nested",
        ],
    )
    .await;
    git(cwd, &["commit", "-m", "submodule baseline"]).await;
    let nested = cwd.join("nested");
    git(&nested, &["config", "user.name", "Gitx Test"]).await;
    git(&nested, &["config", "user.email", "test@example.invalid"]).await;
    fs::write(nested.join("README.md"), "submodule update\n").unwrap();
    git(&nested, &["add", "README.md"]).await;
    git(&nested, &["commit", "-m", "submodule update"]).await;
    let child_head = git(&nested, &["rev-parse", "HEAD"]).await;
    fs::write(cwd.join("other.txt"), "unrelated staged\n").unwrap();
    git(cwd, &["add", "other.txt"]).await;
    fs::write(cwd.join("other.txt"), "unrelated worktree\n").unwrap();

    let result = commit(cwd, "nested").await.unwrap();
    assert!(result.warning.is_none(), "{:?}", result.warning);
    assert_eq!(git(cwd, &["rev-parse", "HEAD:nested"]).await, child_head);
    assert_eq!(git(cwd, &["rev-parse", ":nested"]).await, child_head);
    assert_eq!(
        git(cwd, &["diff", "--cached", "--name-only"]).await,
        "other.txt\n"
    );
    assert_eq!(
        git(cwd, &["show", ":other.txt"]).await,
        "unrelated staged\n"
    );
    assert_eq!(
        fs::read(cwd.join("other.txt")).unwrap(),
        b"unrelated worktree\n"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn selected_symlink_records_its_target_even_when_the_target_is_a_directory() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    fs::create_dir(cwd.join("target-directory")).unwrap();
    std::os::unix::fs::symlink("target-directory", cwd.join("selected-link")).unwrap();
    let result = commit(cwd, "selected-link").await.unwrap();
    assert!(result.warning.is_none(), "{:?}", result.warning);
    assert_eq!(
        git(cwd, &["show", "HEAD:selected-link"]).await,
        "target-directory"
    );
    assert!(git(cwd, &["ls-tree", "HEAD", "selected-link"])
        .await
        .starts_with("120000 "));
    assert_eq!(git(cwd, &["diff", "--cached", "--name-only"]).await, "");
}

#[tokio::test]
async fn wsl_selected_file_commits_are_rejected_before_any_native_index_access() {
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
        // Keep this regression from ever launching WSL even before the guard exists.
        let cancel = CancellationToken::new();
        cancel.cancel();
        let error = runner
            .commit_create_ex(
                cwd,
                "must reject",
                false,
                false,
                Some(&["file.txt".into()]),
                None,
                &cancel,
            )
            .await
            .unwrap_err();
        assert_eq!(
            error.code,
            ErrorCode::InvalidArgument,
            "backend must reject unsupported index routing before invoking Git"
        );
        assert!(error.message.contains("WSL"), "{}", error.message);
    }
}
