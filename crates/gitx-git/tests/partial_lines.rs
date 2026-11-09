use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::{fs, path::Path, process::Command};
use tokio_util::sync::CancellationToken;

fn git(cwd: &Path, args: &[&str]) -> Vec<u8> {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[tokio::test]
async fn stage_and_unstage_separated_partial_changes_preserve_index_and_worktree_bytes() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let base: Vec<String> = (1..=40).map(|i| format!("line {i}\n")).collect();
    fs::write(cwd.join("file.txt"), base.concat()).unwrap();
    git(cwd, &["add", "file.txt"]);
    git(cwd, &["commit", "-m", "partial fixture"]);
    let head = git(cwd, &["rev-parse", "HEAD"]);
    fs::write(cwd.join("other.txt"), "keep staged\n").unwrap();
    git(cwd, &["add", "other.txt"]);
    let other = git(cwd, &["show", ":other.txt"]);
    let mut work = base.clone();
    work.insert(0, "early\n".into());
    work[25] = "selected\n".into();
    work[27] = "unselected\n".into();
    fs::write(cwd.join("file.txt"), work.concat()).unwrap();
    let mut expected = base.clone();
    expected[24] = "selected\n".into();
    expected.insert(0, "early\n".into());
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    runner
        .stage_lines(cwd, "file.txt", &[1, 26], &cancel)
        .await
        .unwrap();
    assert_eq!(
        git(cwd, &["show", ":file.txt"]),
        expected.concat().as_bytes()
    );
    runner
        .unstage_lines(cwd, "file.txt", &[1, 26], &cancel)
        .await
        .unwrap();
    assert_eq!(git(cwd, &["show", ":file.txt"]), base.concat().as_bytes());
    assert_eq!(git(cwd, &["show", ":other.txt"]), other);
    assert_eq!(git(cwd, &["rev-parse", "HEAD"]), head);
    assert_eq!(
        fs::read(cwd.join("file.txt")).unwrap(),
        work.concat().as_bytes()
    );
}

#[tokio::test]
async fn staging_a_crlf_replacement_preserves_unselected_bytes_and_missing_final_newline() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    fs::write(cwd.join(".gitattributes"), "*.txt -text\n").unwrap();
    fs::write(cwd.join("file.txt"), "before\r\nold1\r\nold2\r\nafter").unwrap();
    git(cwd, &["add", ".gitattributes", "file.txt"]);
    git(cwd, &["commit", "-m", "byte fixture"]);
    let work = b"before\r\nnew1\r\nnew2\r\nafter";
    fs::write(cwd.join("file.txt"), work).unwrap();
    GitRunner::new("git")
        .stage_lines(cwd, "file.txt", &[2], &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        git(cwd, &["show", ":file.txt"]),
        b"before\r\nnew1\r\nold2\r\nafter"
    );
    assert_eq!(fs::read(cwd.join("file.txt")).unwrap(), work);
}
