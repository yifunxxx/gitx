use gitx_core::{ErrorCode, ShelfEntry};
use gitx_git::{GitInvocation, GitRunner};
use gitx_testkit::FixtureBuilder;
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;

async fn git(runner: &GitRunner, cwd: &Path, args: &[&str]) -> Vec<u8> {
    runner
        .run(
            GitInvocation::new(cwd, args.iter().copied()),
            &CancellationToken::new(),
        )
        .await
        .unwrap()
        .stdout
}

async fn import(runner: &GitRunner, cwd: &Path, patch: &[u8]) -> ShelfEntry {
    let file = tempfile::NamedTempFile::new().unwrap();
    fs::write(file.path(), patch).unwrap();
    runner
        .shelf_import_patch(cwd, file.path(), "retention", &CancellationToken::new())
        .await
        .unwrap()
}

fn addition() -> &'static [u8] {
    b"diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+added\n"
}

fn modify(common: &Path, entry: &ShelfEntry, deleted: bool, f: impl FnOnce(&mut Value)) {
    let dir = if deleted {
        gitx_meta::deleted_root(common).join(&entry.id)
    } else {
        gitx_meta::shelf_dir(common, &entry.id)
    };
    let file = dir.join("meta.json");
    let mut value: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    f(&mut value);
    fs::write(file, serde_json::to_vec(&value).unwrap()).unwrap();
}

async fn dangling_patch(
    runner: &GitRunner,
    cwd: &Path,
    path: &str,
    original: &str,
) -> (String, Vec<u8>) {
    let out = runner
        .run(
            GitInvocation::new(cwd, ["hash-object", "-w", "--stdin"])
                .stdin(format!("{original}\n").into_bytes()),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    let blob = String::from_utf8(out.stdout).unwrap().trim().to_string();
    let patch = format!("diff --git a/{path} b/{path}\nindex {blob}..{} 100644\n--- a/{path}\n+++ b/{path}\n@@ -1 +1 @@\n-{original}\n+new\n", "a".repeat(40)).into_bytes();
    (blob, patch)
}

async fn gc(runner: &GitRunner, cwd: &Path) {
    git(runner, cwd, &["reflog", "expire", "--expire=now", "--all"]).await;
    git(runner, cwd, &["gc", "--prune=now"]).await;
}

#[tokio::test]
async fn expires_only_deleted_entries_and_reclaims_only_their_unshared_refs() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let expired = import(&runner, cwd, addition()).await;
    let active = import(&runner, cwd, addition()).await;
    gitx_meta::soft_delete_shelf(&common, &expired.id).unwrap();
    modify(&common, &expired, true, |v| v["deletedAt"] = json!(1));
    let before = git(&runner, cwd, &["status", "--porcelain=v2", "-z"]).await;
    let branches = git(&runner, cwd, &["for-each-ref", "refs/heads/"]).await;
    let result = runner.shelf_maintain(cwd, &cancel).await.unwrap();
    assert_eq!(result.expired, 1);
    assert_eq!(result.removed_refs, 1);
    assert!(!result.refs_preserved);
    let refs = String::from_utf8(
        git(
            &runner,
            cwd,
            &["for-each-ref", "--format=%(refname)", "refs/gitx/"],
        )
        .await,
    )
    .unwrap();
    assert!(refs.contains(&format!("shelf-base-{}", active.base_sha)));
    assert!(refs.contains(&active.id));
    assert!(!refs.contains(&expired.id));
    assert_eq!(
        before,
        git(&runner, cwd, &["status", "--porcelain=v2", "-z"]).await
    );
    assert_eq!(
        branches,
        git(&runner, cwd, &["for-each-ref", "refs/heads/"]).await
    );
    gitx_meta::soft_delete_shelf(&common, &active.id).unwrap();
    modify(&common, &active, true, |v| v["deletedAt"] = json!(1));
    assert_eq!(
        runner
            .shelf_maintain(cwd, &cancel)
            .await
            .unwrap()
            .removed_refs,
        2
    );
    assert!(git(&runner, cwd, &["for-each-ref", "refs/gitx/"])
        .await
        .is_empty());
}

#[tokio::test]
async fn imported_preimages_survive_retention_and_gc_then_expire_with_the_last_owner() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let (old_blob, old_patch) = dangling_patch(&runner, cwd, "old.txt", "old orphan content").await;
    let (live_blob, live_patch) =
        dangling_patch(&runner, cwd, "live.txt", "live orphan content").await;
    let expired = import(&runner, cwd, &old_patch).await;
    let retained = import(&runner, cwd, &live_patch).await;
    for entry in [&expired, &retained] {
        runner.shelf_delete(cwd, &entry.id, &cancel).await.unwrap();
    }
    modify(&common, &expired, true, |v| v["deletedAt"] = json!(1));
    assert_eq!(
        runner.shelf_maintain(cwd, &cancel).await.unwrap().expired,
        1
    );
    gc(&runner, cwd).await;
    assert_eq!(
        git(&runner, cwd, &["cat-file", "blob", &live_blob]).await,
        b"live orphan content\n"
    );
    assert!(runner
        .run(
            GitInvocation::new(cwd, ["cat-file", "-e", &old_blob]),
            &cancel
        )
        .await
        .is_err());
    runner
        .shelf_restore(cwd, &retained.id, &cancel)
        .await
        .unwrap();
    assert_eq!(
        gitx_meta::read_shelf_patch(&common, &retained.id).unwrap(),
        live_patch
    );
    runner
        .shelf_delete(cwd, &retained.id, &cancel)
        .await
        .unwrap();
    modify(&common, &retained, true, |v| v["deletedAt"] = json!(1));
    runner.shelf_maintain(cwd, &cancel).await.unwrap();
    gc(&runner, cwd).await;
    assert!(runner
        .run(
            GitInvocation::new(cwd, ["cat-file", "-e", &live_blob]),
            &cancel
        )
        .await
        .is_err());
}

#[tokio::test]
async fn legacy_migration_covers_the_original_patch_after_partial_consumption() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let (blob_a, patch_a) =
        dangling_patch(&runner, cwd, "a.txt", "first generation original").await;
    let (blob_b, patch_b) = dangling_patch(&runner, cwd, "b.txt", "second original").await;
    let combined = [patch_a, patch_b.clone()].concat();
    let entry = import(&runner, cwd, &combined).await;
    gitx_meta::consume_shelf_patch(
        &common,
        &entry.id,
        &combined,
        &["b.txt".into()],
        &patch_b,
        false,
    )
    .unwrap();
    modify(&common, &entry, false, |v| {
        v.as_object_mut().unwrap().remove("retainedObjects");
    });
    runner.shelf_delete(cwd, &entry.id, &cancel).await.unwrap();
    let result = runner.shelf_maintain(cwd, &cancel).await.unwrap();
    assert!(!result.refs_preserved);
    gc(&runner, cwd).await;
    assert_eq!(
        git(&runner, cwd, &["cat-file", "blob", &blob_a]).await,
        b"first generation original\n"
    );
    assert_eq!(
        git(&runner, cwd, &["cat-file", "blob", &blob_b]).await,
        b"second original\n"
    );
    runner.shelf_restore(cwd, &entry.id, &cancel).await.unwrap();
    assert_eq!(
        gitx_meta::read_shelf_patch(&common, &entry.id).unwrap(),
        patch_b
    );
    let meta: Value = serde_json::from_slice(
        &fs::read(gitx_meta::shelf_dir(&common, &entry.id).join("meta.json")).unwrap(),
    )
    .unwrap();
    assert!(meta["retainedObjects"].as_array().unwrap().len() >= 2);
}

#[tokio::test]
async fn damaged_storage_keeps_orphan_refs_and_maintenance_does_not_follow_symbolic_refs() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let entry = import(&runner, cwd, addition()).await;
    fs::write(
        gitx_meta::shelf_dir(&common, &entry.id).join("meta.json"),
        b"corrupt",
    )
    .unwrap();
    let before = git(&runner, cwd, &["for-each-ref", "refs/gitx/"]).await;
    let report = runner.shelf_maintain(cwd, &cancel).await.unwrap();
    assert!(report.refs_preserved);
    assert_eq!(report.removed_refs, 0);
    assert_eq!(
        before,
        git(&runner, cwd, &["for-each-ref", "refs/gitx/"]).await
    );
    let symbolic = format!("refs/gitx/shelf/{}", uuid::Uuid::new_v4());
    let branch = String::from_utf8(git(&runner, cwd, &["symbolic-ref", "HEAD"]).await).unwrap();
    git(&runner, cwd, &["symbolic-ref", &symbolic, branch.trim()]).await;
    // Remove only the intentionally damaged fixture files, leaving no entries.
    let dir = gitx_meta::shelf_dir(&common, &entry.id);
    fs::remove_file(dir.join("changes.patch")).unwrap();
    fs::remove_file(dir.join("meta.json")).unwrap();
    fs::remove_dir(dir).unwrap();
    let head = git(&runner, cwd, &["rev-parse", "HEAD"]).await;
    assert!(
        runner
            .shelf_maintain(cwd, &cancel)
            .await
            .unwrap()
            .removed_refs
            > 0
    );
    assert_eq!(
        git(&runner, cwd, &["symbolic-ref", &symbolic]).await,
        branch.as_bytes()
    );
    assert_eq!(head, git(&runner, cwd, &["rev-parse", "HEAD"]).await);
}

#[tokio::test]
async fn cancelling_while_waiting_for_a_shelf_writer_does_not_expire_data() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let entry = import(&runner, cwd, addition()).await;

    // Hold the operation lock as the "writer" for the whole setup + wait window.
    // Soft-delete under that lock instead of calling shelf_delete (which takes
    // and drops the same lock, racing the next try_lock under CI load).
    // Under --test-threads>1 the import File drop can briefly lag the next
    // try_lock on some runners; poll until the OS lock is free.
    let writer = {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            if let Some(lock) = gitx_meta::try_shelf_operation_lock(&common).unwrap() {
                break lock;
            }
            if tokio::time::Instant::now() >= deadline {
                panic!("shelf operation lock must be free after import returns");
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    };
    gitx_meta::soft_delete_shelf(&common, &entry.id).unwrap();
    let shelf_ref = format!("refs/gitx/shelf/{}", entry.id);
    let _ = git(
        &runner,
        cwd,
        &["update-ref", "--no-deref", "-d", &shelf_ref],
    )
    .await;
    modify(&common, &entry, true, |v| v["deletedAt"] = json!(1));
    assert!(
        gitx_meta::try_shelf_operation_lock(&common)
            .unwrap()
            .is_none(),
        "writer must still hold the exclusive operation lock"
    );

    let waiting = CancellationToken::new();
    let (result, ()) = tokio::join!(runner.shelf_maintain(cwd, &waiting), async {
        // Maintain polls the lock every 25ms; give it time to enter the wait
        // loop under our held writer lock before cancelling.
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        waiting.cancel();
    });
    assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
    assert!(gitx_meta::deleted_root(&common).join(&entry.id).exists());
    drop(writer);
    assert_eq!(
        runner.shelf_maintain(cwd, &cancel).await.unwrap().expired,
        1
    );
}

#[tokio::test]
async fn locked_ref_transaction_is_retryable_and_never_deletes_user_refs() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let entry = import(&runner, cwd, addition()).await;
    runner.shelf_delete(cwd, &entry.id, &cancel).await.unwrap();
    modify(&common, &entry, true, |v| v["deletedAt"] = json!(1));
    let lock = common.join(format!("refs/gitx/shelf-base-{}.lock", entry.base_sha));
    fs::write(&lock, b"other writer").unwrap();
    let branches = git(&runner, cwd, &["for-each-ref", "refs/heads/"]).await;
    assert!(runner.shelf_maintain(cwd, &cancel).await.is_err());
    assert!(!git(&runner, cwd, &["for-each-ref", "refs/gitx/"])
        .await
        .is_empty());
    assert_eq!(
        branches,
        git(&runner, cwd, &["for-each-ref", "refs/heads/"]).await
    );
    fs::remove_file(lock).unwrap();
    assert_eq!(
        runner
            .shelf_maintain(cwd, &cancel)
            .await
            .unwrap()
            .removed_refs,
        1
    );
    assert!(git(&runner, cwd, &["for-each-ref", "refs/gitx/"])
        .await
        .is_empty());
}

#[tokio::test]
async fn worktrees_share_retention_and_system_backups_keep_their_refs() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let linked = tempfile::tempdir().unwrap();
    let cwd = repo.path();
    let target = linked.path().join("linked");
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    git(
        &runner,
        cwd,
        &["worktree", "add", "--detach", target.to_str().unwrap()],
    )
    .await;
    let entry = import(&runner, cwd, addition()).await;
    runner
        .shelf_delete(&target, &entry.id, &cancel)
        .await
        .unwrap();
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    modify(&common, &entry, true, |v| {
        v["system"] = json!(true);
        v["deletedAt"] = json!(1);
    });
    let report = runner.shelf_maintain(&target, &cancel).await.unwrap();
    assert_eq!(report.expired, 0);
    assert_eq!(report.removed_refs, 0);
    assert_eq!(
        runner.shelf_list_deleted(cwd, &cancel).await.unwrap().len(),
        1
    );
    runner
        .shelf_restore(&target, &entry.id, &cancel)
        .await
        .unwrap();
    assert_eq!(runner.shelf_list(cwd, &cancel).await.unwrap().len(), 1);
    assert!(runner
        .shelf_maintain_if_due(cwd, &cancel)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn legacy_missing_preimages_preserve_refs_and_are_throttled() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    let (_, mut patch) = dangling_patch(&runner, cwd, "missing.txt", "external source").await;
    let text = String::from_utf8(patch).unwrap();
    let start = text.find("index ").unwrap() + 6;
    patch = format!(
        "{}{}{}",
        &text[..start],
        "b".repeat(40),
        &text[start + 40..]
    )
    .into_bytes();
    let entry = import(&runner, cwd, &patch).await;
    modify(&common, &entry, false, |v| {
        v.as_object_mut().unwrap().remove("retainedObjects");
    });
    let before = git(&runner, cwd, &["for-each-ref", "refs/gitx/"]).await;
    let report = runner.shelf_maintain(cwd, &cancel).await.unwrap();
    assert!(report.refs_preserved);
    assert_eq!(
        before,
        git(&runner, cwd, &["for-each-ref", "refs/gitx/"]).await
    );
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    assert!(!gitx_meta::shelf_maintenance_due(&common, now).unwrap());
}

#[tokio::test]
async fn concurrent_import_and_maintenance_keep_the_new_entry_reachable() {
    let repo = FixtureBuilder::new().build("clean").unwrap();
    let cwd = repo.path();
    let runner = GitRunner::new("git");
    let cancel = CancellationToken::new();
    let (blob, patch) = dangling_patch(&runner, cwd, "concurrent.txt", "concurrent import").await;
    let (entry, maintenance) = tokio::join!(
        import(&runner, cwd, &patch),
        runner.shelf_maintain(cwd, &cancel)
    );
    maintenance.unwrap();
    runner.shelf_maintain(cwd, &cancel).await.unwrap();
    gc(&runner, cwd).await;
    assert_eq!(
        git(&runner, cwd, &["cat-file", "blob", &blob]).await,
        b"concurrent import\n"
    );
    let common = runner.git_common_dir(cwd, &cancel).await.unwrap();
    assert_eq!(
        gitx_meta::read_shelf_patch(&common, &entry.id).unwrap(),
        patch
    );
}
