use gitx_diff::{compute_hunks, decode_lossy, DiffComputeOptions};
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use tokio_util::sync::CancellationToken;

fn git(cwd: &Path, args: &[&str], input: Option<&str>) -> String {
    let mut command = Command::new("git");
    command
        .current_dir(cwd)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if input.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command.spawn().unwrap();
    if let Some(text) = input {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(text.as_bytes())
            .unwrap();
    }
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}

#[tokio::test]
async fn conflict_head_worktree_diff_supports_missing_head_and_deleted_worktree_sides() {
    let fixture = FixtureBuilder::new().build("clean").unwrap();
    let cwd = fixture.path();
    let ours = "ours\n";
    let theirs = "theirs\n";
    let markers = "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n";
    for path in ["uu.txt", "ud.txt"] {
        std::fs::write(cwd.join(path), ours).unwrap();
    }
    git(cwd, &["add", "uu.txt", "ud.txt"], None);
    git(cwd, &["commit", "-m", "baseline conflict sides"], None);
    let base_id = git(cwd, &["hash-object", "-w", "--stdin"], Some("base\n"));
    let ours_id = git(cwd, &["hash-object", "-w", "--stdin"], Some(ours));
    let theirs_id = git(cwd, &["hash-object", "-w", "--stdin"], Some(theirs));
    let mut index = String::new();
    for (path, stages) in [
        (
            "uu.txt",
            vec![(1, &base_id), (2, &ours_id), (3, &theirs_id)],
        ),
        ("aa.txt", vec![(2, &ours_id), (3, &theirs_id)]),
        ("ud.txt", vec![(1, &base_id), (2, &ours_id)]),
        ("du.txt", vec![(1, &base_id), (3, &theirs_id)]),
    ] {
        index.push_str(&format!("0 {}\t{path}\n", "0".repeat(40)));
        for (stage, oid) in stages {
            index.push_str(&format!("100644 {oid} {stage}\t{path}\n"));
        }
    }
    git(cwd, &["update-index", "--index-info"], Some(&index));
    std::fs::write(cwd.join("uu.txt"), markers).unwrap();
    std::fs::write(cwd.join("aa.txt"), markers).unwrap();
    std::fs::remove_file(cwd.join("ud.txt")).unwrap();
    std::fs::write(cwd.join("du.txt"), theirs).unwrap();
    let status = git(cwd, &["status", "--porcelain"], None);
    for expected in ["UU uu.txt", "AA aa.txt", "UD ud.txt", "DU du.txt"] {
        assert!(status.lines().any(|line| line == expected), "{status}");
    }

    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for (path, expected_head, expected_worktree) in [
        ("uu.txt", Some(ours), Some(markers)),
        ("aa.txt", None, Some(markers)),
        ("ud.txt", Some(ours), None),
        ("du.txt", None, Some(theirs)),
    ] {
        let head = runner
            .read_blob_at(cwd, "HEAD", path, &cancel)
            .await
            .unwrap();
        let worktree = runner
            .read_blob_at(cwd, "WORKTREE", path, &cancel)
            .await
            .unwrap();
        let left = decode_lossy(head.as_deref());
        let right = decode_lossy(worktree.as_deref());
        assert_eq!(left.as_deref(), expected_head, "HEAD for {path}");
        assert_eq!(right.as_deref(), expected_worktree, "WORKTREE for {path}");
        assert!(
            !compute_hunks(
                left.as_deref(),
                right.as_deref(),
                &DiffComputeOptions::default()
            )
            .is_empty(),
            "diff for {path}"
        );
        // Preserve the reader's distinction between an absent file and a
        // conflicted index: the UI must choose real sides, not hide this error.
        assert!(
            runner
                .read_blob_at(cwd, "INDEX", path, &cancel)
                .await
                .is_err(),
            "INDEX for {path}"
        );
    }
}
