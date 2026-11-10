use gitx_core::ErrorCode;
use gitx_git::{GitInvocation, GitRunner};
use gitx_testkit::FixtureBuilder;
use std::fs;
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

fn entry(common: &Path, patch: &[u8]) -> String {
    gitx_meta::create_shelf_entry(
        common,
        "saved",
        "base",
        &["saved.txt".into()],
        patch,
        None,
        false,
        false,
    )
    .unwrap()
    .id
}

#[tokio::test]
async fn exports_exact_saved_binary_rename_patch_and_round_trips_without_touching_work() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let out = tempfile::tempdir().unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    git(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    fs::write(cwd.join("old.txt"), b"old text\n").unwrap();
    fs::write(cwd.join("data.bin"), [0, 1, 2, 3]).unwrap();
    git(&runner, cwd, &["add", "."]).await;
    git(&runner, cwd, &["commit", "-m", "base"]).await;
    git(&runner, cwd, &["mv", "old.txt", "中文 new.txt"]).await;
    fs::write(cwd.join("data.bin"), [0, 9, 8, 7]).unwrap();
    let expected = git(
        &runner,
        cwd,
        &["diff", "--binary", "--full-index", "-M", "HEAD"],
    )
    .await;
    let source = out.path().join("source.patch");
    fs::write(&source, &expected).unwrap();
    let shelf = runner
        .shelf_import_patch(cwd, &source, "saved", &cancel)
        .await
        .unwrap();
    fs::write(cwd.join("data.bin"), [0, 5, 4]).unwrap();
    let index = fs::read(cwd.join(".git/index")).unwrap();
    let refs = git(&runner, cwd, &["show-ref"]).await;
    let target = out.path().join("中文 exported.patch");
    fs::write(&target, b"previous export").unwrap();
    let result = runner
        .shelf_export_patch(cwd, &shelf.id, &target, &cancel)
        .await
        .unwrap();
    assert_eq!(fs::read(&target).unwrap(), expected);
    assert_eq!(result.bytes, expected.len() as u64);
    assert_eq!(result.path, target.display().to_string());
    assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(cwd.join("data.bin")).unwrap(), [0, 5, 4]);
    assert_eq!(git(&runner, cwd, &["show-ref"]).await, refs);
    assert_eq!(
        gitx_meta::read_shelf_patch(&cwd.join(".git"), &shelf.id).unwrap(),
        expected
    );
    let fresh = FixtureBuilder::new().build("clean").unwrap();
    let imported = runner
        .shelf_import_patch(fresh.path(), &target, "round trip", &cancel)
        .await
        .unwrap();
    assert_eq!(
        gitx_meta::read_shelf_patch(&fresh.path().join(".git"), &imported.id).unwrap(),
        expected
    );
    assert_eq!(imported.paths, shelf.paths);
    assert!(imported.binary);
}

#[tokio::test]
async fn exports_current_generation_after_partial_consumption() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let common = repo.path().join(".git");
    let out = tempfile::tempdir().unwrap();
    let id = entry(&common, b"original patch");
    gitx_meta::consume_shelf_patch(
        &common,
        &id,
        b"original patch",
        &["remaining.txt".into()],
        b"remaining patch",
        false,
    )
    .unwrap();
    let target = out.path().join("remaining.patch");
    GitRunner::new("git")
        .shelf_export_patch(repo.path(), &id, &target, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(fs::read(target).unwrap(), b"remaining patch");
    assert_eq!(
        fs::read(gitx_meta::shelf_dir(&common, &id).join("changes.patch")).unwrap(),
        b"original patch"
    );
}

#[tokio::test]
async fn missing_deleted_or_damaged_shelf_never_truncates_existing_output() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let common = repo.path().join(".git");
    let out = tempfile::tempdir().unwrap();
    let target = out.path().join("saved.patch");
    fs::write(&target, b"keep existing").unwrap();
    let id = entry(&common, b"saved");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for missing in ["../escape", "00000000-0000-4000-8000-000000000000"] {
        assert!(runner
            .shelf_export_patch(repo.path(), missing, &target, &cancel)
            .await
            .is_err());
    }
    gitx_meta::soft_delete_shelf(&common, &id).unwrap();
    assert!(runner
        .shelf_export_patch(repo.path(), &id, &target, &cancel)
        .await
        .is_err());
    gitx_meta::restore_shelf(&common, &id).unwrap();
    fs::write(
        gitx_meta::shelf_dir(&common, &id).join("meta.json"),
        b"broken",
    )
    .unwrap();
    assert!(runner
        .shelf_export_patch(repo.path(), &id, &target, &cancel)
        .await
        .is_err());
    assert_eq!(fs::read(target).unwrap(), b"keep existing");
    assert_eq!(fs::read_dir(out.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn rejects_git_metadata_relative_paths_directories_and_missing_parents() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let common = cwd.join(".git");
    let id = entry(&common, b"saved patch");
    let config = fs::read(common.join("config")).unwrap();
    let runner = GitRunner::new("git");
    for target in [
        common.join("config"),
        gitx_meta::shelf_dir(&common, &id).join("changes.patch"),
        cwd.to_path_buf(),
        cwd.join("missing/new.patch"),
        "relative.patch".into(),
    ] {
        assert!(
            runner
                .shelf_export_patch(cwd, &id, &target, &CancellationToken::new())
                .await
                .is_err(),
            "{}",
            target.display()
        );
    }
    assert_eq!(fs::read(common.join("config")).unwrap(), config);
    assert_eq!(
        gitx_meta::read_shelf_patch(&common, &id).unwrap(),
        b"saved patch"
    );
    assert!(!cwd.join("missing").exists());
}

#[tokio::test]
async fn linked_worktree_reads_common_shelf_and_protects_both_metadata_locations() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let out = tempfile::tempdir().unwrap();
    let linked = out.path().join("linked");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    git(
        &runner,
        repo.path(),
        &[
            "worktree",
            "add",
            "--detach",
            linked.to_str().unwrap(),
            "HEAD",
        ],
    )
    .await;
    let id = entry(&repo.path().join(".git"), b"shared patch");
    let target = out.path().join("shared.patch");
    runner
        .shelf_export_patch(&linked, &id, &target, &cancel)
        .await
        .unwrap();
    assert_eq!(fs::read(target).unwrap(), b"shared patch");
    let git_dir = runner.git_dir(&linked, &cancel).await.unwrap();
    for target in [
        linked.join(".git"),
        git_dir.join("HEAD"),
        repo.path().join(".git/config"),
    ] {
        let before = fs::read(&target).unwrap();
        assert!(runner
            .shelf_export_patch(&linked, &id, &target, &cancel)
            .await
            .is_err());
        assert_eq!(fs::read(target).unwrap(), before);
    }
}

#[tokio::test]
async fn cancelled_export_preserves_output() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let out = tempfile::tempdir().unwrap();
    let target = out.path().join("saved.patch");
    fs::write(&target, b"keep existing").unwrap();
    let id = entry(&repo.path().join(".git"), b"new");
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        GitRunner::new("git")
            .shelf_export_patch(repo.path(), &id, &target, &cancel)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Cancelled
    );
    assert_eq!(fs::read(target).unwrap(), b"keep existing");
    assert_eq!(fs::read_dir(out.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn separate_git_directory_is_protected_even_without_a_dot_git_component() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let out = tempfile::tempdir().unwrap();
    let common = out.path().join("metadata");
    let runner = GitRunner::new("git");
    git(
        &runner,
        repo.path(),
        &["init", "--separate-git-dir", common.to_str().unwrap()],
    )
    .await;
    let id = entry(&common, b"saved patch");
    let target = common.join("config");
    let before = fs::read(&target).unwrap();
    let error = runner
        .shelf_export_patch(repo.path(), &id, &target, &CancellationToken::new())
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidArgument);
    assert_eq!(fs::read(target).unwrap(), before);
}

#[cfg(windows)]
#[tokio::test]
async fn directory_alias_cannot_bypass_git_metadata_protection() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let out = tempfile::tempdir().unwrap();
    let common = repo.path().join(".git");
    let alias = out.path().join("alias");
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&alias)
        .arg(&common)
        .output()
        .unwrap();
    assert!(
        status.status.success(),
        "{}",
        String::from_utf8_lossy(&status.stderr)
    );
    let id = entry(&common, b"saved patch");
    let before = fs::read(common.join("config")).unwrap();
    let error = GitRunner::new("git")
        .shelf_export_patch(
            repo.path(),
            &id,
            &alias.join("config"),
            &CancellationToken::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidArgument);
    assert_eq!(fs::read(common.join("config")).unwrap(), before);
}

#[cfg(windows)]
#[tokio::test]
async fn locked_destination_failure_preserves_bytes_and_cleans_temporary_file() {
    use std::os::windows::fs::OpenOptionsExt;
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let out = tempfile::tempdir().unwrap();
    let target = out.path().join("locked.patch");
    fs::write(&target, b"keep existing").unwrap();
    let _locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&target)
        .unwrap();
    let id = entry(&repo.path().join(".git"), b"replacement");
    let error = GitRunner::new("git")
        .shelf_export_patch(repo.path(), &id, &target, &CancellationToken::new())
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::FsError);
    assert_eq!(fs::read(target).unwrap(), b"keep existing");
    assert_eq!(fs::read_dir(out.path()).unwrap().count(), 1);
}
