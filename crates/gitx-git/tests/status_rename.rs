use gitx_core::FileChangeKind;
use gitx_git::{parse_status_porcelain_v2, GitRunner};
use gitx_testkit::FixtureBuilder;
use tokio_util::sync::CancellationToken;

#[test]
fn rename_and_copy_consume_the_nul_separated_source_path() {
    for status in ["R", "C"] {
        // Tabs/newlines are literal filename bytes in -z output. A source path
        // that resembles another status record must not become a fake file.
        let raw = format!(
            "# branch.head main\0\
             2 {status}. N... 100644 100644 100644 abc abc {status}100 新\tname.txt\0\
             ? old\nname.txt\0\
             1 .M N... 100644 100644 100644 abc abc next.txt\0"
        );
        let snapshot = parse_status_porcelain_v2(raw.as_bytes(), "repo", 1);
        assert_eq!(
            snapshot.files.len(),
            2,
            "source must be consumed: {snapshot:?}"
        );
        let renamed = &snapshot.files[0];
        assert_eq!(renamed.path, "新\tname.txt");
        assert_eq!(renamed.orig_path.as_deref(), Some("? old\nname.txt"));
        assert_eq!(renamed.index_status, status);
        assert_eq!(
            renamed.kind,
            if status == "C" {
                FileChangeKind::Copied
            } else {
                FileChangeKind::Renamed
            }
        );
        assert_eq!(snapshot.files[1].path, "next.txt");
    }
}

#[tokio::test]
async fn real_staged_rename_retains_both_paths_and_reads_equal_blobs() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let output = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["mv", "--", "README.md", "重命名 file.md"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let snapshot = runner
        .status_get(repo.path(), "repo", 1, &cancel)
        .await
        .unwrap();
    assert_eq!(snapshot.files.len(), 1);
    let renamed = &snapshot.files[0];
    assert_eq!(renamed.path, "重命名 file.md");
    assert_eq!(renamed.orig_path.as_deref(), Some("README.md"));
    assert_eq!(renamed.index_status, "R");
    assert_eq!(renamed.worktree_status, ".");
    let old = runner
        .read_blob_at(
            repo.path(),
            "HEAD",
            renamed.orig_path.as_deref().unwrap(),
            &cancel,
        )
        .await
        .unwrap();
    let new = runner
        .read_blob_at(repo.path(), "INDEX", &renamed.path, &cancel)
        .await
        .unwrap();
    assert!(old.is_some());
    assert_eq!(old, new);
}
