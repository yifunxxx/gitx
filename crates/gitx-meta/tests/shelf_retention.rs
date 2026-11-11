use gitx_meta::*;
use serde_json::{json, Value};
use std::{fs, path::Path};

const NOW: i64 = 2_000_000_000;

fn create(common: &Path, system: bool) -> String {
    create_shelf_entry(
        common,
        "retention",
        "base",
        &["a".into(), "b".into()],
        b"original",
        None,
        false,
        system,
    )
    .unwrap()
    .id
}

fn change_meta(common: &Path, id: &str, deleted: bool, change: impl FnOnce(&mut Value)) {
    let dir = if deleted {
        deleted_root(common).join(id)
    } else {
        shelf_dir(common, id)
    };
    let file = dir.join("meta.json");
    let mut value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    change(&mut value);
    fs::write(file, serde_json::to_vec(&value).unwrap()).unwrap();
}

#[test]
fn retention_uses_deletion_time_and_exact_thirty_day_boundary() {
    let repo = tempfile::tempdir().unwrap();
    let common = repo.path();
    let id = create(common, false);
    consume_shelf_patch(common, &id, b"original", &["b".into()], b"remaining", false).unwrap();
    soft_delete_shelf(common, &id).unwrap();
    change_meta(common, &id, true, |v| {
        v["createdAt"] = json!(1);
        v["deletedAt"] = json!(NOW);
    });
    let before = maintain_deleted_shelves(common, NOW + SHELF_RETENTION_SECS - 1).unwrap();
    assert_eq!(before.expired, 0);
    assert_eq!(before.entries.len(), 1);
    assert_eq!(
        fs::read_dir(deleted_root(common).join(&id))
            .unwrap()
            .count(),
        3
    );
    let after = maintain_deleted_shelves(common, NOW + SHELF_RETENTION_SECS).unwrap();
    assert_eq!(after.expired, 1);
    assert!(after.entries.is_empty());
    assert!(after.complete);
    assert!(!deleted_root(common).join(id).exists());
}

#[test]
fn legacy_deleted_shelves_start_with_a_full_grace_period() {
    let repo = tempfile::tempdir().unwrap();
    let id = create(repo.path(), false);
    soft_delete_shelf(repo.path(), &id).unwrap();
    change_meta(repo.path(), &id, true, |v| {
        v["createdAt"] = json!(1);
        v.as_object_mut().unwrap().remove("deletedAt");
    });
    assert_eq!(
        maintain_deleted_shelves(repo.path(), NOW).unwrap().expired,
        0
    );
    assert_eq!(
        maintain_deleted_shelves(repo.path(), NOW + SHELF_RETENTION_SECS - 1)
            .unwrap()
            .expired,
        0
    );
    assert_eq!(
        maintain_deleted_shelves(repo.path(), NOW + SHELF_RETENTION_SECS)
            .unwrap()
            .expired,
        1
    );
}

#[test]
fn active_system_and_future_deleted_records_never_expire() {
    let repo = tempfile::tempdir().unwrap();
    let active = create(repo.path(), false);
    let system = create(repo.path(), true);
    let future = create(repo.path(), false);
    change_meta(repo.path(), &active, false, |v| v["deletedAt"] = json!(1));
    for (id, time) in [(&system, 1), (&future, NOW + 1000)] {
        soft_delete_shelf(repo.path(), id).unwrap();
        change_meta(repo.path(), id, true, |v| v["deletedAt"] = json!(time));
    }
    let scan = maintain_deleted_shelves(repo.path(), NOW).unwrap();
    assert_eq!(scan.entries.len(), 3);
    assert_eq!(scan.expired, 0);
    assert!(scan.complete);
}

#[test]
fn restore_and_full_consumption_reset_the_retention_clock() {
    let repo = tempfile::tempdir().unwrap();
    let common = repo.path();
    let id = create(common, false);
    soft_delete_shelf(common, &id).unwrap();
    change_meta(common, &id, true, |v| v["deletedAt"] = json!(1));
    restore_shelf(common, &id).unwrap();
    let active: Value =
        serde_json::from_slice(&fs::read(shelf_dir(common, &id).join("meta.json")).unwrap())
            .unwrap();
    assert!(active.get("deletedAt").is_none());
    consume_shelf_patch(common, &id, b"original", &[], b"", false).unwrap();
    let deleted: Value = serde_json::from_slice(
        &fs::read(deleted_root(common).join(&id).join("meta.json")).unwrap(),
    )
    .unwrap();
    assert!(deleted["deletedAt"].as_i64().unwrap() > 1);
    assert_eq!(
        maintain_deleted_shelves(common, deleted["deletedAt"].as_i64().unwrap())
            .unwrap()
            .expired,
        0
    );
}

#[test]
fn corrupt_unknown_and_missing_records_are_preserved_and_block_ref_reclamation() {
    let repo = tempfile::tempdir().unwrap();
    for kind in ["corrupt", "unknown", "missing"] {
        let id = create(repo.path(), false);
        soft_delete_shelf(repo.path(), &id).unwrap();
        change_meta(repo.path(), &id, true, |v| v["deletedAt"] = json!(1));
        let dir = deleted_root(repo.path()).join(&id);
        match kind {
            "corrupt" => fs::write(dir.join("meta.json"), b"bad json").unwrap(),
            "unknown" => fs::write(dir.join("personal.txt"), b"keep").unwrap(),
            _ => fs::remove_file(dir.join("changes.patch")).unwrap(),
        }
    }
    let result = maintain_deleted_shelves(repo.path(), NOW).unwrap();
    assert!(!result.complete);
    assert_eq!(result.expired, 0);
    assert_eq!(fs::read_dir(deleted_root(repo.path())).unwrap().count(), 3);
}

#[test]
fn interrupted_expiry_can_finish_without_the_already_removed_patch() {
    let repo = tempfile::tempdir().unwrap();
    let id = create(repo.path(), false);
    soft_delete_shelf(repo.path(), &id).unwrap();
    change_meta(repo.path(), &id, true, |v| v["deletedAt"] = json!(1));
    let root = deleted_root(repo.path());
    let retired = root.join(format!(".expired-{id}"));
    fs::rename(root.join(&id), &retired).unwrap();
    fs::remove_file(retired.join("changes.patch")).unwrap();
    let result = maintain_deleted_shelves(repo.path(), NOW).unwrap();
    assert!(result.complete);
    assert_eq!(result.expired, 1);
    assert!(!retired.exists());
}

#[test]
fn operation_lock_is_exclusive_and_released_by_drop() {
    let repo = tempfile::tempdir().unwrap();
    let first = try_shelf_operation_lock(repo.path()).unwrap().unwrap();
    assert!(try_shelf_operation_lock(repo.path()).unwrap().is_none());
    let child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "lock_process_probe", "--nocapture"])
        .env("GITX_RETENTION_LOCK_PROBE", repo.path())
        .output()
        .unwrap();
    assert!(child.status.success(), "{:?}", child);
    drop(first);
    assert!(try_shelf_operation_lock(repo.path()).unwrap().is_some());
}

#[test]
fn lock_process_probe() {
    if let Some(common) = std::env::var_os("GITX_RETENTION_LOCK_PROBE") {
        assert!(try_shelf_operation_lock(Path::new(&common))
            .unwrap()
            .is_none());
    }
}

#[cfg(windows)]
#[test]
fn locked_patch_cleanup_retries_after_the_reader_releases_it() {
    use std::os::windows::fs::OpenOptionsExt;
    let repo = tempfile::tempdir().unwrap();
    let id = create(repo.path(), false);
    soft_delete_shelf(repo.path(), &id).unwrap();
    change_meta(repo.path(), &id, true, |v| v["deletedAt"] = json!(1));
    let dir = deleted_root(repo.path()).join(&id);
    let reader = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(dir.join("changes.patch"))
        .unwrap();
    let first = maintain_deleted_shelves(repo.path(), NOW).unwrap();
    assert!(!first.complete);
    assert_eq!(first.expired, 0);
    drop(reader);
    let retry = maintain_deleted_shelves(repo.path(), NOW).unwrap();
    assert!(retry.complete);
    assert_eq!(retry.expired, 1);
}

#[test]
fn maintenance_due_time_is_hourly_and_handles_clock_reversal() {
    let repo = tempfile::tempdir().unwrap();
    assert!(shelf_maintenance_due(repo.path(), NOW).unwrap());
    record_shelf_maintenance(repo.path(), NOW).unwrap();
    assert!(!shelf_maintenance_due(repo.path(), NOW + 3599).unwrap());
    assert!(shelf_maintenance_due(repo.path(), NOW + 3600).unwrap());
    assert!(shelf_maintenance_due(repo.path(), NOW - 1).unwrap());
}

#[cfg(windows)]
#[test]
fn junctions_are_preserved_without_touching_their_targets() {
    let repo = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("valuable.txt"), b"untouched").unwrap();
    let id = create(repo.path(), false);
    soft_delete_shelf(repo.path(), &id).unwrap();
    change_meta(repo.path(), &id, true, |v| v["deletedAt"] = json!(1));
    let link = deleted_root(repo.path())
        .join(&id)
        .join("changes-extra.patch");
    let output = std::process::Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(&link)
        .arg(outside.path())
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}", output);
    let result = maintain_deleted_shelves(repo.path(), NOW).unwrap();
    assert!(!result.complete);
    assert_eq!(result.expired, 0);
    assert_eq!(
        fs::read(outside.path().join("valuable.txt")).unwrap(),
        b"untouched"
    );
    fs::remove_dir(link).unwrap();
}
