use gitx_core::ShelfEntry;
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

async fn import(runner: &GitRunner, cwd: &Path, patch: &[u8]) -> ShelfEntry {
    let file = tempfile::NamedTempFile::new().unwrap();
    fs::write(file.path(), patch).unwrap();
    runner
        .shelf_import_patch(cwd, file.path(), "partial", &CancellationToken::new())
        .await
        .unwrap()
}

async fn setup(runner: &GitRunner, cwd: &Path) {
    git(runner, cwd, &["config", "core.autocrlf", "false"]).await;
    for (name, bytes) in [
        ("README.md", "base\n"),
        ("z-good.txt", "base good\n"),
        ("other.txt", "other\n"),
    ] {
        fs::write(cwd.join(name), bytes).unwrap();
    }
    git(runner, cwd, &["add", "."]).await;
    git(runner, cwd, &["commit", "-m", "base files"]).await;
}

async fn shelve_two(runner: &GitRunner, cwd: &Path) -> ShelfEntry {
    fs::write(cwd.join("README.md"), b"shelved text\n").unwrap();
    fs::write(cwd.join("z-good.txt"), b"shelved good\n").unwrap();
    runner
        .shelve_changes(
            cwd,
            "two files",
            &["README.md".into(), "z-good.txt".into()],
            false,
            None,
            false,
            &CancellationToken::new(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn local_failure_does_not_block_later_files_and_retry_only_applies_the_remainder() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cwd = repo.path();
    let cancel = CancellationToken::new();
    setup(&runner, cwd).await;
    let entry = shelve_two(&runner, cwd).await;
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let original = gitx_meta::read_shelf_patch(&common, &entry.id).unwrap();
    fs::write(cwd.join("README.md"), b"local unsaved\n").unwrap();
    fs::write(cwd.join("other.txt"), b"unrelated staged\n").unwrap();
    git(&runner, cwd, &["add", "other.txt"]).await;
    let (applied, failed) = runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .unwrap();
    assert_eq!(applied, ["z-good.txt"]);
    assert_eq!(failed, ["README.md"]);
    assert_eq!(fs::read(cwd.join("README.md")).unwrap(), b"local unsaved\n");
    assert_eq!(fs::read(cwd.join("z-good.txt")).unwrap(), b"shelved good\n");
    assert_eq!(
        git(&runner, cwd, &["show", ":other.txt"]).await,
        b"unrelated staged\n"
    );
    let (meta, rest) = gitx_meta::load_shelf_snapshot(&common, &entry.id).unwrap();
    assert_eq!(meta.paths, failed);
    assert!(!String::from_utf8_lossy(&rest).contains("z-good.txt"));
    assert_eq!(
        fs::read(gitx_meta::shelf_dir(&common, &entry.id).join("changes.patch")).unwrap(),
        original
    );
    git(&runner, cwd, &["restore", "README.md"]).await;
    let (applied, failed) = runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .unwrap();
    assert_eq!(applied, ["README.md"]);
    assert!(failed.is_empty());
    assert_eq!(fs::read(cwd.join("README.md")).unwrap(), b"shelved text\n");
    assert!(runner.shelf_list(cwd, &cancel).await.unwrap().is_empty());
    runner.shelf_restore(cwd, &entry.id, &cancel).await.unwrap();
    assert_eq!(
        gitx_meta::read_shelf_patch(&common, &entry.id).unwrap(),
        rest
    );
}

#[tokio::test]
async fn partial_application_without_consumption_keeps_the_exact_complete_patch() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cwd = repo.path();
    let cancel = CancellationToken::new();
    setup(&runner, cwd).await;
    let entry = shelve_two(&runner, cwd).await;
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let before = gitx_meta::read_shelf_patch(&common, &entry.id).unwrap();
    fs::write(cwd.join("README.md"), b"local\n").unwrap();
    let (applied, failed) = runner
        .unshelve(cwd, &entry.id, false, &cancel)
        .await
        .unwrap();
    assert_eq!(applied, ["z-good.txt"]);
    assert_eq!(failed, ["README.md"]);
    assert_eq!(
        gitx_meta::read_shelf_patch(&common, &entry.id).unwrap(),
        before
    );
    assert_eq!(
        gitx_meta::load_shelf_meta(&common, &entry.id)
            .unwrap()
            .paths,
        entry.paths
    );
}

#[tokio::test]
async fn three_way_conflict_is_retained_while_an_independent_file_still_applies() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cwd = repo.path();
    let cancel = CancellationToken::new();
    setup(&runner, cwd).await;
    let entry = shelve_two(&runner, cwd).await;
    fs::write(cwd.join("README.md"), b"other committed text\n").unwrap();
    git(&runner, cwd, &["add", "README.md"]).await;
    git(&runner, cwd, &["commit", "-m", "divergent"]).await;
    let (applied, failed) = runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .unwrap();
    assert_eq!(applied, ["z-good.txt"]);
    assert_eq!(failed, ["README.md"]);
    let conflicted = fs::read_to_string(cwd.join("README.md")).unwrap();
    assert!(conflicted.contains("<<<<<<<"));
    assert!(conflicted.contains("other committed text"));
    assert!(conflicted.contains("shelved text"));
    assert!(!git(&runner, cwd, &["ls-files", "--unmerged"])
        .await
        .is_empty());
    assert_eq!(
        git(&runner, cwd, &["show", ":z-good.txt"]).await,
        b"shelved good\n"
    );
    assert_eq!(
        runner.shelf_list(cwd, &cancel).await.unwrap()[0].paths,
        ["README.md"]
    );
}

#[tokio::test]
async fn rename_swaps_are_applied_together_and_consumed_as_complete_sections() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cwd = repo.path();
    let cancel = CancellationToken::new();
    setup(&runner, cwd).await;
    fs::write(cwd.join("a.txt"), b"AAA\n").unwrap();
    fs::write(cwd.join("b.txt"), b"BBB\n").unwrap();
    git(&runner, cwd, &["add", "."]).await;
    git(&runner, cwd, &["commit", "-m", "swap base"]).await;
    fs::write(cwd.join("README.md"), b"saved readme\n").unwrap();
    let mut patch = git(&runner, cwd, &["diff", "--binary", "--full-index"]).await;
    patch.extend_from_slice(b"diff --git a/a.txt b/b.txt\nsimilarity index 100%\nrename from a.txt\nrename to b.txt\ndiff --git a/b.txt b/a.txt\nsimilarity index 100%\nrename from b.txt\nrename to a.txt\n");
    let entry = import(&runner, cwd, &patch).await;
    fs::write(cwd.join("README.md"), b"keep local\n").unwrap();
    let (applied, failed) = runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .unwrap();
    assert_eq!(applied, ["a.txt", "b.txt"]);
    assert_eq!(failed, ["README.md"]);
    assert_eq!(fs::read(cwd.join("a.txt")).unwrap(), b"BBB\n");
    assert_eq!(fs::read(cwd.join("b.txt")).unwrap(), b"AAA\n");
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let rest = gitx_meta::read_shelf_patch(&common, &entry.id).unwrap();
    assert!(!String::from_utf8_lossy(&rest).contains("rename"));
}

#[tokio::test]
async fn a_failed_rename_retains_both_source_and_destination() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cwd = repo.path();
    let cancel = CancellationToken::new();
    setup(&runner, cwd).await;
    git(&runner, cwd, &["mv", "README.md", "renamed.txt"]).await;
    fs::write(cwd.join("z-good.txt"), b"saved\n").unwrap();
    git(&runner, cwd, &["add", "."]).await;
    let patch = git(
        &runner,
        cwd,
        &[
            "diff",
            "--cached",
            "--binary",
            "--full-index",
            "--find-renames",
        ],
    )
    .await;
    let entry = import(&runner, cwd, &patch).await;
    git(&runner, cwd, &["reset", "--hard", "HEAD"]).await;
    fs::write(cwd.join("README.md"), b"dirty rename source\n").unwrap();
    let (applied, failed) = runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .unwrap();
    assert_eq!(applied, ["z-good.txt"]);
    assert_eq!(failed, ["README.md", "renamed.txt"]);
    assert_eq!(
        fs::read(cwd.join("README.md")).unwrap(),
        b"dirty rename source\n"
    );
    assert!(!cwd.join("renamed.txt").exists());
    git(&runner, cwd, &["restore", "README.md"]).await;
    let (applied, failed) = runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .unwrap();
    assert_eq!(applied, ["README.md", "renamed.txt"]);
    assert!(failed.is_empty());
    assert!(!cwd.join("README.md").exists());
    assert_eq!(fs::read(cwd.join("renamed.txt")).unwrap(), b"base\n");
}

#[tokio::test]
async fn binary_deletion_and_quoted_unicode_sections_keep_their_exact_payloads() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cwd = repo.path();
    let cancel = CancellationToken::new();
    setup(&runner, cwd).await;
    fs::write(cwd.join("asset.bin"), [0, 1, 2]).unwrap();
    fs::write(cwd.join("中文 file.txt"), b"old unicode\n").unwrap();
    git(&runner, cwd, &["add", "."]).await;
    git(&runner, cwd, &["commit", "-m", "binary and unicode"]).await;
    fs::write(cwd.join("asset.bin"), [0, 8, 9, 10]).unwrap();
    fs::write(cwd.join("中文 file.txt"), b"saved unicode\n").unwrap();
    fs::remove_file(cwd.join("other.txt")).unwrap();
    let entry = runner
        .shelve_changes(
            cwd,
            "mixed",
            &[
                "asset.bin".into(),
                "中文 file.txt".into(),
                "other.txt".into(),
            ],
            false,
            None,
            false,
            &cancel,
        )
        .await
        .unwrap();
    fs::write(cwd.join("asset.bin"), [0, 55, 66]).unwrap();
    let (applied, failed) = runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .unwrap();
    assert_eq!(applied, ["other.txt", "中文 file.txt"]);
    assert_eq!(failed, ["asset.bin"]);
    assert!(!cwd.join("other.txt").exists());
    assert_eq!(
        fs::read(cwd.join("中文 file.txt")).unwrap(),
        b"saved unicode\n"
    );
    assert_eq!(fs::read(cwd.join("asset.bin")).unwrap(), [0, 55, 66]);
    assert!(runner.shelf_list(cwd, &cancel).await.unwrap()[0].binary);
    git(&runner, cwd, &["restore", "asset.bin"]).await;
    runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .unwrap();
    assert_eq!(fs::read(cwd.join("asset.bin")).unwrap(), [0, 8, 9, 10]);
}

#[tokio::test]
async fn an_index_lock_stops_application_and_keeps_the_complete_backup() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cwd = repo.path();
    let cancel = CancellationToken::new();
    setup(&runner, cwd).await;
    let entry = shelve_two(&runner, cwd).await;
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let before = gitx_meta::read_shelf_patch(&common, &entry.id).unwrap();
    fs::write(common.join("index.lock"), b"another writer").unwrap();
    assert!(runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .is_err());
    assert_eq!(
        gitx_meta::read_shelf_patch(&common, &entry.id).unwrap(),
        before
    );
    assert_eq!(fs::read(cwd.join("README.md")).unwrap(), b"base\n");
    assert_eq!(fs::read(cwd.join("z-good.txt")).unwrap(), b"base good\n");
}

#[tokio::test]
async fn mode_only_and_file_directory_transitions_survive_a_separate_failure() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cwd = repo.path();
    let cancel = CancellationToken::new();
    setup(&runner, cwd).await;
    fs::write(cwd.join("node"), b"file before directory\n").unwrap();
    fs::write(cwd.join("run.sh"), b"echo test\n").unwrap();
    git(&runner, cwd, &["add", "."]).await;
    git(&runner, cwd, &["commit", "-m", "transition base"]).await;
    fs::remove_file(cwd.join("node")).unwrap();
    fs::create_dir(cwd.join("node")).unwrap();
    fs::write(cwd.join("node/child.txt"), b"new child\n").unwrap();
    fs::write(cwd.join("README.md"), b"saved readme\n").unwrap();
    git(&runner, cwd, &["add", "."]).await;
    git(&runner, cwd, &["update-index", "--chmod=+x", "run.sh"]).await;
    let patch = git(
        &runner,
        cwd,
        &[
            "diff",
            "--cached",
            "--no-renames",
            "--binary",
            "--full-index",
        ],
    )
    .await;
    let entry = import(&runner, cwd, &patch).await;
    git(&runner, cwd, &["reset", "--hard", "HEAD"]).await;
    fs::write(cwd.join("README.md"), b"local readme\n").unwrap();
    let (applied, failed) = runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .unwrap();
    assert_eq!(applied, ["node", "node/child.txt", "run.sh"]);
    assert_eq!(failed, ["README.md"]);
    assert_eq!(
        fs::read(cwd.join("node/child.txt")).unwrap(),
        b"new child\n"
    );
    assert!(
        String::from_utf8_lossy(&git(&runner, cwd, &["ls-files", "--stage", "run.sh"]).await)
            .starts_with("100755 ")
    );
}

#[tokio::test]
async fn a_copy_and_edits_to_its_source_stay_in_one_application_group() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cwd = repo.path();
    let cancel = CancellationToken::new();
    setup(&runner, cwd).await;
    let copy = b"diff --git a/README.md b/copied.txt\nsimilarity index 100%\ncopy from README.md\ncopy to copied.txt\n";
    fs::write(cwd.join("README.md"), b"saved source edit\n").unwrap();
    fs::write(cwd.join("z-good.txt"), b"saved good\n").unwrap();
    let mut patch = copy.to_vec();
    patch.extend(git(&runner, cwd, &["diff", "--binary", "--full-index"]).await);
    let entry = import(&runner, cwd, &patch).await;
    git(&runner, cwd, &["restore", "."]).await;
    fs::write(cwd.join("README.md"), b"local source edit\n").unwrap();
    let (applied, failed) = runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .unwrap();
    assert_eq!(applied, ["z-good.txt"]);
    assert_eq!(failed, ["README.md", "copied.txt"]);
    assert!(!cwd.join("copied.txt").exists());
    assert_eq!(
        fs::read(cwd.join("README.md")).unwrap(),
        b"local source edit\n"
    );
}

#[tokio::test]
async fn clean_large_shelf_applies_all_files_and_reports_actual_patch_paths() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cwd = repo.path();
    let cancel = CancellationToken::new();
    setup(&runner, cwd).await;
    let paths: Vec<_> = (0..128).map(|n| format!("file-{n:03}.txt")).collect();
    for path in &paths {
        fs::write(cwd.join(path), b"before\n").unwrap();
    }
    git(&runner, cwd, &["add", "."]).await;
    git(&runner, cwd, &["commit", "-m", "many files"]).await;
    for path in &paths {
        fs::write(cwd.join(path), b"after\n").unwrap();
    }
    let entry = runner
        .shelve_changes(cwd, "large", &paths, false, None, false, &cancel)
        .await
        .unwrap();
    let (applied, failed) = runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .unwrap();
    assert_eq!(applied, paths);
    assert!(failed.is_empty());
    for path in &paths {
        assert_eq!(fs::read(cwd.join(path)).unwrap(), b"after\n");
    }
    assert!(runner.shelf_list(cwd, &cancel).await.unwrap().is_empty());
}

#[cfg(windows)]
#[tokio::test]
async fn a_storage_failure_after_partial_application_reports_progress_and_keeps_the_backup() {
    use std::os::windows::fs::OpenOptionsExt;
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let runner = GitRunner::new("git");
    let cwd = repo.path();
    let cancel = CancellationToken::new();
    setup(&runner, cwd).await;
    let entry = shelve_two(&runner, cwd).await;
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let original = gitx_meta::read_shelf_patch(&common, &entry.id).unwrap();
    fs::write(cwd.join("README.md"), b"local\n").unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(gitx_meta::shelf_dir(&common, &entry.id).join("meta.json"))
        .unwrap();
    let error = runner
        .unshelve(cwd, &entry.id, true, &cancel)
        .await
        .unwrap_err();
    assert!(error.message.contains("Applied 1 paths"));
    assert!(error.message.contains("saved contents were preserved"));
    drop(lock);
    assert_eq!(
        gitx_meta::read_shelf_patch(&common, &entry.id).unwrap(),
        original
    );
    assert_eq!(fs::read(cwd.join("README.md")).unwrap(), b"local\n");
    assert_eq!(fs::read(cwd.join("z-good.txt")).unwrap(), b"shelved good\n");
}
