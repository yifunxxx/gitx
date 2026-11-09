use super::*;
use gitx_testkit::{FixtureBuilder, FixtureRepo};
use std::{fs, process::Command};

fn git(path: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn fixture() -> FixtureRepo {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    git(repo.path(), &["config", "core.autocrlf", "false"]);
    repo
}

fn commit(path: &Path, message: &str) -> String {
    git(path, &["add", "-A"]);
    git(path, &["commit", "-m", message]);
    git(path, &["rev-parse", "HEAD"])
}

#[derive(Debug, PartialEq, Eq)]
struct Snapshot {
    head: String,
    symbolic_head: String,
    index: Vec<u8>,
    files: Vec<(PathBuf, Vec<u8>)>,
}

fn snapshot(path: &Path) -> Snapshot {
    fn collect(root: &Path, path: &Path, files: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in fs::read_dir(path).unwrap() {
            let entry = entry.unwrap();
            if entry.file_name() == ".git" {
                continue;
            }
            if entry.file_type().unwrap().is_dir() {
                collect(root, &entry.path(), files);
            } else {
                files.push((
                    entry.path().strip_prefix(root).unwrap().to_owned(),
                    fs::read(entry.path()).unwrap(),
                ));
            }
        }
    }
    let mut files = Vec::new();
    collect(path, path, &mut files);
    files.sort();
    let index = git(path, &["rev-parse", "--git-path", "index"]);
    Snapshot {
        head: git(path, &["rev-parse", "HEAD"]),
        symbolic_head: git(path, &["symbolic-ref", "HEAD"]),
        index: fs::read(path.join(index)).unwrap(),
        files,
    }
}

fn make_dirty(path: &Path) {
    fs::write(path.join("README.md"), "staged local content\n").unwrap();
    git(path, &["add", "README.md"]);
    fs::write(path.join("README.md"), "unstaged local content\n").unwrap();
    fs::write(path.join("untracked.txt"), "untracked local content\n").unwrap();
}

#[tokio::test]
async fn temporary_index_replays_all_paths_from_a_subdirectory() {
    let repo = fixture();
    let path = repo.path();
    let base = git(path, &["rev-parse", "HEAD"]);
    fs::create_dir(path.join("nested")).unwrap();
    fs::write(path.join("outside.txt"), "outside\n").unwrap();
    fs::write(path.join("nested/inside.txt"), "inside\n").unwrap();
    let theirs = commit(path, "changes inside and outside the opened directory");
    let expected_tree = git(path, &["rev-parse", "HEAD^{tree}"]);
    make_dirty(path);
    let before = snapshot(path);

    let tree = GitRunner::new("git")
        .replay_with_temporary_index(
            &path.join("nested"),
            &base,
            &base,
            &theirs,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(tree, expected_tree);
    assert_eq!(snapshot(path), before);
}

#[tokio::test]
async fn temporary_index_merges_independent_edits_without_touching_local_changes() {
    let repo = fixture();
    let path = repo.path();
    fs::write(path.join("both.txt"), "first\n2\n3\n4\n5\nlast\n").unwrap();
    let base = commit(path, "base");
    fs::write(path.join("both.txt"), "first\n2\n3\n4\n5\ntheirs\n").unwrap();
    let theirs = commit(path, "theirs");
    git(path, &["checkout", "-b", "ours", &base]);
    fs::write(path.join("both.txt"), "ours\n2\n3\n4\n5\nlast\n").unwrap();
    let ours = commit(path, "ours");
    make_dirty(path);
    let before = snapshot(path);

    let tree = GitRunner::new("git")
        .replay_with_temporary_index(path, &ours, &base, &theirs, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        git(path, &["show", &format!("{tree}:both.txt")]),
        "ours\n2\n3\n4\n5\ntheirs"
    );
    assert_eq!(snapshot(path), before);
}

#[tokio::test]
async fn temporary_index_conflict_preserves_head_index_and_worktree() {
    let repo = fixture();
    let path = repo.path();
    fs::write(path.join("conflict.txt"), "base\n").unwrap();
    let base = commit(path, "base");
    fs::write(path.join("conflict.txt"), "theirs\n").unwrap();
    let theirs = commit(path, "theirs");
    git(path, &["checkout", "-b", "ours", &base]);
    fs::write(path.join("conflict.txt"), "ours\n").unwrap();
    let ours = commit(path, "ours");
    make_dirty(path);
    let before = snapshot(path);

    let error = GitRunner::new("git")
        .replay_with_temporary_index(path, &ours, &base, &theirs, &CancellationToken::new())
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::RewriteConflict);
    assert_eq!(snapshot(path), before);
}

#[tokio::test]
async fn temporary_index_handles_binary_rename_delete_and_mode_changes() {
    let repo = fixture();
    let path = repo.path();
    fs::write(path.join("old.txt"), "rename this\n").unwrap();
    fs::write(path.join("delete.txt"), "delete this\n").unwrap();
    fs::write(path.join("binary.dat"), [0, 1, 2, 3, 255]).unwrap();
    let base = commit(path, "base");
    git(path, &["mv", "old.txt", "renamed.txt"]);
    git(path, &["rm", "delete.txt"]);
    fs::write(path.join("binary.dat"), [0, 1, 7, 8, 254]).unwrap();
    fs::write(path.join("script.sh"), "#!/bin/sh\nexit 0\n").unwrap();
    git(path, &["add", "-A"]);
    git(path, &["update-index", "--chmod=+x", "script.sh"]);
    git(
        path,
        &["commit", "-m", "binary rename delete and executable"],
    );
    let theirs = git(path, &["rev-parse", "HEAD"]);
    let expected_tree = git(path, &["rev-parse", "HEAD^{tree}"]);
    make_dirty(path);
    let before = snapshot(path);

    let tree = GitRunner::new("git")
        .replay_with_temporary_index(path, &base, &base, &theirs, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(tree, expected_tree);
    assert_eq!(snapshot(path), before);
}

#[tokio::test]
async fn temporary_index_patch_is_independent_of_diff_display_settings() {
    let repo = fixture();
    let path = repo.path();
    fs::create_dir(path.join("nested")).unwrap();
    fs::write(path.join("nested/file.txt"), "old\n").unwrap();
    fs::write(path.join("file.txt"), "root file must stay unchanged\n").unwrap();
    let base = commit(path, "base");
    fs::write(path.join("nested/file.txt"), "new\n").unwrap();
    let theirs = commit(path, "change nested file");
    let expected_tree = git(path, &["rev-parse", "HEAD^{tree}"]);
    git(path, &["config", "diff.noprefix", "true"]);
    git(path, &["config", "diff.mnemonicPrefix", "true"]);
    git(path, &["config", "diff.relative", "true"]);
    git(path, &["config", "color.ui", "always"]);
    git(path, &["config", "diff.outputIndicatorNew", ">"]);
    git(path, &["config", "diff.outputIndicatorOld", "<"]);
    git(path, &["config", "diff.outputIndicatorContext", "."]);
    make_dirty(path);
    let before = snapshot(path);

    let tree = GitRunner::new("git")
        .replay_with_temporary_index(
            &path.join("nested"),
            &base,
            &base,
            &theirs,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(tree, expected_tree);
    assert_eq!(snapshot(path), before);
}

#[tokio::test]
async fn temporary_index_empty_replay_keeps_ours_tree() {
    let repo = fixture();
    let path = repo.path();
    let base = git(path, &["rev-parse", "HEAD"]);
    fs::write(path.join("ours.txt"), "ours\n").unwrap();
    let ours = commit(path, "ours");
    let expected_tree = git(path, &["rev-parse", "HEAD^{tree}"]);
    let before = snapshot(path);
    let tree = GitRunner::new("git")
        .replay_with_temporary_index(path, &ours, &base, &base, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(tree, expected_tree);
    assert_eq!(snapshot(path), before);
}

#[tokio::test]
async fn temporary_index_does_not_run_diff_text_converters() {
    let repo = fixture();
    let path = repo.path();
    fs::write(path.join(".gitattributes"), "*.txt diff=qa\n").unwrap();
    fs::write(path.join("file.txt"), "old\n").unwrap();
    let base = commit(path, "base");
    fs::write(path.join("file.txt"), "new\n").unwrap();
    let theirs = commit(path, "changed");
    let expected_tree = git(path, &["rev-parse", "HEAD^{tree}"]);
    // A display-only converter must never be invoked for the replay patch.
    git(path, &["config", "diff.qa.textconv", "false"]);
    let before = snapshot(path);
    let tree = GitRunner::new("git")
        .replay_with_temporary_index(path, &base, &base, &theirs, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(tree, expected_tree);
    assert_eq!(snapshot(path), before);
}

#[tokio::test]
async fn temporary_index_replays_gitlinks_despite_submodule_display_settings() {
    let repo = fixture();
    let path = repo.path();
    let initial = git(path, &["rev-parse", "HEAD"]);
    git(
        path,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("160000,{initial},module"),
        ],
    );
    git(path, &["commit", "-m", "initial gitlink"]);
    let base = git(path, &["rev-parse", "HEAD"]);
    git(
        path,
        &[
            "update-index",
            "--cacheinfo",
            &format!("160000,{base},module"),
        ],
    );
    git(path, &["commit", "-m", "updated gitlink"]);
    let theirs = git(path, &["rev-parse", "HEAD"]);
    let expected_tree = git(path, &["rev-parse", "HEAD^{tree}"]);
    git(path, &["config", "diff.ignoreSubmodules", "all"]);
    git(path, &["config", "diff.submodule", "log"]);
    let before = snapshot(path);
    let tree = GitRunner::new("git")
        .replay_with_temporary_index(path, &base, &base, &theirs, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(tree, expected_tree);
    assert_eq!(snapshot(path), before);
}

#[tokio::test]
async fn reword_from_nested_main_and_linked_worktrees_preserves_local_changes() {
    for linked in [false, true] {
        let repo = fixture();
        let main = repo.path();
        fs::create_dir(main.join("nested")).unwrap();
        fs::write(main.join("nested/inside.txt"), "before\n").unwrap();
        fs::write(main.join("outside.txt"), "before\n").unwrap();
        let middle = commit(main, "middle");
        fs::write(main.join("nested/inside.txt"), "after\n").unwrap();
        fs::write(main.join("outside.txt"), "after\n").unwrap();
        commit(main, "last");
        let linked_directory = tempfile::tempdir().unwrap();
        let linked_path = linked_directory.path().join("linked");
        let path = if linked {
            git(
                main,
                &[
                    "worktree",
                    "add",
                    "-b",
                    "linked",
                    linked_path.to_str().unwrap(),
                ],
            );
            linked_path.as_path()
        } else {
            main
        };
        let expected_tree = git(path, &["rev-parse", "HEAD^{tree}"]);
        make_dirty(path);
        // Populate the index's cached tree before comparing its raw bytes.
        git(path, &["write-tree"]);
        let before = snapshot(path);
        let main_before = linked.then(|| snapshot(main));
        let result = GitRunner::new("git")
            .reword_commit(
                &path.join("nested"),
                &middle,
                "rewritten middle",
                &CancellationToken::new(),
            )
            .await
            .unwrap();
        assert_eq!(result.outcome, RewriteOutcome::Success);
        assert_ne!(result.new_head, before.head);
        assert_eq!(git(path, &["rev-parse", "HEAD^{tree}"]), expected_tree);
        assert_eq!(
            git(path, &["log", "-1", "--format=%s", "HEAD~1"]),
            "rewritten middle"
        );
        let after = snapshot(path);
        assert_eq!(after.symbolic_head, before.symbolic_head);
        assert_eq!(after.index, before.index);
        assert_eq!(after.files, before.files);
        if let Some(main_before) = main_before {
            assert_eq!(snapshot(main), main_before);
        }
    }
}
