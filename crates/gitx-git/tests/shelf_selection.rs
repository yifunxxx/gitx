use gitx_core::{ErrorCode, ShelfEntry};
use gitx_git::{GitInvocation, GitRunner};
use gitx_testkit::{FixtureBuilder, FixtureRepo};
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

async fn base() -> (FixtureRepo, GitRunner) {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    git(&runner, repo.path(), &["config", "core.autocrlf", "false"]).await;
    for name in [
        "one.txt",
        "two.txt",
        "three.txt",
        "中文 文件.txt",
        "file[1].txt",
        "file1.txt",
    ] {
        fs::write(repo.path().join(name), b"original\n").unwrap();
    }
    fs::write(repo.path().join("data.bin"), [0, 1, 2, 3]).unwrap();
    git(&runner, repo.path(), &["add", "."]).await;
    git(&runner, repo.path(), &["commit", "-m", "selection base"]).await;
    (repo, runner)
}

async fn import(runner: &GitRunner, cwd: &Path, patch: &[u8]) -> ShelfEntry {
    let file = tempfile::NamedTempFile::new().unwrap();
    fs::write(file.path(), patch).unwrap();
    runner
        .shelf_import_patch(cwd, file.path(), "selection", &CancellationToken::new())
        .await
        .unwrap()
}

async fn save(runner: &GitRunner, cwd: &Path) -> (ShelfEntry, Vec<u8>) {
    let patch = git(
        runner,
        cwd,
        &["diff", "--binary", "--full-index", "-M", "HEAD"],
    )
    .await;
    git(runner, cwd, &["reset", "--hard", "HEAD"]).await;
    (import(runner, cwd, &patch).await, patch)
}

async fn select(
    runner: &GitRunner,
    cwd: &Path,
    id: &str,
    paths: &[&str],
    remove: bool,
) -> (Vec<String>, Vec<String>) {
    let paths: Vec<_> = paths.iter().map(|s| s.to_string()).collect();
    runner
        .unshelve_paths(cwd, id, Some(&paths), remove, &CancellationToken::new())
        .await
        .unwrap()
}

fn saved(cwd: &Path, id: &str) -> Vec<u8> {
    gitx_meta::read_shelf_patch(&cwd.join(".git"), id).unwrap()
}

#[tokio::test]
async fn selected_files_apply_in_batches_and_unselected_local_and_index_changes_survive() {
    let (repo, runner) = base().await;
    let cwd = repo.path();
    for name in ["one.txt", "two.txt"] {
        fs::write(cwd.join(name), b"shelved\n").unwrap();
    }
    let (entry, _) = save(&runner, cwd).await;
    fs::write(cwd.join("three.txt"), b"staged local\n").unwrap();
    git(&runner, cwd, &["add", "three.txt"]).await;
    fs::write(cwd.join("three.txt"), b"unstaged local\n").unwrap();
    let index = git(
        &runner,
        cwd,
        &["ls-files", "-s", "--", "three.txt", "two.txt"],
    )
    .await;
    let head = git(&runner, cwd, &["rev-parse", "HEAD"]).await;
    let (applied, failed) = select(&runner, cwd, &entry.id, &["one.txt"], true).await;
    assert_eq!(applied, ["one.txt"]);
    assert!(failed.is_empty());
    assert_eq!(fs::read(cwd.join("one.txt")).unwrap(), b"shelved\n");
    assert_eq!(fs::read(cwd.join("two.txt")).unwrap(), b"original\n");
    assert_eq!(
        fs::read(cwd.join("three.txt")).unwrap(),
        b"unstaged local\n"
    );
    assert_eq!(
        git(
            &runner,
            cwd,
            &["ls-files", "-s", "--", "three.txt", "two.txt"]
        )
        .await,
        index
    );
    let remaining = runner
        .shelf_list(cwd, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(remaining[0].paths, ["two.txt"]);
    assert_eq!(
        select(&runner, cwd, &entry.id, &["two.txt"], true).await.0,
        ["two.txt"]
    );
    assert!(runner
        .shelf_list(cwd, &CancellationToken::new())
        .await
        .unwrap()
        .is_empty());
    assert_eq!(git(&runner, cwd, &["rev-parse", "HEAD"]).await, head);
}

#[tokio::test]
async fn keeping_record_preserves_exact_patch_and_treats_unicode_spaces_and_globs_literally() {
    let (repo, runner) = base().await;
    let cwd = repo.path();
    for name in ["中文 文件.txt", "file[1].txt", "file1.txt"] {
        fs::write(cwd.join(name), b"shelved\n").unwrap();
    }
    let (entry, patch) = save(&runner, cwd).await;
    let (applied, failed) = select(
        &runner,
        cwd,
        &entry.id,
        &["中文 文件.txt", "file[1].txt", "file[1].txt"],
        false,
    )
    .await;
    assert_eq!(applied, ["file[1].txt", "中文 文件.txt"]);
    assert!(failed.is_empty());
    assert_eq!(saved(cwd, &entry.id), patch);
    assert_eq!(fs::read(cwd.join("file1.txt")).unwrap(), b"original\n");
    assert_eq!(fs::read(cwd.join("中文 文件.txt")).unwrap(), b"shelved\n");
    assert_eq!(fs::read(cwd.join("file[1].txt")).unwrap(), b"shelved\n");
}

#[tokio::test]
async fn empty_unknown_and_mixed_stale_selections_reject_before_any_write() {
    let (repo, runner) = base().await;
    let cwd = repo.path();
    fs::write(cwd.join("one.txt"), b"shelved\n").unwrap();
    let (entry, patch) = save(&runner, cwd).await;
    let index = fs::read(cwd.join(".git/index")).unwrap();
    let refs = git(&runner, cwd, &["show-ref"]).await;
    for paths in [
        vec![],
        vec!["gone".into()],
        vec!["one.txt".into(), "gone".into()],
    ] {
        let err = runner
            .unshelve_paths(
                cwd,
                &entry.id,
                Some(&paths),
                true,
                &CancellationToken::new(),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidArgument);
        assert_eq!(fs::read(cwd.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(cwd.join("one.txt")).unwrap(), b"original\n");
        assert_eq!(saved(cwd, &entry.id), patch);
        assert_eq!(git(&runner, cwd, &["show-ref"]).await, refs);
    }
}

#[tokio::test]
async fn binary_remainder_keeps_its_metadata_and_can_be_applied_later() {
    let (repo, runner) = base().await;
    let cwd = repo.path();
    fs::write(cwd.join("one.txt"), b"shelved\n").unwrap();
    fs::write(cwd.join("data.bin"), [0, 9, 8, 7]).unwrap();
    let (entry, _) = save(&runner, cwd).await;
    select(&runner, cwd, &entry.id, &["one.txt"], true).await;
    let remaining = runner
        .shelf_list(cwd, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(remaining[0].paths, ["data.bin"]);
    assert!(remaining[0].binary);
    assert_eq!(fs::read(cwd.join("data.bin")).unwrap(), [0, 1, 2, 3]);
    select(&runner, cwd, &entry.id, &["data.bin"], true).await;
    assert_eq!(fs::read(cwd.join("data.bin")).unwrap(), [0, 9, 8, 7]);
}

#[tokio::test]
async fn binary_selection_removes_binary_metadata_from_text_remainder() {
    let (repo, runner) = base().await;
    let cwd = repo.path();
    fs::write(cwd.join("one.txt"), b"shelved\n").unwrap();
    fs::write(cwd.join("data.bin"), [0, 9, 8, 7]).unwrap();
    let (entry, _) = save(&runner, cwd).await;
    select(&runner, cwd, &entry.id, &["data.bin"], true).await;
    let remaining = runner
        .shelf_list(cwd, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(remaining[0].paths, ["one.txt"]);
    assert!(!remaining[0].binary);
    assert_eq!(fs::read(cwd.join("one.txt")).unwrap(), b"original\n");
}

#[tokio::test]
async fn partial_failure_retains_unselected_and_failed_patches_only() {
    let (repo, runner) = base().await;
    let cwd = repo.path();
    for name in ["one.txt", "two.txt", "three.txt"] {
        fs::write(cwd.join(name), b"shelved\n").unwrap();
    }
    let (entry, _) = save(&runner, cwd).await;
    fs::write(cwd.join("two.txt"), b"local conflict\n").unwrap();
    git(&runner, cwd, &["add", "two.txt"]).await;
    git(&runner, cwd, &["commit", "-m", "conflicting edit"]).await;
    let (applied, failed) = select(&runner, cwd, &entry.id, &["one.txt", "two.txt"], true).await;
    assert_eq!(applied, ["one.txt"]);
    assert_eq!(failed, ["two.txt"]);
    let remaining = runner
        .shelf_list(cwd, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(remaining[0].paths, ["three.txt", "two.txt"]);
    assert_eq!(fs::read(cwd.join("three.txt")).unwrap(), b"original\n");
    assert!(!git(&runner, cwd, &["ls-files", "-u"]).await.is_empty());
    git(&runner, cwd, &["reset", "--hard", "HEAD~1"]).await;
    let (applied, failed) = runner
        .unshelve(cwd, &entry.id, true, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(applied, ["three.txt", "two.txt"]);
    assert!(failed.is_empty());
    assert_eq!(fs::read(cwd.join("one.txt")).unwrap(), b"original\n");
}

#[tokio::test]
async fn rename_requires_both_sides_and_does_not_widen_selection() {
    let (repo, runner) = base().await;
    let cwd = repo.path();
    git(&runner, cwd, &["mv", "one.txt", "renamed.txt"]).await;
    fs::write(cwd.join("two.txt"), b"shelved\n").unwrap();
    let (entry, patch) = save(&runner, cwd).await;
    for side in ["one.txt", "renamed.txt"] {
        let err = runner
            .unshelve_paths(
                cwd,
                &entry.id,
                Some(&[side.into(), "two.txt".into()]),
                true,
                &CancellationToken::new(),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidArgument);
        assert_eq!(saved(cwd, &entry.id), patch);
        assert_eq!(fs::read(cwd.join("two.txt")).unwrap(), b"original\n");
        assert!(cwd.join("one.txt").exists());
        assert!(!cwd.join("renamed.txt").exists());
    }
    assert_eq!(
        select(&runner, cwd, &entry.id, &["one.txt", "renamed.txt"], true)
            .await
            .0,
        ["one.txt", "renamed.txt"]
    );
    assert!(!cwd.join("one.txt").exists());
    assert!(cwd.join("renamed.txt").exists());
    assert_eq!(
        runner
            .shelf_list(cwd, &CancellationToken::new())
            .await
            .unwrap()[0]
            .paths,
        ["two.txt"]
    );
}

#[tokio::test]
async fn file_directory_replacement_requires_the_complete_dependency_group() {
    let (repo, runner) = base().await;
    let cwd = repo.path();
    git(&runner, cwd, &["rm", "one.txt"]).await;
    fs::create_dir(cwd.join("one.txt")).unwrap();
    fs::write(cwd.join("one.txt/child"), b"child\n").unwrap();
    git(&runner, cwd, &["add", "."]).await;
    let (entry, patch) = save(&runner, cwd).await;
    let err = runner
        .unshelve_paths(
            cwd,
            &entry.id,
            Some(&["one.txt/child".into()]),
            true,
            &CancellationToken::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidArgument);
    assert_eq!(saved(cwd, &entry.id), patch);
    assert!(cwd.join("one.txt").is_file());
    select(&runner, cwd, &entry.id, &["one.txt", "one.txt/child"], true).await;
    assert_eq!(fs::read(cwd.join("one.txt/child")).unwrap(), b"child\n");
}

#[tokio::test]
async fn ambiguous_mail_prefix_remains_a_single_group_and_full_selection_works() {
    let (repo, runner) = base().await;
    let cwd = repo.path();
    for name in ["one.txt", "two.txt"] {
        fs::write(cwd.join(name), b"shelved\n").unwrap();
    }
    let patch = git(&runner, cwd, &["diff", "--binary", "--full-index", "HEAD"]).await;
    git(&runner, cwd, &["reset", "--hard", "HEAD"]).await;
    let patch = [b"Subject: saved work\n\n".as_slice(), &patch].concat();
    let entry = import(&runner, cwd, &patch).await;
    let err = runner
        .unshelve_paths(
            cwd,
            &entry.id,
            Some(&["one.txt".into()]),
            true,
            &CancellationToken::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidArgument);
    assert_eq!(saved(cwd, &entry.id), patch);
    assert_eq!(
        select(&runner, cwd, &entry.id, &["one.txt", "two.txt"], true)
            .await
            .0,
        ["one.txt", "two.txt"]
    );
}
