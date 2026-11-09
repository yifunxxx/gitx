use gitx_core::{RebaseTodoAction, RepoOpKind, RepoOpPhase, RewriteOutcome};
use gitx_git::GitRunner;
use gitx_testkit::FixtureBuilder;
use std::path::Path;
use std::process::Command;
use tokio_util::sync::CancellationToken;

// This test binary has one test, so the helper override cannot race another test.
#[tokio::test]
async fn linked_worktree_rebase_runs_the_installed_helper_with_shell_characters_in_its_path() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let temp = tempfile::tempdir().unwrap();
    let install = temp.path().join("installed ' app $HOME & tools");
    std::fs::create_dir(&install).unwrap();
    let helper = install.join(if cfg!(windows) {
        "gitx-helper.exe"
    } else {
        "gitx-helper"
    });
    std::fs::copy(env!("CARGO_BIN_EXE_gitx-helper"), &helper).unwrap();
    let original_helper = std::env::var_os("GITX_HELPER_PATH");
    std::env::set_var("GITX_HELPER_PATH", &helper);

    let root = temp.path().join("linked worktree");
    git(
        repo.path(),
        &[
            "worktree",
            "add",
            "-b",
            "helper-rebase",
            root.to_str().unwrap(),
        ],
    );
    let main_head = git(repo.path(), &["rev-parse", "HEAD"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    for name in ["d", "e", "f"] {
        std::fs::write(root.join(format!("{name}.txt")), format!("{name}\n")).unwrap();
        git(&root, &["add", "."]);
        git(&root, &["commit", "-m", &format!("commit-{name}")]);
    }
    let tree = git(&root, &["rev-parse", "HEAD^{tree}"]);
    let mut plan = runner
        .rebase_interactive_plan(&root, "HEAD~4", &cancel)
        .await
        .unwrap();
    plan.items[0].action = RebaseTodoAction::Reword;
    plan.items[0].message = Some("message supplied through the real helper".into());
    plan.items[1].action = RebaseTodoAction::Reword;
    plan.items[1].message = Some("second distinct message\n\n中文正文 $HOME & 'quoted'".into());
    // Edit forces the CLI path and pauses before two more rewords.
    plan.items[2].action = RebaseTodoAction::Edit;
    plan.items[3].action = RebaseTodoAction::Reword;
    plan.items[3].message = Some("message after edit pause".into());
    plan.items[4].action = RebaseTodoAction::Reword;
    plan.items[4].message = Some("final distinct message".into());
    let result = runner
        .rebase_interactive_start(&root, &plan, false, &cancel)
        .await;
    let result = result.expect("CLI rebase should run the installed helper");
    assert_eq!(result.outcome, RewriteOutcome::Conflicts);
    let stopped = runner.repo_op_state(&root, &cancel).await.unwrap();
    assert_eq!(stopped.kind, RepoOpKind::Rebase);
    assert_eq!(stopped.phase, RepoOpPhase::StoppedForEdit);
    assert_eq!(stopped.head_branch.as_deref(), Some("helper-rebase"));
    assert_eq!(
        git(&root, &["log", "-1", "--format=%s", "HEAD~2"]).trim(),
        "message supplied through the real helper"
    );
    assert_eq!(
        git(&root, &["log", "-1", "--format=%B", "HEAD~1"]).trim(),
        "second distinct message\n\n中文正文 $HOME & 'quoted'"
    );
    assert_eq!(git(&root, &["log", "-1", "--format=%s"]).trim(), "commit-d");
    runner.rebase_continue(&root, &cancel).await.unwrap();
    assert_eq!(
        git(&root, &["log", "-1", "--format=%s", "HEAD~1"]).trim(),
        "message after edit pause"
    );
    assert_eq!(
        git(&root, &["log", "-1", "--format=%s"]).trim(),
        "final distinct message"
    );
    assert_eq!(tree, git(&root, &["rev-parse", "HEAD^{tree}"]));
    assert_eq!(
        runner.repo_op_state(&root, &cancel).await.unwrap().kind,
        RepoOpKind::Normal
    );
    assert!(git(&root, &["status", "--porcelain"]).trim().is_empty());
    assert_eq!(main_head, git(repo.path(), &["rev-parse", "HEAD"]));
    assert!(!repo.path().join(".git/gitx/rebase-todo").exists());
    conflict_resume_keeps_each_message().await;
    onto_keeps_destination_tree_and_root_history().await;
    native_merge_topology_and_autosquash_are_preserved().await;
    smart_rebase_restores_only_its_own_stash_after_continue().await;
    squash_groups_keep_custom_messages_and_later_bodies().await;
    native_squash_after_custom_squash_keeps_its_body().await;
    match original_helper {
        Some(value) => std::env::set_var("GITX_HELPER_PATH", value),
        None => std::env::remove_var("GITX_HELPER_PATH"),
    }
}

async fn native_squash_after_custom_squash_keeps_its_body() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let root = repo.path();
    git(
        root,
        &["commit", "--amend", "-m", "squash! commit-b\n\nnative body"],
    );
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let tree = git(root, &["rev-parse", "HEAD^{tree}"]);
    let mut plan = runner
        .rebase_interactive_plan(root, "HEAD~2", &cancel)
        .await
        .unwrap();
    plan.autosquash = true;
    plan.items[1].action = RebaseTodoAction::Squash;
    plan.items[1].message = Some("custom combined\n\ncustom body".into());
    assert_eq!(
        runner
            .rebase_interactive_start(root, &plan, false, &cancel)
            .await
            .unwrap()
            .outcome,
        RewriteOutcome::Success
    );
    assert_eq!(
        git(root, &["log", "-1", "--format=%B"]).trim(),
        "custom combined\n\ncustom body\n\nsquash! commit-b\n\nnative body"
    );
    assert_eq!(git(root, &["rev-list", "--count", "HEAD"]).trim(), "1");
    assert_eq!(git(root, &["rev-parse", "HEAD^{tree}"]), tree);
    assert!(git(root, &["status", "--porcelain"]).trim().is_empty());
}

async fn squash_groups_keep_custom_messages_and_later_bodies() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let root = repo.path();
    for name in ["d", "e"] {
        std::fs::write(root.join(format!("{name}.txt")), name).unwrap();
        git(root, &["add", "."]);
        git(
            root,
            &["commit", "-m", &format!("commit-{name}\n\nbody-{name}")],
        );
    }
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let tree = git(root, &["rev-parse", "HEAD^{tree}"]);
    let mut plan = runner
        .rebase_interactive_plan(root, "HEAD~4", &cancel)
        .await
        .unwrap();
    plan.items[0].action = RebaseTodoAction::Edit;
    plan.items[1].action = RebaseTodoAction::Reword;
    plan.items[1].message = Some("earlier reword must not leak".into());
    plan.items[2].action = RebaseTodoAction::Squash;
    plan.items[2].message = Some("combined custom\n\ncustom body".into());
    plan.items[3].action = RebaseTodoAction::Squash;
    plan.items[4].action = RebaseTodoAction::Fixup;
    assert_eq!(
        runner
            .rebase_interactive_start(root, &plan, false, &cancel)
            .await
            .unwrap()
            .outcome,
        RewriteOutcome::Conflicts
    );
    assert_eq!(
        runner.rebase_continue(root, &cancel).await.unwrap().outcome,
        RewriteOutcome::Success
    );
    assert_eq!(
        git(root, &["log", "-1", "--format=%B"]).trim(),
        "combined custom\n\ncustom body\n\ncommit-d\n\nbody-d"
    );
    assert_eq!(git(root, &["rev-list", "--count", "HEAD"]).trim(), "2");
    assert_eq!(git(root, &["rev-parse", "HEAD^{tree}"]), tree);
}

async fn smart_rebase_restores_only_its_own_stash_after_continue() {
    for dirty in [false, true] {
        let repo = FixtureBuilder::new().build("linear-history").unwrap();
        let root = repo.path();
        git(root, &["config", "core.autocrlf", "false"]);
        std::fs::write(root.join("a.txt"), "older saved work\n").unwrap();
        git(root, &["stash", "push", "-m", "previous user stash"]);
        let previous = git(root, &["rev-parse", "refs/stash"]);
        if dirty {
            std::fs::write(root.join("c.txt"), "current local work\n").unwrap();
            git(root, &["add", "c.txt"]);
            std::fs::write(root.join("untracked.txt"), "untracked work\n").unwrap();
        }
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let mut plan = runner
            .rebase_interactive_plan(root, "HEAD~1", &cancel)
            .await
            .unwrap();
        plan.items[0].action = RebaseTodoAction::Edit;
        plan.items[1].action = RebaseTodoAction::Reword;
        plan.items[1].message = Some("smart rebase final".into());
        if dirty {
            let before = git(root, &["status", "--porcelain"]);
            let error = runner
                .rebase_interactive_start(root, &plan, false, &cancel)
                .await
                .unwrap_err();
            assert_eq!(
                error.code,
                gitx_core::ErrorCode::DirtyWorktreeWouldBeOverwritten
            );
            assert_eq!(git(root, &["status", "--porcelain"]), before);
            assert_eq!(git(root, &["rev-parse", "refs/stash"]), previous);
        }
        let result = runner
            .rebase_interactive_start(root, &plan, true, &cancel)
            .await
            .unwrap();
        assert_eq!(result.outcome, RewriteOutcome::Conflicts);
        assert!(
            git(root, &["status", "--porcelain"]).trim().is_empty(),
            "local work must stay stashed during Edit"
        );
        let stashes = runner.stash_list(root, &cancel).await.unwrap();
        assert!(stashes.iter().any(|entry| entry.sha == previous.trim()));
        assert_eq!(stashes.len(), if dirty { 2 } else { 1 });
        let result = runner.rebase_continue(root, &cancel).await.unwrap();
        assert_eq!(result.outcome, RewriteOutcome::Success);
        assert_eq!(git(root, &["rev-parse", "refs/stash"]), previous);
        if dirty {
            assert_eq!(git(root, &["show", ":c.txt"]).trim(), "current local work");
            assert_eq!(
                std::fs::read_to_string(root.join("untracked.txt")).unwrap(),
                "untracked work\n"
            );
        } else {
            assert!(git(root, &["status", "--porcelain"]).trim().is_empty());
        }
        assert!(!root.join(".git/gitx/smart-stash.json").exists());
    }
}

async fn conflict_resume_keeps_each_message() {
    for skip in [false, true] {
        let repo = FixtureBuilder::new().build("merge-conflict").unwrap();
        let root = repo.path();
        git(root, &["checkout", "feature"]);
        std::fs::write(root.join("tail.txt"), "tail\n").unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "-m", "tail before reword"]);
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let mut plan = runner
            .rebase_interactive_plan(root, "HEAD~1", &cancel)
            .await
            .unwrap();
        plan.onto = Some("main".into());
        plan.items[0].action = RebaseTodoAction::Reword;
        plan.items[0].message = Some("resolved conflict message".into());
        plan.items[1].action = RebaseTodoAction::Reword;
        plan.items[1].message = Some("tail after conflict\n\nbody retained".into());
        let result = runner
            .rebase_interactive_start(root, &plan, false, &cancel)
            .await
            .unwrap();
        assert_eq!(result.outcome, RewriteOutcome::Conflicts);
        let result = if skip {
            runner.rebase_skip(root, &cancel).await.unwrap()
        } else {
            std::fs::write(root.join("file.txt"), "resolved\nline2\nline3\n").unwrap();
            git(root, &["add", "file.txt"]);
            runner.rebase_continue(root, &cancel).await.unwrap()
        };
        assert_eq!(result.outcome, RewriteOutcome::Success);
        assert_eq!(
            git(root, &["log", "-1", "--format=%B"]).trim(),
            "tail after conflict\n\nbody retained"
        );
        if !skip {
            assert_eq!(
                git(root, &["log", "-1", "--format=%s", "HEAD~1"]).trim(),
                "resolved conflict message"
            );
        }
        assert!(git(root, &["status", "--porcelain"]).trim().is_empty());
        assert!(!root.join(".git/rebase-merge/gitx-plan.json").exists());
    }
}

async fn onto_keeps_destination_tree_and_root_history() {
    for from_root in [false, true] {
        let repo = FixtureBuilder::new().build("linear-history").unwrap();
        let root = repo.path();
        git(root, &["checkout", "--orphan", "destination"]);
        git(root, &["rm", "-rf", "."]);
        std::fs::write(root.join("destination.txt"), "destination\n").unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "-m", "destination root"]);
        let destination = git(root, &["rev-parse", "HEAD"]);
        git(root, &["checkout", "main"]);
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let mut plan = runner
            .rebase_interactive_plan(root, if from_root { "" } else { "HEAD~1" }, &cancel)
            .await
            .unwrap();
        plan.onto = Some("destination".into());
        let result = runner
            .rebase_interactive_start(root, &plan, false, &cancel)
            .await
            .unwrap();
        assert_eq!(result.outcome, RewriteOutcome::Success);
        assert_eq!(
            git(
                root,
                &["rev-parse", if from_root { "HEAD~3" } else { "HEAD~2" }]
            ),
            destination
        );
        assert!(root.join("destination.txt").is_file());
        assert_eq!(root.join("a.txt").exists(), from_root);
        assert!(root.join("b.txt").is_file() && root.join("c.txt").is_file());
        assert!(git(root, &["status", "--porcelain"]).trim().is_empty());
    }
}

async fn native_merge_topology_and_autosquash_are_preserved() {
    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let root = repo.path();
    git(root, &["checkout", "-b", "side", "HEAD~1"]);
    std::fs::write(root.join("side.txt"), "side\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-m", "side commit"]);
    git(root, &["checkout", "main"]);
    git(root, &["merge", "--no-ff", "side", "-m", "original merge"]);
    let before = git(root, &["rev-parse", "HEAD^{tree}"]);
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let mut plan = runner
        .rebase_interactive_plan(root, "HEAD~1", &cancel)
        .await
        .unwrap();
    plan.rebase_merges = true;
    let last = plan.items.last_mut().unwrap();
    last.action = RebaseTodoAction::Reword;
    last.message = Some("merge with topology retained".into());
    let result = runner
        .rebase_interactive_start(root, &plan, false, &cancel)
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::Success);
    assert_eq!(
        git(root, &["rev-list", "--parents", "-n", "1", "HEAD"])
            .split_whitespace()
            .count(),
        3
    );
    assert_eq!(
        git(root, &["log", "-1", "--format=%s"]).trim(),
        "merge with topology retained"
    );
    assert_eq!(git(root, &["rev-parse", "HEAD^{tree}"]), before);
    assert!(git(root, &["status", "--porcelain"]).trim().is_empty());

    let repo = FixtureBuilder::new().build("linear-history").unwrap();
    let root = repo.path();
    std::fs::write(root.join("b.txt"), "b fixed\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "--fixup=HEAD~1"]);
    let before = git(root, &["rev-parse", "HEAD^{tree}"]);
    let mut plan = runner
        .rebase_interactive_plan(root, "HEAD~2", &cancel)
        .await
        .unwrap();
    plan.autosquash = true;
    let result = runner
        .rebase_interactive_start(root, &plan, false, &cancel)
        .await
        .unwrap();
    assert_eq!(result.outcome, RewriteOutcome::Success);
    assert_eq!(git(root, &["rev-list", "--count", "HEAD"]).trim(), "3");
    assert_eq!(git(root, &["show", "HEAD~1:b.txt"]).trim(), "b fixed");
    assert_eq!(git(root, &["rev-parse", "HEAD^{tree}"]), before);
    assert!(git(root, &["status", "--porcelain"]).trim().is_empty());
}

fn git(cwd: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}
