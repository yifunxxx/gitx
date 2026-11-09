use gitx_core::ErrorCode;
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::path::Path;
use tokio_util::sync::CancellationToken;

fn git(cwd: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

#[tokio::test]
async fn partial_changes_preserve_literal_names_renames_and_local_edits() {
    for extract in [true, false] {
        let repo = FixtureBuilder::new().build("linear-history").unwrap();
        let cwd = repo.path();
        std::fs::create_dir(cwd.join("nested")).unwrap();
        let added = "nested/中文,[ab].txt";
        let renamed = "nested/renamed,a.txt";
        std::fs::write(cwd.join(added), "added\n").unwrap();
        std::fs::write(cwd.join("nested/中文,a.txt"), "unselected\n").unwrap();
        git(cwd, &["mv", "a.txt", renamed]);
        git(cwd, &["rm", "b.txt"]);
        std::fs::write(cwd.join("c.txt"), "changed c\n").unwrap();
        git(cwd, &["add", "."]);
        git(cwd, &["commit", "-m", "multiple changes"]);
        let commit = git(cwd, &["rev-parse", "HEAD"]).trim().to_owned();
        let original_tree = git(cwd, &["rev-parse", "HEAD^{tree}"]);
        // Replay a later commit, without touching staged/unstaged/untracked data.
        std::fs::write(cwd.join("later.txt"), "later\n").unwrap();
        git(cwd, &["add", "."]);
        git(cwd, &["commit", "-m", "later"]);
        let final_tree = git(cwd, &["rev-parse", "HEAD^{tree}"]);
        std::fs::write(cwd.join(added), "staged\n").unwrap();
        git(cwd, &["add", "--", added]);
        std::fs::write(cwd.join(added), "unstaged\n").unwrap();
        std::fs::write(cwd.join("local.txt"), "untracked\n").unwrap();
        let index = git(cwd, &["write-tree"]);
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let selected = [added.into(), renamed.into(), "b.txt".into(), "c.txt".into()];
        let subdir = cwd.join("nested");
        if extract {
            runner
                .extract_changes(&subdir, &commit, &selected, "extracted", &cancel)
                .await
                .unwrap();
            assert_eq!(git(cwd, &["rev-parse", "HEAD^{tree}"]), final_tree);
            assert_eq!(git(cwd, &["rev-parse", "HEAD~1^{tree}"]), original_tree);
            let names = git(cwd, &["diff-tree", "-r", "--name-only", "-z", "HEAD~1"]);
            for path in [added, renamed, "a.txt", "b.txt", "c.txt"] {
                assert!(
                    names.split('\0').any(|name| name == path),
                    "missing {path}: {names:?}"
                );
            }
        } else {
            runner
                .drop_changes(&subdir, &commit, &selected, &cancel)
                .await
                .unwrap();
        }
        let remaining = if extract { "HEAD~2" } else { "HEAD~1" };
        assert_eq!(git(cwd, &["show", &format!("{remaining}:a.txt")]), "a\n");
        assert_eq!(git(cwd, &["show", &format!("{remaining}:b.txt")]), "b\n");
        assert_eq!(git(cwd, &["show", &format!("{remaining}:c.txt")]), "c\n");
        let names = git(cwd, &["ls-tree", "-rz", "--name-only", remaining]);
        assert!(!names
            .split('\0')
            .any(|name| name == added || name == renamed));
        assert!(names.split('\0').any(|name| name == "nested/中文,a.txt"));
        assert_eq!(git(cwd, &["write-tree"]), index);
        assert_eq!(
            std::fs::read_to_string(cwd.join(added)).unwrap(),
            "unstaged\n"
        );
        assert_eq!(
            std::fs::read_to_string(cwd.join("local.txt")).unwrap(),
            "untracked\n"
        );
        assert_eq!(git(cwd, &["show", &format!(":{added}")]), "staged\n");
        assert!(!std::fs::read_dir(cwd.join(".git"))
            .unwrap()
            .any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("gitx-partial-")));
    }
}

#[tokio::test]
async fn partial_changes_reject_invalid_selection_and_descendant_merges_without_ref_changes() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let before = git(cwd, &["show-ref"]);
    for paths in [
        vec![],
        vec!["a.txt".into()],
        vec!["*.txt".into()],
        vec!["c.txt".into(), "missing".into()],
    ] {
        assert_eq!(
            runner
                .extract_changes(cwd, "HEAD", &paths, "invalid", &cancel)
                .await
                .unwrap_err()
                .code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(git(cwd, &["show-ref"]), before);
    }
    git(cwd, &["checkout", "-b", "side", "HEAD~1"]);
    std::fs::write(cwd.join("side.txt"), "side").unwrap();
    git(cwd, &["add", "."]);
    git(cwd, &["commit", "-m", "side"]);
    git(cwd, &["checkout", "-"]);
    git(cwd, &["merge", "side", "--no-ff", "-m", "merge"]);
    let before = git(cwd, &["show-ref"]);
    assert_eq!(
        runner
            .extract_changes(cwd, "HEAD~1", &["c.txt".into()], "unsafe", &cancel)
            .await
            .unwrap_err()
            .code,
        ErrorCode::MergeCommitNotAllowed
    );
    assert_eq!(git(cwd, &["show-ref"]), before);
}

#[tokio::test]
async fn extract_root_commit_in_linked_worktree() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let temp = tempfile::tempdir().unwrap();
    let linked = temp.path().join("linked");
    git(
        repo.path(),
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    );
    let original = git(repo.path(), &["rev-parse", "HEAD"]);
    let tree = git(&linked, &["rev-parse", "HEAD^{tree}"]);
    GitRunner::new("git")
        .extract_changes(
            &linked,
            "HEAD~2",
            &["a.txt".into()],
            "root extracted",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(git(&linked, &["rev-parse", "HEAD^{tree}"]), tree);
    assert_eq!(git(&linked, &["ls-tree", "--name-only", "HEAD~3"]), "");
    assert_eq!(git(&linked, &["show", "HEAD~2:a.txt"]), "a\n");
    assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), original);
}
