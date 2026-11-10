use gitx_core::ErrorCode;
use gitx_git::{GitInvocation, GitRunner};
use gitx_testkit::FixtureBuilder;
use std::{fs, path::Path};
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
fn entry(common: &Path, bytes: &[u8]) -> String {
    gitx_meta::create_shelf_entry(
        common,
        "saved",
        "base",
        &["saved.txt".into()],
        bytes,
        None,
        false,
        false,
    )
    .unwrap()
    .id
}

#[tokio::test]
async fn reads_exact_saved_patch_without_touching_work_index_refs_or_storage() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let common = cwd.join(".git");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    git(&runner, cwd, &["config", "core.autocrlf", "false"]).await;
    fs::write(cwd.join("旧[名].txt"), b"before\n").unwrap();
    fs::write(cwd.join("binary.bin"), [0, 1, 2]).unwrap();
    git(&runner, cwd, &["add", "."]).await;
    git(&runner, cwd, &["commit", "-m", "base"]).await;
    git(&runner, cwd, &["mv", "旧[名].txt", "新 文件.txt"]).await;
    fs::write(cwd.join("binary.bin"), [0, 2, 3]).unwrap();
    fs::write(cwd.join("README.md"), "saved content\n").unwrap();
    let patch = git(
        &runner,
        cwd,
        &["diff", "--binary", "--full-index", "-M", "HEAD"],
    )
    .await;
    let id = entry(&common, &patch);
    fs::write(cwd.join("README.md"), "later local content\n").unwrap();
    let index = fs::read(common.join("index")).unwrap();
    let refs = git(&runner, cwd, &["show-ref"]).await;
    let status = git(&runner, cwd, &["status", "--porcelain=v1", "-z"]).await;
    let meta_path = gitx_meta::shelf_dir(&common, &id).join("meta.json");
    let metadata = fs::read(&meta_path).unwrap();
    let preview = runner
        .shelf_preview(cwd, &id, false, &cancel)
        .await
        .unwrap();
    assert_eq!(preview.patch.as_bytes(), patch);
    assert!(!preview.truncated && !preview.lossy);
    assert_eq!(preview.entry.id, id);
    assert!(preview.patch.contains("GIT binary patch"));
    assert!(preview.patch.contains("rename from"));
    assert_eq!(fs::read(common.join("index")).unwrap(), index);
    assert_eq!(fs::read(meta_path).unwrap(), metadata);
    assert_eq!(git(&runner, cwd, &["show-ref"]).await, refs);
    assert_eq!(
        git(&runner, cwd, &["status", "--porcelain=v1", "-z"]).await,
        status
    );
    assert_eq!(
        fs::read_to_string(cwd.join("README.md")).unwrap(),
        "later local content\n"
    );
    assert_eq!(gitx_meta::read_shelf_patch(&common, &id).unwrap(), patch);
}

#[tokio::test]
async fn reads_current_generation_and_deleted_snapshot_without_restoring() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let common = repo.path().join(".git");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let id = entry(&common, b"original");
    gitx_meta::consume_shelf_patch(
        &common,
        &id,
        b"original",
        &["remaining.txt".into()],
        b"remaining\r\n",
        false,
    )
    .unwrap();
    let preview = runner
        .shelf_preview(repo.path(), &id, false, &cancel)
        .await
        .unwrap();
    assert_eq!(preview.patch, "remaining\r\n");
    assert_eq!(preview.entry.paths, ["remaining.txt"]);
    gitx_meta::soft_delete_shelf(&common, &id).unwrap();
    assert!(runner
        .shelf_preview(repo.path(), &id, false, &cancel)
        .await
        .is_err());
    let preview = runner
        .shelf_preview(repo.path(), &id, true, &cancel)
        .await
        .unwrap();
    assert_eq!(preview.patch, "remaining\r\n");
    assert!(gitx_meta::list_shelf(&common).unwrap().is_empty());
    assert_eq!(gitx_meta::list_deleted_shelf(&common).unwrap().len(), 1);
    assert_eq!(
        fs::read(
            gitx_meta::deleted_root(&common)
                .join(id)
                .join("changes.patch")
        )
        .unwrap(),
        b"original"
    );
}

#[tokio::test]
async fn bounded_read_handles_huge_patch_and_utf8_boundary_and_invalid_bytes() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let common = repo.path().join(".git");
    let limit = 2 * 1024 * 1024;
    for (patch, expected, truncated, lossy) in [
        (vec![b'x'; limit], vec![b'x'; limit], false, false),
        (
            [b"header\n".to_vec(), vec![b'x'; limit]].concat(),
            b"header\n".to_vec(),
            true,
            false,
        ),
        (
            [vec![b'x'; limit - 1], "中文".as_bytes().to_vec()].concat(),
            vec![b'x'; limit - 1],
            true,
            false,
        ),
        (
            vec![b'+', 255, b'\n'],
            "+�\n".as_bytes().to_vec(),
            false,
            true,
        ),
        (vec![], vec![], false, false),
    ] {
        let id = entry(&common, &patch);
        let preview = gitx_meta::preview_shelf(&common, &id, false).unwrap();
        assert_eq!(preview.patch.as_bytes(), expected);
        assert_eq!(preview.truncated, truncated);
        assert_eq!(preview.lossy, lossy);
        assert_eq!(gitx_meta::read_shelf_patch(&common, &id).unwrap(), patch);
    }
}

#[tokio::test]
async fn rejects_missing_invalid_damaged_and_cancelled_reads() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let common = repo.path().join(".git");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for id in ["../escape", "00000000-0000-4000-8000-000000000000"] {
        assert!(runner
            .shelf_preview(repo.path(), id, false, &cancel)
            .await
            .is_err());
    }
    let id = entry(&common, b"saved");
    fs::remove_file(gitx_meta::shelf_dir(&common, &id).join("changes.patch")).unwrap();
    assert_eq!(
        runner
            .shelf_preview(repo.path(), &id, false, &cancel)
            .await
            .unwrap_err()
            .code,
        ErrorCode::ShelfFailed
    );
    cancel.cancel();
    assert_eq!(
        runner
            .shelf_preview(repo.path(), &id, false, &cancel)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Cancelled
    );
}
