use gitx_core::{ErrorCode, SubmoduleUpdatePolicy, UpdateMethod};
use gitx_git::{GitInvocation, GitRunner, OpKind, RepoScheduler};
use gitx_testkit::{FixtureBuilder, FixtureRepo};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
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

struct Fixture {
    _source: FixtureRepo,
    parent: FixtureRepo,
    module: PathBuf,
    relative: String,
    old: String,
    new: String,
}

fn fixture(relative: &str) -> Fixture {
    let source = FixtureBuilder::new().build("clean").unwrap();
    git(source.path(), &["config", "core.autocrlf", "false"]);
    fs::write(source.path().join("README.md"), "old module\n").unwrap();
    git(source.path(), &["add", "README.md"]);
    git(source.path(), &["commit", "-m", "old module"]);
    let old = git(source.path(), &["rev-parse", "HEAD"]);
    fs::write(source.path().join("README.md"), "new module\n").unwrap();
    git(source.path(), &["commit", "-am", "new module"]);
    let new = git(source.path(), &["rev-parse", "HEAD"]);
    let parent = FixtureBuilder::new().build("clean").unwrap();
    git(
        parent.path(),
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            source.path().to_str().unwrap(),
            relative,
        ],
    );
    git(parent.path(), &["commit", "-am", "add submodule"]);
    let module = parent.path().join(relative);
    git(&module, &["config", "core.autocrlf", "false"]);
    // The fresh clone inherited Windows autocrlf; normalize this disposable
    // fixture after setting its local config, before adding any test edits.
    git(&module, &["checkout", "--force", "--detach", &old]);
    Fixture {
        _source: source,
        parent,
        module,
        relative: relative.into(),
        old,
        new,
    }
}

#[tokio::test]
async fn paths_with_spaces_update_and_report_actual_checked_out_commits() {
    let f = fixture("libs/module 中文 one");
    let runner = GitRunner::new("git");
    let result = runner
        .submodule_update(
            f.parent.path(),
            SubmoduleUpdatePolicy::Always,
            None,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.items.len(), 1);
    let item = &result.items[0];
    assert_eq!(item.path, f.relative);
    assert!(item.updated && !item.skipped, "{item:?}");
    assert_eq!(item.old_sha.as_deref(), Some(f.old.as_str()));
    assert_eq!(item.new_sha.as_deref(), Some(f.new.as_str()));
    assert_eq!(git(&f.module, &["rev-parse", "HEAD"]), f.new);
    assert!(git(f.parent.path(), &["status", "--porcelain"]).is_empty());
}

#[tokio::test]
async fn uninitialized_submodule_does_not_inherit_the_parent_branch() {
    let f = fixture("module");
    git(
        f.parent.path(),
        &["submodule", "deinit", "--force", "--", &f.relative],
    );
    assert!(!f.module.join(".git").exists());
    let result = GitRunner::new("git")
        .submodule_update(
            f.parent.path(),
            SubmoduleUpdatePolicy::Always,
            None,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    let item = &result.items[0];
    assert!(item.updated && !item.skipped, "{item:?}");
    assert_eq!(item.old_sha, None);
    assert_eq!(item.new_sha.as_deref(), Some(f.new.as_str()));
    assert_eq!(git(&f.module, &["rev-parse", "HEAD"]), f.new);
}

#[tokio::test]
async fn malformed_gitmodules_is_an_error_and_preserves_the_repository() {
    let f = fixture("module");
    let head = git(f.parent.path(), &["rev-parse", "HEAD"]);
    let index = git(f.parent.path(), &["write-tree"]);
    let refs = git(f.parent.path(), &["show-ref"]);
    fs::write(f.parent.path().join(".gitmodules"), "[submodule broken\n").unwrap();
    let result = GitRunner::new("git")
        .submodule_update(
            f.parent.path(),
            SubmoduleUpdatePolicy::Always,
            None,
            &CancellationToken::new(),
        )
        .await;
    assert!(
        result.is_err(),
        "invalid configuration was reported as success: {result:?}"
    );
    assert_eq!(git(f.parent.path(), &["rev-parse", "HEAD"]), head);
    assert_eq!(git(f.parent.path(), &["write-tree"]), index);
    assert_eq!(git(f.parent.path(), &["show-ref"]), refs);
    assert_eq!(
        fs::read(f.parent.path().join(".gitmodules")).unwrap(),
        b"[submodule broken\n"
    );
    assert_eq!(git(&f.module, &["rev-parse", "HEAD"]), f.old);
}

#[tokio::test]
async fn dirty_submodule_failure_is_counted_and_preserves_index_and_files() {
    let f = fixture("module");
    fs::write(f.module.join("README.md"), "staged local\n").unwrap();
    git(&f.module, &["add", "README.md"]);
    fs::write(f.module.join("README.md"), "unstaged local\n").unwrap();
    fs::write(f.module.join("untracked.txt"), "keep\n").unwrap();
    let index = git(&f.module, &["write-tree"]);
    let status = git(&f.module, &["status", "--porcelain"]);
    let result = GitRunner::new("git")
        .submodule_update(
            f.parent.path(),
            SubmoduleUpdatePolicy::Always,
            None,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(result.message.contains("1 failed"), "{}", result.message);
    assert!(!result.items[0].updated && !result.items[0].skipped);
    assert_eq!(git(&f.module, &["rev-parse", "HEAD"]), f.old);
    assert_eq!(git(&f.module, &["write-tree"]), index);
    assert_eq!(git(&f.module, &["status", "--porcelain"]), status);
    assert_eq!(
        fs::read(f.module.join("README.md")).unwrap(),
        b"unstaged local\n"
    );
    assert_eq!(fs::read(f.module.join("untracked.txt")).unwrap(), b"keep\n");
}

async fn submodule_lock(linked: bool) {
    let f = fixture("libs/module");
    let other = tempfile::tempdir().unwrap();
    let target = if linked {
        let path = other.path().join("linked");
        git(
            &f.module,
            &["worktree", "add", "-b", "linked", path.to_str().unwrap()],
        );
        path
    } else {
        f.module.clone()
    };
    let runner = GitRunner::new("git");
    let scheduler = RepoScheduler::new();
    let cancel = CancellationToken::new();
    let held = scheduler
        .acquire_repo_write(&runner, f.parent.path().to_str().unwrap(), &cancel)
        .await
        .unwrap();
    let write = scheduler.with_repo_permit(
        &runner,
        target.to_str().unwrap(),
        OpKind::Write,
        &cancel,
        runner.run(
            GitInvocation::new(&target, ["update-ref", "refs/heads/queued", "HEAD"])
                .kind(OpKind::Write),
            &cancel,
        ),
    );
    tokio::pin!(write);
    assert!(
        tokio::time::timeout(Duration::from_secs(2), &mut write)
            .await
            .is_err(),
        "submodule write bypassed its superproject lock"
    );
    assert!(git(&f.module, &["for-each-ref", "refs/heads/queued"]).is_empty());
    drop(held);
    tokio::time::timeout(Duration::from_secs(15), write)
        .await
        .unwrap()
        .unwrap();
    assert!(!git(&f.module, &["for-each-ref", "refs/heads/queued"]).is_empty());
}

#[tokio::test]
async fn superproject_lock_blocks_separately_opened_submodule() {
    submodule_lock(false).await;
}

#[tokio::test]
async fn superproject_lock_blocks_a_linked_worktree_of_its_submodule() {
    submodule_lock(true).await;
}

#[tokio::test]
async fn auto_filters_unchanged_modules_and_subdirectories_resolve_the_root() {
    let f = fixture("libs/module 中文");
    let cwd = f.parent.path().join("nested/cwd");
    fs::create_dir_all(&cwd).unwrap();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let unchanged = runner
        .submodule_update(
            &cwd,
            SubmoduleUpdatePolicy::Auto,
            Some(&["README.md".into()]),
            &cancel,
        )
        .await
        .unwrap();
    assert!(unchanged.items.is_empty());
    assert_eq!(git(&f.module, &["rev-parse", "HEAD"]), f.old);
    let changed = runner
        .submodule_update(
            &cwd,
            SubmoduleUpdatePolicy::Auto,
            Some(std::slice::from_ref(&f.relative)),
            &cancel,
        )
        .await
        .unwrap();
    assert!(changed.items[0].updated);
    assert_eq!(git(&f.module, &["rev-parse", "HEAD"]), f.new);
}

#[tokio::test]
async fn cancelled_update_does_not_change_the_module() {
    let f = fixture("module");
    let cancel = CancellationToken::new();
    cancel.cancel();
    let error = GitRunner::new("git")
        .submodule_update(
            f.parent.path(),
            SubmoduleUpdatePolicy::Always,
            None,
            &cancel,
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(git(&f.module, &["rev-parse", "HEAD"]), f.old);
}

#[tokio::test]
async fn nested_module_branch_and_local_changes_are_preserved() {
    let f = fixture("module");
    let child = fixture("child 中文");
    git(&f.module, &["checkout", "--detach", &f.new]);
    git(
        &f.module,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            child._source.path().to_str().unwrap(),
            "nested child",
        ],
    );
    git(
        &f.module,
        &[
            "-c",
            "user.name=QA",
            "-c",
            "user.email=qa@example.test",
            "commit",
            "-am",
            "nested module",
        ],
    );
    git(f.parent.path(), &["add", &f.relative]);
    git(f.parent.path(), &["commit", "-m", "nested module pointer"]);
    let nested = f.module.join("nested child");
    git(&nested, &["config", "core.autocrlf", "false"]);
    git(
        &nested,
        &["checkout", "--force", "-b", "keep-local", &child.old],
    );
    fs::write(nested.join("README.md"), "nested local edit\n").unwrap();
    fs::write(nested.join("untracked.txt"), "nested untracked\n").unwrap();
    let index = git(&nested, &["write-tree"]);
    let result = GitRunner::new("git")
        .submodule_update(
            f.parent.path(),
            SubmoduleUpdatePolicy::Always,
            None,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.items.len(), 2);
    assert!(result.items[0].updated);
    let skipped = &result.items[1];
    assert_eq!(skipped.path, "module/nested child");
    assert!(skipped.skipped && !skipped.updated);
    assert_eq!(skipped.on_branch.as_deref(), Some("keep-local"));
    assert_eq!(git(&nested, &["rev-parse", "HEAD"]), child.old);
    assert_eq!(
        git(&nested, &["symbolic-ref", "--short", "HEAD"]),
        "keep-local"
    );
    assert_eq!(git(&nested, &["write-tree"]), index);
    assert_eq!(
        fs::read(nested.join("README.md")).unwrap(),
        b"nested local edit\n"
    );
    assert_eq!(
        fs::read(nested.join("untracked.txt")).unwrap(),
        b"nested untracked\n"
    );
}

#[tokio::test]
async fn project_update_keeps_parent_success_and_submodule_failure_details() {
    let f = fixture("module");
    git(f.parent.path(), &["add", &f.relative]);
    git(f.parent.path(), &["commit", "-m", "old module pointer"]);
    let old_parent = git(f.parent.path(), &["rev-parse", "HEAD"]);
    git(&f.module, &["checkout", "--detach", &f.new]);
    git(f.parent.path(), &["add", &f.relative]);
    git(f.parent.path(), &["commit", "-m", "new module pointer"]);
    let new_parent = git(f.parent.path(), &["rev-parse", "HEAD"]);
    let temp = tempfile::tempdir().unwrap();
    let work = temp.path().join("work");
    git(
        temp.path(),
        &[
            "-c",
            "protocol.file.allow=always",
            "clone",
            "--recurse-submodules",
            f.parent.path().to_str().unwrap(),
            work.to_str().unwrap(),
        ],
    );
    git(&work, &["checkout", "-b", "local-old", &old_parent]);
    git(&work, &["branch", "--set-upstream-to=origin/main"]);
    let module = work.join("module");
    git(&module, &["config", "core.autocrlf", "false"]);
    git(&module, &["checkout", "--force", "--detach", &f.old]);
    fs::write(module.join("README.md"), "keep this local edit\n").unwrap();
    let index = git(&module, &["write-tree"]);
    let info = GitRunner::new("git")
        .update_project_with_submodules(
            &work,
            UpdateMethod::Merge,
            SubmoduleUpdatePolicy::Auto,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(info.old_head, old_parent);
    assert_eq!(info.new_head, new_parent);
    assert_eq!(git(&work, &["rev-parse", "HEAD"]), new_parent);
    assert!(info.updated_files.iter().any(|file| file.path == "module"));
    assert_eq!(info.commits.len(), 1);
    assert!(info.submodule_error.is_none());
    let result = info.submodules.unwrap();
    assert!(result.message.contains("1 failed"), "{result:?}");
    assert!(!result.items[0].updated && !result.items[0].skipped);
    assert_eq!(result.items[0].old_sha.as_deref(), Some(f.old.as_str()));
    assert_eq!(git(&module, &["rev-parse", "HEAD"]), f.old);
    assert_eq!(git(&module, &["write-tree"]), index);
    assert_eq!(
        fs::read(module.join("README.md")).unwrap(),
        b"keep this local edit\n"
    );
}

async fn check_scope_exclusion(parent: &Path, child: &Path) {
    let runner = GitRunner::new("git");
    let scheduler = RepoScheduler::new();
    let cancel = CancellationToken::new();
    for (locked, queued) in [(parent, child), (child, parent)] {
        let held = scheduler
            .acquire_repo_write(&runner, locked.to_str().unwrap(), &cancel)
            .await
            .unwrap();
        let mut waiting =
            Box::pin(scheduler.acquire_repo_write(&runner, queued.to_str().unwrap(), &cancel));
        assert!(
            tokio::time::timeout(Duration::from_secs(2), &mut waiting)
                .await
                .is_err(),
            "{} did not block {}",
            locked.display(),
            queued.display()
        );
        drop(held);
        tokio::time::timeout(Duration::from_secs(15), waiting)
            .await
            .unwrap()
            .unwrap();
    }
}

#[tokio::test]
async fn old_form_module_and_its_external_worktree_share_parent_scope() {
    let f = fixture("module");
    let git_dir = git(&f.module, &["rev-parse", "--absolute-git-dir"]);
    let original = PathBuf::from(&git_dir).canonicalize().unwrap();
    assert!(original.starts_with(f.parent.path().canonicalize().unwrap()));
    fs::remove_file(f.module.join(".git")).unwrap();
    fs::rename(&original, f.module.join(".git")).unwrap();
    git(
        f.parent.path(),
        &[
            "config",
            "-f",
            "module/.git/config",
            "--unset",
            "core.worktree",
        ],
    );
    check_scope_exclusion(f.parent.path(), &f.module).await;
    let temp = tempfile::tempdir().unwrap();
    let linked = temp.path().join("external");
    git(
        &f.module,
        &[
            "worktree",
            "add",
            "-b",
            "external",
            linked.to_str().unwrap(),
        ],
    );
    check_scope_exclusion(f.parent.path(), &linked).await;
}

#[tokio::test]
async fn unrelated_nested_repository_does_not_lock_its_containing_repository() {
    let parent = FixtureBuilder::new().build("clean").unwrap();
    let nested = parent.path().join("independent");
    fs::create_dir(&nested).unwrap();
    git(&nested, &["init", "-b", "main"]);
    let runner = GitRunner::new("git");
    let scheduler = RepoScheduler::new();
    let cancel = CancellationToken::new();
    let _held = scheduler
        .acquire_repo_write(&runner, parent.path().to_str().unwrap(), &cancel)
        .await
        .unwrap();
    tokio::time::timeout(
        Duration::from_secs(15),
        scheduler.acquire_repo_write(&runner, nested.to_str().unwrap(), &cancel),
    )
    .await
    .unwrap()
    .unwrap();
}
