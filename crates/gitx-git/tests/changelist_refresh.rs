use gitx_core::{ChangelistsState, DiffSide, ErrorCode, PathAssignment};
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

async fn assign(cwd: &Path, paths: &[&str]) -> ChangelistsState {
    let mut state = gitx_meta::load_changelists(&cwd.join(".git")).unwrap();
    let anchors = gitx_diff::hunk_anchors(&gitx_diff::compute_hunks(
        Some("base\n"),
        Some("work\n"),
        &Default::default(),
    ));
    state.assignments.clear();
    for path in paths {
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let head = runner
            .read_blob_side(cwd, path, DiffSide::Head, &cancel)
            .await
            .unwrap_or(None);
        let work = runner
            .read_blob_side(cwd, path, DiffSide::Worktree, &cancel)
            .await
            .unwrap_or(None);
        let current = gitx_diff::hunk_anchors(&gitx_diff::compute_hunks(
            gitx_diff::decode_lossy(head.as_deref()).as_deref(),
            gitx_diff::decode_lossy(work.as_deref()).as_deref(),
            &Default::default(),
        ));
        state.assignments.push(PathAssignment {
            path: (*path).into(),
            list_id: "default".into(),
            hunk_ranges: if current.is_empty() {
                anchors.clone()
            } else {
                current
            },
        });
    }
    std::fs::create_dir_all(cwd.join(".git/gitx")).unwrap();
    std::fs::write(
        cwd.join(".git/gitx/changelists.json"),
        serde_json::to_vec(&state).unwrap(),
    )
    .unwrap();
    state
}

async fn resolve(cwd: &Path) -> ChangelistsState {
    GitRunner::new("git")
        .changelist_resolve(cwd, &CancellationToken::new())
        .await
        .unwrap()
}

#[tokio::test]
async fn batch_matches_single_file_previews_and_observes_new_head() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]).await;
    let paths = [
        "with spaces.txt",
        "[literal].txt",
        "中文.txt",
        "empty.txt",
        "deleted.txt",
        "new.txt",
    ];
    for path in &paths[..5] {
        std::fs::write(
            cwd.join(path),
            if *path == "empty.txt" { "" } else { "base\n" },
        )
        .unwrap();
    }
    git(cwd, &["add", "."]).await;
    git(cwd, &["commit", "-m", "base"]).await;
    for path in &paths {
        std::fs::write(cwd.join(path), "work\n").unwrap();
    }
    std::fs::remove_file(cwd.join("deleted.txt")).unwrap();
    assign(cwd, &paths).await;
    let index = std::fs::read(cwd.join(".git/index")).unwrap();
    let batch = resolve(cwd).await;
    assert_eq!(batch.partial_files.len(), paths.len());
    assert!(batch.warnings.is_empty());
    for path in &paths {
        assign(cwd, &[*path]).await;
        let single = resolve(cwd).await;
        let file = batch
            .partial_files
            .iter()
            .find(|file| file.path == *path)
            .unwrap();
        assert_eq!(
            serde_json::to_value(file).unwrap(),
            serde_json::to_value(&single.partial_files[0]).unwrap()
        );
    }
    assert_eq!(std::fs::read(cwd.join(".git/index")).unwrap(), index);
    assign(cwd, &paths).await;
    git(cwd, &["add", "."]).await;
    git(cwd, &["commit", "-m", "new head"]).await;
    let fresh = resolve(cwd).await;
    assert!(fresh.warnings.is_empty());
    assert!(fresh.partial_files.iter().all(|file| file.hunks.is_empty()));
    assert!(fresh
        .partial_files
        .iter()
        .zip(&batch.partial_files)
        .all(|(new, old)| new.content_token != old.content_token));
}

#[tokio::test]
async fn unborn_head_and_empty_metadata_remain_read_only() {
    let repo = FixtureBuilder::new().build("empty").unwrap();
    let cwd = repo.path();
    assert!(resolve(cwd).await.partial_files.is_empty());
    for path in ["one.txt", "two.txt", "three.txt", "four.txt"] {
        std::fs::write(cwd.join(path), "work\n").unwrap();
    }
    assign(cwd, &["one.txt", "two.txt", "three.txt", "four.txt"]).await;
    let metadata = std::fs::read(cwd.join(".git/gitx/changelists.json")).unwrap();
    let result = resolve(cwd).await;
    assert!(result.warnings.is_empty());
    assert!(result
        .partial_files
        .iter()
        .all(|file| file.hunks.len() == 1));
    assert!(!cwd.join(".git/index").exists());
    assert_eq!(
        std::fs::read(cwd.join(".git/gitx/changelists.json")).unwrap(),
        metadata
    );
}

#[tokio::test]
async fn missing_blob_and_tree_are_errors_while_absent_path_is_a_new_file() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(cwd.join("lost.txt"), "unique lost object\n").unwrap();
    std::fs::create_dir(cwd.join("tree")).unwrap();
    std::fs::write(cwd.join("tree/child.txt"), "child\n").unwrap();
    git(cwd, &["add", "."]).await;
    git(cwd, &["commit", "-m", "objects"]).await;
    let oid = String::from_utf8(git(cwd, &["rev-parse", "HEAD:lost.txt"]).await).unwrap();
    let oid = oid.trim();
    std::fs::remove_file(cwd.join(".git/objects").join(&oid[..2]).join(&oid[2..])).unwrap();
    std::fs::remove_file(cwd.join("tree/child.txt")).unwrap();
    std::fs::remove_dir(cwd.join("tree")).unwrap();
    std::fs::write(cwd.join("new.txt"), "work\n").unwrap();
    assign(cwd, &["lost.txt", "tree", "new.txt", "README.md"]).await;
    let result = resolve(cwd).await;
    assert_eq!(result.warnings.len(), 2);
    for path in ["lost.txt", "tree"] {
        let file = result
            .partial_files
            .iter()
            .find(|file| file.path == path)
            .unwrap();
        assert!(file.problem.is_some());
        assert!(file.content_token.is_empty());
    }
    let new = result
        .partial_files
        .iter()
        .find(|file| file.path == "new.txt")
        .unwrap();
    assert!(new.problem.is_none());
    assert_eq!(new.hunks.len(), 1);
    assert!(result
        .partial_files
        .iter()
        .find(|file| file.path == "README.md")
        .unwrap()
        .problem
        .is_none());
}

#[tokio::test]
async fn binary_oversized_invalid_encoding_and_unsafe_paths_keep_per_file_errors() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("binary"), b"a\0b").unwrap();
    std::fs::write(cwd.join("encoding"), [0xff, 0xfe, 0x31]).unwrap();
    std::fs::write(
        cwd.join("large"),
        vec![b'x'; gitx_diff::TOO_LARGE_BYTES + 1],
    )
    .unwrap();
    git(cwd, &["add", "."]).await;
    git(cwd, &["commit", "-m", "unsupported"]).await;
    assign(
        cwd,
        &["binary", "encoding", "large", "../outside", "README.md"],
    )
    .await;
    let result = resolve(cwd).await;
    assert_eq!(result.warnings.len(), 4);
    assert_eq!(
        result
            .partial_files
            .iter()
            .filter(|file| file.problem.is_none())
            .count(),
        1
    );
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        GitRunner::new("git")
            .changelist_resolve(cwd, &cancel)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Cancelled
    );
}

#[cfg(unix)]
#[tokio::test]
async fn line_separator_paths_use_exact_fallback_without_affecting_neighbours() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let paths = ["line\nbreak", "carriage\rreturn", "tab\tname", "other"];
    for path in paths {
        std::fs::write(cwd.join(path), "base\n").unwrap();
    }
    git(cwd, &["add", "."]).await;
    git(cwd, &["commit", "-m", "names"]).await;
    for path in paths {
        std::fs::write(cwd.join(path), "work\n").unwrap();
    }
    assign(cwd, &paths).await;
    let result = resolve(cwd).await;
    assert!(result.warnings.is_empty());
    assert_eq!(result.partial_files.len(), paths.len());
    assert!(result
        .partial_files
        .iter()
        .all(|file| file.hunks.len() == 1));
}
