use gitx_core::RebaseTodoAction;
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::{fs, path::Path, process::Command};
use tokio_util::sync::CancellationToken;

fn git(path: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .trim_end()
        .to_owned()
}

async fn refuses_unavailable_backup(operation: &str) {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    git(path, &["config", "core.autocrlf", "false"]);
    let head = git(path, &["rev-parse", "HEAD"]);
    git(path, &["checkout", "-b", "side", "HEAD~1"]);
    fs::write(path.join("side.txt"), "side\n").unwrap();
    git(path, &["add", "side.txt"]);
    git(path, &["commit", "-m", "side"]);
    git(path, &["checkout", "main"]);
    fs::write(path.join("a.txt"), "staged local\n").unwrap();
    git(path, &["add", "a.txt"]);
    fs::write(path.join("a.txt"), "unstaged local\n").unwrap();
    fs::write(path.join("local.txt"), "untracked local\n").unwrap();
    fs::create_dir_all(path.join(".git/refs/gitx")).unwrap();
    fs::write(path.join(".git/refs/gitx/backup"), format!("{head}\n")).unwrap();
    let refs = git(path, &["show-ref"]);
    let index = git(path, &["write-tree"]);
    let status = git(path, &["status", "--porcelain"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let result = match operation {
        "reword" => {
            runner
                .reword_commit(path, "HEAD", "new message", &cancel)
                .await
        }
        "squash" => {
            runner
                .squash_commits(path, &["HEAD~1".into(), "HEAD".into()], "squash", &cancel)
                .await
        }
        "drop" => runner.drop_commits(path, &["HEAD".into()], &cancel).await,
        "uncommit" => runner.uncommit(path, &cancel).await,
        "revert" => {
            runner
                .revert_run(path, &["HEAD".into()], None, false, &cancel)
                .await
        }
        "cherry-pick" => {
            runner
                .cherry_pick_run(path, &["side".into()], None, false, false, true, &cancel)
                .await
        }
        "merge" => {
            runner
                .merge_run(
                    path,
                    &["side".into()],
                    false,
                    false,
                    false,
                    None,
                    false,
                    false,
                    false,
                    true,
                    &cancel,
                )
                .await
        }
        "rebase" => {
            runner
                .rebase_run(
                    path, "side", None, None, false, false, false, false, false, false, true,
                    &cancel,
                )
                .await
        }
        "interactive" => {
            let mut plan = runner
                .rebase_interactive_plan(path, "HEAD", &cancel)
                .await
                .unwrap();
            plan.items[0].action = RebaseTodoAction::Reword;
            plan.items[0].message = Some("new message".into());
            runner
                .rebase_interactive_start(path, &plan, true, &cancel)
                .await
        }
        _ => unreachable!(),
    };
    let error = result.expect_err("a failed backup must stop the operation");
    assert!(
        error.command.unwrap_or_default().contains("update-ref"),
        "wrong failure: {}",
        error.message
    );
    assert_eq!(git(path, &["show-ref"]), refs);
    assert_eq!(git(path, &["rev-parse", "HEAD"]), head);
    assert_eq!(git(path, &["write-tree"]), index);
    assert_eq!(git(path, &["status", "--porcelain"]), status);
    assert_eq!(fs::read(path.join("a.txt")).unwrap(), b"unstaged local\n");
    assert_eq!(
        fs::read(path.join("local.txt")).unwrap(),
        b"untracked local\n"
    );
    assert!(!path.join(".git/rebase-merge").exists());
    assert!(!path.join(".git/rebase-apply").exists());
    assert!(!path.join(".git/MERGE_HEAD").exists());
}

macro_rules! backup_regression {
    ($name:ident, $operation:literal) => {
        #[tokio::test]
        async fn $name() {
            refuses_unavailable_backup($operation).await;
        }
    };
}

backup_regression!(reword_requires_backup, "reword");
backup_regression!(squash_requires_backup, "squash");
backup_regression!(drop_requires_backup, "drop");
backup_regression!(uncommit_requires_backup, "uncommit");
backup_regression!(revert_requires_backup, "revert");
backup_regression!(cherry_pick_requires_backup, "cherry-pick");
backup_regression!(merge_requires_backup, "merge");
backup_regression!(rebase_requires_backup, "rebase");
backup_regression!(interactive_rebase_requires_backup, "interactive");

#[tokio::test]
async fn merge_and_cherry_pick_can_start_on_an_unborn_branch() {
    for merge in [false, true] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let path = repo.path();
        git(path, &["checkout", "--orphan", "empty"]);
        git(path, &["rm", "-rf", "."]);
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let result = if merge {
            runner
                .merge_run(
                    path,
                    &["main".into()],
                    false,
                    false,
                    false,
                    None,
                    false,
                    false,
                    false,
                    false,
                    &cancel,
                )
                .await
        } else {
            runner
                .cherry_pick_run(path, &["main".into()], None, false, false, false, &cancel)
                .await
        }
        .unwrap();
        assert_eq!(result.old_head, "");
        assert!(result.backup_ref.is_none());
        assert_eq!(git(path, &["symbolic-ref", "HEAD"]), "refs/heads/empty");
        assert_eq!(
            git(path, &["rev-parse", "HEAD^{tree}"]),
            git(path, &["rev-parse", "main^{tree}"])
        );
        assert!(git(path, &["status", "--porcelain"]).is_empty());
    }
}

#[tokio::test]
async fn reword_stops_when_only_the_worktree_snapshot_reference_is_rejected() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let path = repo.path();
    fs::write(path.join("a.txt"), "staged local\n").unwrap();
    git(path, &["add", "a.txt"]);
    fs::write(path.join("a.txt"), "unstaged local\n").unwrap();
    let head = git(path, &["rev-parse", "HEAD"]);
    let index = git(path, &["write-tree"]);
    let status = git(path, &["status", "--porcelain"]);
    let hook = path.join(".git/hooks/reference-transaction");
    fs::write(&hook, "#!/bin/sh\nif test \"$1\" = prepared; then\n while read old new ref; do\n  case \"$ref\" in refs/gitx/backup/*-wt-*) exit 1 ;; esac\n done\nfi\nexit 0\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let result = GitRunner::new("git")
        .reword_commit(path, "HEAD", "new message", &CancellationToken::new())
        .await;
    let error = result.unwrap_err();
    assert!(error.command.unwrap_or_default().contains("-wt-"));
    assert_eq!(git(path, &["rev-parse", "HEAD"]), head);
    assert_eq!(git(path, &["write-tree"]), index);
    assert_eq!(git(path, &["status", "--porcelain"]), status);
    assert_eq!(fs::read(path.join("a.txt")).unwrap(), b"unstaged local\n");
}
