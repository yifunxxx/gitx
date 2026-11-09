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
}

fn fixture(relative: &str) -> Fixture {
    let source = FixtureBuilder::new().build("clean").unwrap();
    git(source.path(), &["config", "core.autocrlf", "false"]);
    fs::write(source.path().join("README.md"), "module\n").unwrap();
    git(source.path(), &["add", "README.md"]);
    git(source.path(), &["commit", "-m", "module"]);
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
    Fixture {
        _source: source,
        parent,
        module,
    }
}

async fn blocked(
    scheduler: &RepoScheduler,
    runner: &GitRunner,
    path: &Path,
    cancel: &CancellationToken,
) {
    let mut waiting =
        Box::pin(scheduler.acquire_repo_write(runner, path.to_str().unwrap(), cancel));
    assert!(
        tokio::time::timeout(Duration::from_secs(2), &mut waiting)
            .await
            .is_err(),
        "{} was not blocked",
        path.display()
    );
}

async fn submodule_lock(linked: bool) {
    let f = fixture("libs/module");
    let temp = tempfile::tempdir().unwrap();
    let target = if linked {
        let path = temp.path().join("linked");
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
    assert!(tokio::time::timeout(Duration::from_secs(2), &mut write)
        .await
        .is_err());
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

async fn check_scope_exclusion(parent: &Path, child: &Path) {
    let runner = GitRunner::new("git");
    let scheduler = RepoScheduler::new();
    let cancel = CancellationToken::new();
    for (locked, queued) in [(parent, child), (child, parent)] {
        let held = scheduler
            .acquire_repo_write(&runner, locked.to_str().unwrap(), &cancel)
            .await
            .unwrap();
        blocked(&scheduler, &runner, queued, &cancel).await;
        drop(held);
        tokio::time::timeout(
            Duration::from_secs(15),
            scheduler.acquire_repo_write(&runner, queued.to_str().unwrap(), &cancel),
        )
        .await
        .unwrap()
        .unwrap();
    }
}

#[tokio::test]
async fn old_form_module_and_external_worktree_share_parent_scope() {
    let f = fixture("module");
    let git_dir = git(&f.module, &["rev-parse", "--absolute-git-dir"]);
    let original = PathBuf::from(git_dir).canonicalize().unwrap();
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
