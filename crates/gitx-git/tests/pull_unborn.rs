use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::{fs, path::Path, process::Command};
use tokio_util::sync::CancellationToken;

fn git(cwd: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim_end().to_owned()
}

async fn first_pull(rebase: bool, no_commit: bool) {
    let remote = FixtureBuilder::new().build("with-remote").unwrap();
    let source = remote.path();
    git(source, &["config", "core.autocrlf", "false"]);
    fs::create_dir(source.join("目录")).unwrap();
    fs::write(source.join("目录/new file.txt"), "incoming bytes\n").unwrap();
    fs::write(source.join("binary.bin"), [0, 255, 17, 13, 10]).unwrap();
    git(source, &["add", "--all"]);
    git(source, &["commit", "-m", "Incoming files"]);
    git(source, &["push"]);
    let tip = git(source, &["rev-parse", "HEAD"]);
    let expected_commits: Vec<String> = git(source, &["log", "--oneline"])
        .lines()
        .map(str::to_owned)
        .collect();
    let path = source.parent().unwrap().join("empty-workspace");
    fs::create_dir(&path).unwrap();
    git(&path, &["init", "-b", "main"]);
    git(&path, &["config", "core.autocrlf", "false"]);
    git(&path, &["config", "user.name", "QA"]);
    git(&path, &["config", "user.email", "qa@example.invalid"]);
    git(
        &path,
        &[
            "remote",
            "add",
            "origin",
            &git(source, &["remote", "get-url", "origin"]),
        ],
    );
    fs::write(path.join("keep-untracked.txt"), "keep local\n").unwrap();
    let result = GitRunner::new("git")
        .pull_run(
            &path,
            "origin",
            "main",
            rebase,
            false,
            false,
            false,
            no_commit,
            false,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(result.old_head.is_empty());
    assert_eq!(result.new_head, tip);
    assert!(result.updated);
    assert_eq!(result.commits, expected_commits);
    assert_eq!(git(&path, &["diff", "--cached", "--name-only"]), "");
    assert_eq!(
        fs::read(path.join("binary.bin")).unwrap(),
        [0, 255, 17, 13, 10]
    );
    assert_eq!(
        fs::read_to_string(path.join("目录/new file.txt")).unwrap(),
        "incoming bytes\n"
    );
    assert_eq!(
        fs::read_to_string(path.join("keep-untracked.txt")).unwrap(),
        "keep local\n"
    );
    let mut files: Vec<_> = result
        .updated_files
        .iter()
        .map(|f| (f.path.as_str(), f.status.as_str()))
        .collect();
    files.sort();
    assert_eq!(
        files,
        vec![
            ("README.md", "A"),
            ("binary.bin", "A"),
            ("目录/new file.txt", "A")
        ]
    );
    let repeated = GitRunner::new("git")
        .pull_run(
            &path,
            "origin",
            "main",
            rebase,
            false,
            false,
            false,
            no_commit,
            false,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(!repeated.updated);
    assert!(repeated.updated_files.is_empty());
    assert!(repeated.commits.is_empty());
}

#[tokio::test]
async fn initial_merge_pull_lists_all_downloaded_files() {
    first_pull(false, false).await;
}

#[tokio::test]
async fn initial_rebase_pull_lists_all_downloaded_files() {
    first_pull(true, false).await;
}

#[tokio::test]
async fn initial_no_commit_pull_reports_git_initial_checkout() {
    first_pull(false, true).await;
}
