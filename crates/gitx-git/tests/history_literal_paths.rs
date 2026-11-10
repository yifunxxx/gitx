use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};
use tokio_util::sync::CancellationToken;

fn git(cwd: &Path, args: &[&str]) -> String {
    git_input(cwd, args, &[])
}

fn git_input(cwd: &Path, args: &[&str], input: &[u8]) -> String {
    let mut child = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout)
        .unwrap()
        .trim_end_matches('\n')
        .to_string()
}

fn commit_file(cwd: &Path, path: &str, content: &str, subject: &str) -> String {
    std::fs::write(cwd.join(path), content).unwrap();
    git(cwd, &["--literal-pathspecs", "add", "--", path]);
    git(cwd, &["commit", "-m", subject]);
    git(cwd, &["rev-parse", "HEAD"])
}

#[tokio::test]
async fn chinese_and_spaces_keep_the_actual_path_for_diff() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let path = "中文 空格.txt";
    let sha = commit_file(cwd, path, "content\n", "Chinese file");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for quote in ["true", "false"] {
        git(cwd, &["config", "core.quotePath", quote]);
        let page = runner
            .file_history(cwd, path, 0, 20, false, &cancel)
            .await
            .unwrap();
        assert_eq!(page.commits.len(), 1);
        let commit = &page.commits[0];
        assert_eq!(commit.path_at_commit, path);
        assert_eq!(commit.sha, sha);
        assert_eq!(commit.status.as_deref(), Some("A"));
        assert_eq!(
            runner
                .read_blob_at(cwd, &commit.sha, &commit.path_at_commit, &cancel)
                .await
                .unwrap()
                .unwrap(),
            b"content\n"
        );
    }
}

#[tokio::test]
async fn brackets_select_the_literal_file_without_unrelated_matches() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let added = commit_file(cwd, "[ab].txt", "literal root\n", "literal add");
    commit_file(cwd, "a.txt", "unrelated a\n", "unrelated a");
    let edited = commit_file(cwd, "[ab].txt", "literal edited\n", "literal edit");
    commit_file(cwd, "b.txt", "unrelated b\n", "unrelated b");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for all in [false, true] {
        let page = runner
            .file_history(cwd, "[ab].txt", 0, 20, all, &cancel)
            .await
            .unwrap();
        assert_eq!(
            page.commits
                .iter()
                .map(|c| c.sha.as_str())
                .collect::<Vec<_>>(),
            vec![edited.as_str(), added.as_str()]
        );
        assert!(page.commits.iter().all(|c| c.path_at_commit == "[ab].txt"));
    }
}

#[tokio::test]
async fn renamed_chinese_paths_survive_pagination_and_deletion() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let old = "旧[名].txt";
    let new = "新 文件.txt";
    let added = commit_file(cwd, old, "original\n", "add original");
    git(cwd, &["mv", "--", old, new]);
    git(cwd, &["commit", "-m", "rename"]);
    let renamed = git(cwd, &["rev-parse", "HEAD"]);
    let edited = commit_file(cwd, new, "edited\n", "edit renamed");
    git(cwd, &["--literal-pathspecs", "rm", "--", new]);
    git(cwd, &["commit", "-m", "delete"]);
    let deleted = git(cwd, &["rev-parse", "HEAD"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let first = runner
        .file_history(cwd, new, 0, 2, false, &cancel)
        .await
        .unwrap();
    assert!(first.truncated);
    assert_eq!(first.next_offset, 2);
    let second = runner
        .file_history(cwd, new, first.next_offset, 2, false, &cancel)
        .await
        .unwrap();
    assert!(!second.truncated);
    assert_eq!(second.next_offset, 4);
    let commits = [first.commits, second.commits].concat();
    assert_eq!(
        commits.iter().map(|c| c.sha.as_str()).collect::<Vec<_>>(),
        vec![
            deleted.as_str(),
            edited.as_str(),
            renamed.as_str(),
            added.as_str()
        ]
    );
    assert_eq!(
        commits
            .iter()
            .map(|c| c.path_at_commit.as_str())
            .collect::<Vec<_>>(),
        vec![new, new, new, old]
    );
    assert_eq!(commits[2].orig_path.as_deref(), Some(old));
    assert_eq!(commits[2].status.as_deref(), Some("R"));
    assert_eq!(
        runner
            .read_blob_at(
                cwd,
                &commits[2].parents[0],
                commits[2].orig_path.as_deref().unwrap(),
                &cancel
            )
            .await
            .unwrap(),
        runner
            .read_blob_at(cwd, &commits[2].sha, new, &cancel)
            .await
            .unwrap()
    );
    assert!(runner
        .read_blob_at(cwd, &deleted, new, &cancel)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn subject_record_separator_is_not_a_commit_boundary() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let subject = "before\x1eafter\tend";
    let sha = commit_file(cwd, "file.txt", "one\n", subject);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let page = runner
        .file_history(cwd, "file.txt", 0, 20, false, &cancel)
        .await
        .unwrap();
    assert_eq!(page.commits.len(), 1);
    assert_eq!(page.commits[0].sha, sha);
    assert_eq!(page.commits[0].subject, subject);
    assert_eq!(page.commits[0].path_at_commit, "file.txt");
}

#[tokio::test]
async fn nul_tree_names_keep_control_characters_and_pathspec_magic() {
    let repo = FixtureBuilder::new().build("empty").unwrap();
    let cwd = repo.path();
    let blob = git_input(cwd, &["hash-object", "-w", "--stdin"], b"synthetic file\n");
    // Build committed trees directly: these are legal Git names even when the
    // host filesystem cannot check them out (for example ':' on Windows).
    let names = [
        "tab\tname",
        "line\nbreak",
        "record\x1ename",
        "quote\"name",
        " leading ",
        ":(top)literal",
        "*.txt",
        "needle.txt",
    ];
    let entries = names
        .iter()
        .map(|name| format!("100644 blob {blob}\t{name}\0"))
        .collect::<String>();
    let tree = git_input(cwd, &["mktree", "-z"], entries.as_bytes());
    let commit = git(cwd, &["commit-tree", &tree, "-m", "synthetic names"]);
    git(cwd, &["update-ref", "HEAD", &commit]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for name in names {
        let page = runner
            .file_history(cwd, name, 0, 20, false, &cancel)
            .await
            .unwrap();
        assert_eq!(page.commits.len(), 1, "{name:?}");
        assert_eq!(page.commits[0].path_at_commit, name, "{name:?}");
        assert_eq!(page.commits[0].status.as_deref(), Some("A"));
        assert_eq!(
            runner
                .read_blob_at(cwd, &commit, name, &cancel)
                .await
                .unwrap()
                .unwrap(),
            b"synthetic file\n"
        );
    }
}

#[tokio::test]
async fn display_config_does_not_change_history_records() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let sha = commit_file(cwd, "file.txt", "content\n", "actual café subject");
    git(
        cwd,
        &["notes", "add", "-m", "note must not become a status"],
    );
    for (key, value) in [
        ("color.ui", "always"),
        ("log.showNotes", "true"),
        ("log.showSignature", "true"),
        ("log.decorate", "full"),
        ("log.showRoot", "false"),
        ("i18n.logOutputEncoding", "ISO-8859-1"),
        ("format.pretty", "oneline"),
    ] {
        git(cwd, &["config", key, value]);
    }
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let page = runner
        .file_history(cwd, "file.txt", 0, 20, false, &cancel)
        .await
        .unwrap();
    assert_eq!(page.commits.len(), 1);
    let commit = &page.commits[0];
    assert_eq!(commit.sha, sha);
    assert_eq!(commit.subject, "actual café subject");
    assert_eq!(commit.path_at_commit, "file.txt");
    assert_eq!(commit.status.as_deref(), Some("A"));
}

#[tokio::test]
async fn empty_subject_does_not_shift_header_fields_or_paths() {
    let repo = FixtureBuilder::new().build("empty").unwrap();
    let cwd = repo.path();
    std::fs::write(cwd.join("file.txt"), "first\n").unwrap();
    git(cwd, &["add", "file.txt"]);
    git(cwd, &["commit", "--allow-empty-message", "-m", ""]);
    let first = git(cwd, &["rev-parse", "HEAD"]);
    commit_file(cwd, "file.txt", "second\n", "second subject");
    let page = GitRunner::new("git")
        .file_history(cwd, "file.txt", 0, 20, false, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(page.commits.len(), 2);
    assert_eq!(page.commits[0].subject, "second subject");
    assert_eq!(page.commits[1].subject, "");
    assert_eq!(page.commits[1].sha, first);
    assert!(page.commits[1].parents.is_empty());
    assert_eq!(page.commits[1].path_at_commit, "file.txt");
    assert_eq!(page.commits[1].status.as_deref(), Some("A"));
}

#[tokio::test]
async fn rename_paths_with_control_characters_are_separate_nul_fields() {
    let repo = FixtureBuilder::new().build("empty").unwrap();
    let cwd = repo.path();
    let old = "old\tname\nwith\x1econtrol";
    let new = "new\nname\twith\x1econtrol";
    let blob = git_input(cwd, &["hash-object", "-w", "--stdin"], b"renamed content\n");
    let first_tree = git_input(
        cwd,
        &["mktree", "-z"],
        format!("100644 blob {blob}\t{old}\0").as_bytes(),
    );
    let first = git(cwd, &["commit-tree", &first_tree, "-m", "first"]);
    let second_tree = git_input(
        cwd,
        &["mktree", "-z"],
        format!("100644 blob {blob}\t{new}\0").as_bytes(),
    );
    let second = git(
        cwd,
        &["commit-tree", &second_tree, "-p", &first, "-m", "rename"],
    );
    git(cwd, &["update-ref", "HEAD", &second]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let page = runner
        .file_history(cwd, new, 0, 20, false, &cancel)
        .await
        .unwrap();
    assert_eq!(page.commits.len(), 2);
    assert_eq!(page.commits[0].orig_path.as_deref(), Some(old));
    assert_eq!(page.commits[0].path_at_commit, new);
    assert_eq!(page.commits[0].status.as_deref(), Some("R"));
    assert_eq!(page.commits[1].path_at_commit, old);
    assert_eq!(
        runner
            .read_blob_at(cwd, &first, old, &cancel)
            .await
            .unwrap(),
        runner
            .read_blob_at(cwd, &second, new, &cancel)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn merged_file_history_keeps_every_git_selected_record() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    git(cwd, &["config", "core.autocrlf", "false"]);
    let lines = (0..30).map(|i| format!("line {i}\n")).collect::<Vec<_>>();
    commit_file(cwd, "file.txt", &lines.concat(), "base file");
    git(cwd, &["checkout", "-b", "feature"]);
    let mut feature = lines.clone();
    feature[2] = "feature\n".into();
    commit_file(cwd, "file.txt", &feature.concat(), "feature edit");
    git(cwd, &["checkout", "main"]);
    let mut main = lines;
    main[27] = "main\n".into();
    commit_file(cwd, "file.txt", &main.concat(), "main edit");
    git(cwd, &["merge", "--no-ff", "-m", "merge edits", "feature"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for all in [false, true] {
        let mut args = vec!["--literal-pathspecs", "log", "--follow", "--format=%H"];
        if all {
            args.push("--all");
        }
        args.extend(["--", "file.txt"]);
        let expected = git(cwd, &args)
            .lines()
            .map(str::to_string)
            .collect::<Vec<_>>();
        let page = runner
            .file_history(cwd, "file.txt", 0, 20, all, &cancel)
            .await
            .unwrap();
        assert_eq!(
            page.commits
                .iter()
                .map(|c| c.sha.clone())
                .collect::<Vec<_>>(),
            expected
        );
        assert!(page.commits.iter().all(|c| c.path_at_commit == "file.txt"));
        assert!(page.commits.iter().any(|c| c.subject == "feature edit"));
        assert!(page.commits.iter().any(|c| c.subject == "main edit"));
    }
}
