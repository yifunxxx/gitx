use gitx_core::{AppError, ErrorCode, ShelfEntry};
use gitx_git::{GitInvocation, GitRunner};
use gitx_testkit::FixtureBuilder;
use std::path::Path;
use tokio_util::sync::CancellationToken;

async fn git(runner: &GitRunner, cwd: &Path, args: &[&str]) -> Vec<u8> {
    runner
        .run(
            GitInvocation::new(cwd, args.iter().copied()),
            &CancellationToken::new(),
        )
        .await
        .unwrap()
        .stdout
}

async fn import(
    runner: &GitRunner,
    cwd: &Path,
    patch: &[u8],
    cancel: &CancellationToken,
) -> Result<ShelfEntry, AppError> {
    let file = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(file.path(), patch).unwrap();
    runner
        .shelf_import_patch(cwd, file.path(), "import test", cancel)
        .await
}

fn addition(path: &str) -> Vec<u8> {
    format!(
        "diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1 @@\n+imported\n"
    )
    .into_bytes()
}

async fn assert_no_shelves(runner: &GitRunner, cwd: &Path) {
    assert!(runner
        .shelf_list(cwd, &CancellationToken::new())
        .await
        .unwrap()
        .is_empty());
    assert!(git(runner, cwd, &["for-each-ref", "refs/gitx/"])
        .await
        .is_empty());
}

#[tokio::test]
async fn empty_malformed_and_truncated_patches_are_rejected_before_publication() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    for patch in [
        b"".as_slice(),
        b"not a patch\n",
        b"diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n-old\n+new\n",
    ] {
        assert!(
            import(&runner, repo.path(), patch, &CancellationToken::new())
                .await
                .is_err()
        );
        assert_no_shelves(&runner, repo.path()).await;
    }
}

#[tokio::test]
async fn imported_metadata_and_application_cover_both_rename_sides_and_binary_deletions() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    git(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    for path in ["old.txt", "gone.txt", "中文 文件.txt", "file[1].txt"] {
        std::fs::write(cwd.join(path), b"original\n").unwrap();
    }
    std::fs::write(cwd.join("data.bin"), [0, 1, 2, 3]).unwrap();
    git(&runner, cwd, &["add", "."]).await;
    git(&runner, cwd, &["commit", "-m", "import base"]).await;
    git(&runner, cwd, &["mv", "old.txt", "new.txt"]).await;
    git(&runner, cwd, &["rm", "gone.txt"]).await;
    std::fs::write(cwd.join("中文 文件.txt"), b"unicode change\n").unwrap();
    std::fs::write(cwd.join("file[1].txt"), b"literal change\n").unwrap();
    std::fs::write(cwd.join("data.bin"), [0, 7, 8, 9]).unwrap();
    let patch = git(
        &runner,
        cwd,
        &["diff", "--binary", "--full-index", "-M", "HEAD"],
    )
    .await;
    git(&runner, cwd, &["reset", "--hard", "HEAD"]).await;
    let index_before = std::fs::read(cwd.join(".git/index")).unwrap();
    let entry = import(&runner, cwd, &patch, &CancellationToken::new())
        .await
        .unwrap();
    let mut expected = vec![
        "data.bin",
        "file[1].txt",
        "gone.txt",
        "new.txt",
        "old.txt",
        "中文 文件.txt",
    ];
    expected.sort();
    assert_eq!(entry.paths, expected);
    assert!(entry.binary);
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index_before);
    assert_eq!(std::fs::read(cwd.join("old.txt")).unwrap(), b"original\n");
    assert!(!cwd.join("new.txt").exists());
    assert_eq!(
        gitx_meta::read_shelf_patch(&cwd.join(".git"), &entry.id).unwrap(),
        patch
    );
    runner
        .unshelve(cwd, &entry.id, false, &CancellationToken::new())
        .await
        .unwrap();
    assert!(!cwd.join("old.txt").exists());
    assert!(!cwd.join("gone.txt").exists());
    assert_eq!(std::fs::read(cwd.join("new.txt")).unwrap(), b"original\n");
    assert_eq!(std::fs::read(cwd.join("data.bin")).unwrap(), [0, 7, 8, 9]);
    assert_eq!(
        std::fs::read(cwd.join("中文 文件.txt")).unwrap(),
        b"unicode change\n"
    );
}

#[tokio::test]
async fn imported_paths_cannot_escape_or_address_git_metadata_on_either_side() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    for path in [
        "../outside",
        "/absolute",
        "folder/../../outside",
        ".git/config",
        "folder/.GiT/config",
        "..\\outside",
    ] {
        let error = import(
            &runner,
            repo.path(),
            &addition(path),
            &CancellationToken::new(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArgument, "{path}: {error:?}");
        let rename = format!("diff --git a/{path} b/safe.txt\nsimilarity index 100%\nrename from {path}\nrename to safe.txt\n");
        assert!(
            import(
                &runner,
                repo.path(),
                rename.as_bytes(),
                &CancellationToken::new()
            )
            .await
            .is_err(),
            "old path: {path}"
        );
        assert_no_shelves(&runner, repo.path()).await;
    }
}

#[tokio::test]
async fn binary_notices_without_payload_are_not_importable_backups() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let patch = b"diff --git a/a.bin b/a.bin\nindex 1234567..7654321 100644\nBinary files a/a.bin and b/a.bin differ\n";
    assert!(
        import(&runner, repo.path(), patch, &CancellationToken::new())
            .await
            .is_err()
    );
    assert_no_shelves(&runner, repo.path()).await;
}

#[tokio::test]
async fn unborn_import_uses_a_real_empty_tree_and_leaves_local_content_untouched() {
    let repo = tempfile::tempdir().unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    git(&runner, cwd, &["init", "-b", "main"]).await;
    git(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(cwd.join("local.txt"), b"local work\n").unwrap();
    git(&runner, cwd, &["add", "local.txt"]).await;
    let index_before = std::fs::read(cwd.join(".git/index")).unwrap();
    let entry = import(
        &runner,
        cwd,
        &addition("new.txt"),
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(
        git(&runner, cwd, &["cat-file", "-t", &entry.base_sha]).await,
        b"tree\n"
    );
    assert_eq!(git(&runner, cwd, &["ls-tree", &entry.base_sha]).await, b"");
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index_before);
    assert_eq!(
        std::fs::read(cwd.join("local.txt")).unwrap(),
        b"local work\n"
    );
    assert!(!cwd.join("new.txt").exists());
    runner
        .unshelve(cwd, &entry.id, false, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(std::fs::read(cwd.join("new.txt")).unwrap(), b"imported\n");
}

#[tokio::test]
async fn import_ref_failure_and_cancellation_do_not_publish_a_shelf() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert_eq!(
        import(&runner, cwd, &addition("new.txt"), &cancelled)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Cancelled
    );
    assert_no_shelves(&runner, cwd).await;
    let sha = String::from_utf8(git(&runner, cwd, &["rev-parse", "HEAD"]).await).unwrap();
    let refs = cwd.join(".git/refs/gitx");
    std::fs::create_dir_all(&refs).unwrap();
    std::fs::write(
        refs.join(format!("shelf-base-{}.lock", sha.trim())),
        b"busy",
    )
    .unwrap();
    std::fs::write(cwd.join("README.md"), b"local change\n").unwrap();
    let patch = git(&runner, cwd, &["diff", "--binary", "--full-index"]).await;
    assert!(import(&runner, cwd, &patch, &CancellationToken::new())
        .await
        .is_err());
    assert_eq!(
        std::fs::read(cwd.join("README.md")).unwrap(),
        b"local change\n"
    );
    assert_no_shelves(&runner, cwd).await;
}

#[tokio::test]
async fn plain_unified_and_different_base_patches_can_be_saved_without_applying_them() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    std::fs::write(cwd.join("README.md"), b"staged\n").unwrap();
    git(&runner, cwd, &["add", "README.md"]).await;
    std::fs::write(cwd.join("README.md"), b"working\n").unwrap();
    let before = std::fs::read(cwd.join(".git/index")).unwrap();
    let patch = b"--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-another base\n+external change\n";
    let entry = import(&runner, cwd, patch, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(entry.paths, ["README.md"]);
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), before);
    assert_eq!(std::fs::read(cwd.join("README.md")).unwrap(), b"working\n");
    assert_eq!(
        gitx_meta::read_shelf_patch(&cwd.join(".git"), &entry.id).unwrap(),
        patch
    );
}

#[tokio::test]
async fn import_keeps_the_base_reachable_after_history_replacement_and_restore() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    git(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(cwd.join("README.md"), b"imported\n").unwrap();
    let patch = git(&runner, cwd, &["diff", "--binary", "--full-index"]).await;
    git(&runner, cwd, &["restore", "README.md"]).await;
    let entry = import(&runner, cwd, &patch, &CancellationToken::new())
        .await
        .unwrap();
    runner
        .shelf_delete(cwd, &entry.id, &CancellationToken::new())
        .await
        .unwrap();
    git(&runner, cwd, &["checkout", "--orphan", "replacement"]).await;
    git(&runner, cwd, &["rm", "-rf", "."]).await;
    git(
        &runner,
        cwd,
        &["commit", "--allow-empty", "-m", "new history"],
    )
    .await;
    git(&runner, cwd, &["branch", "-D", "main"]).await;
    git(&runner, cwd, &["reflog", "expire", "--expire=now", "--all"]).await;
    git(&runner, cwd, &["gc", "--prune=now"]).await;
    assert_eq!(
        git(&runner, cwd, &["cat-file", "-t", &entry.base_sha]).await,
        b"commit\n"
    );
    runner
        .shelf_restore(cwd, &entry.id, &CancellationToken::new())
        .await
        .unwrap();
    git(&runner, cwd, &["checkout", "--detach", &entry.base_sha]).await;
    runner
        .unshelve(cwd, &entry.id, false, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(std::fs::read(cwd.join("README.md")).unwrap(), b"imported\n");
}

#[tokio::test]
async fn import_keeps_available_patch_preimages_even_when_they_are_not_in_head() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let old = runner
        .run(
            GitInvocation::new(cwd, ["hash-object", "-w", "--stdin"])
                .stdin(b"orphan preimage\n".to_vec()),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    let old = String::from_utf8(old.stdout).unwrap().trim().to_owned();
    let new = runner
        .run(
            GitInvocation::new(cwd, ["hash-object", "--stdin"]).stdin(b"imported\n".to_vec()),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    let new = String::from_utf8(new.stdout).unwrap().trim().to_owned();
    let patch = format!("diff --git a/README.md b/README.md\nindex {old}..{new} 100644\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-orphan preimage\n+imported\n");
    let entry = import(&runner, cwd, patch.as_bytes(), &CancellationToken::new())
        .await
        .unwrap();
    runner
        .shelf_delete(cwd, &entry.id, &CancellationToken::new())
        .await
        .unwrap();
    git(&runner, cwd, &["gc", "--prune=now"]).await;
    assert_eq!(
        git(&runner, cwd, &["cat-file", "blob", &old]).await,
        b"orphan preimage\n"
    );
    runner
        .shelf_restore(cwd, &entry.id, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        gitx_meta::read_shelf_patch(&cwd.join(".git"), &entry.id).unwrap(),
        patch.as_bytes()
    );
}

#[tokio::test]
async fn missing_external_preimages_do_not_prevent_saving_a_valid_patch() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let patch = b"diff --git a/README.md b/README.md\nindex 1234567890123456789012345678901234567890..abcdefabcdefabcdefabcdefabcdefabcdefabcd 100644\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-other base\n+imported\n";
    let entry = import(&runner, cwd, patch, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(entry.paths, ["README.md"]);
    assert_eq!(
        gitx_meta::read_shelf_patch(&cwd.join(".git"), &entry.id).unwrap(),
        patch
    );
}

#[tokio::test]
async fn mode_only_and_copy_patches_have_complete_metadata() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    git(&runner, repo.path(), &["config", "core.autocrlf", "false"]).await;
    let mode = b"diff --git a/README.md b/README.md\nold mode 100644\nnew mode 100755\n";
    let entry = import(&runner, repo.path(), mode, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(entry.paths, ["README.md"]);
    let copy = b"diff --git a/README.md b/copy.md\nsimilarity index 100%\ncopy from README.md\ncopy to copy.md\n";
    let entry = import(&runner, repo.path(), copy, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(entry.paths, ["README.md", "copy.md"]);
    runner
        .unshelve(repo.path(), &entry.id, false, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(repo.path().join("README.md")).unwrap(),
        std::fs::read(repo.path().join("copy.md")).unwrap()
    );
}

#[tokio::test]
async fn shelf_backup_and_delete_never_follow_symbolic_refs_into_user_branches() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let base = String::from_utf8(git(&runner, cwd, &["rev-parse", "HEAD"]).await)
        .unwrap()
        .trim()
        .to_owned();
    git(
        &runner,
        cwd,
        &["commit", "--allow-empty", "-m", "another branch tip"],
    )
    .await;
    let other = git(&runner, cwd, &["rev-parse", "HEAD"]).await;
    git(&runner, cwd, &["branch", "other"]).await;
    git(&runner, cwd, &["checkout", "--detach", &base]).await;
    let backup = format!("refs/gitx/shelf-base-{base}");
    git(&runner, cwd, &["symbolic-ref", &backup, "refs/heads/other"]).await;
    let entry = import(
        &runner,
        cwd,
        &addition("new.txt"),
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(
        git(&runner, cwd, &["rev-parse", "refs/heads/other"]).await,
        other
    );
    let shelf_ref = format!("refs/gitx/shelf/{}", entry.id);
    git(
        &runner,
        cwd,
        &["symbolic-ref", &shelf_ref, "refs/heads/other"],
    )
    .await;
    runner
        .shelf_delete(cwd, &entry.id, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        git(&runner, cwd, &["rev-parse", "refs/heads/other"]).await,
        other
    );
}
