use gitx_meta::*;
use std::fs;
use std::path::Path;

fn create(root: &Path) -> String {
    create_shelf_entry(
        root,
        "saved",
        "base",
        &["a.txt".into(), "b.bin".into()],
        b"original full patch",
        Some("work"),
        true,
        false,
    )
    .unwrap()
    .id
}

#[test]
fn partial_consumption_preserves_identity_and_recovery_through_rename_delete_restore() {
    let root = tempfile::tempdir().unwrap();
    let id = create(root.path());
    let before = load_shelf_meta(root.path(), &id).unwrap();
    consume_shelf_patch(
        root.path(),
        &id,
        b"original full patch",
        &["a.txt".into()],
        b"remaining a",
        false,
    )
    .unwrap();
    let (after, patch) = load_shelf_snapshot(root.path(), &id).unwrap();
    assert_eq!(after.paths, ["a.txt"]);
    assert!(!after.binary);
    assert_eq!(after.created_at, before.created_at);
    assert_eq!(after.base_sha, before.base_sha);
    assert_eq!(after.source_changelist, before.source_changelist);
    assert_eq!(patch, b"remaining a");
    assert_eq!(
        fs::read(shelf_dir(root.path(), &id).join("changes.patch")).unwrap(),
        b"original full patch"
    );
    rename_shelf(root.path(), &id, "renamed").unwrap();
    soft_delete_shelf(root.path(), &id).unwrap();
    assert_eq!(list_deleted_shelf(root.path()).unwrap()[0].paths, ["a.txt"]);
    restore_shelf(root.path(), &id).unwrap();
    let (restored, patch) = load_shelf_snapshot(root.path(), &id).unwrap();
    assert_eq!(restored.message, "renamed");
    assert_eq!(patch, b"remaining a");
    consume_shelf_patch(root.path(), &id, &patch, &[], b"", false).unwrap();
    assert!(list_shelf(root.path()).unwrap().is_empty());
    restore_shelf(root.path(), &id).unwrap();
    assert_eq!(read_shelf_patch(root.path(), &id).unwrap(), patch);
}

#[test]
fn stale_consumption_and_invalid_pair_leave_the_current_snapshot_untouched() {
    let root = tempfile::tempdir().unwrap();
    let id = create(root.path());
    consume_shelf_patch(
        root.path(),
        &id,
        b"original full patch",
        &["a.txt".into()],
        b"current",
        false,
    )
    .unwrap();
    for (paths, patch) in [
        (vec![], b"".as_slice()),
        (vec!["b.bin".into()], b"stale".as_slice()),
    ] {
        assert!(consume_shelf_patch(
            root.path(),
            &id,
            b"original full patch",
            &paths,
            patch,
            true
        )
        .is_err());
    }
    assert!(consume_shelf_patch(root.path(), &id, b"current", &[], b"bad", false).is_err());
    assert!(
        consume_shelf_patch(root.path(), &id, b"current", &["a.txt".into()], b"", false).is_err()
    );
    let (meta, patch) = load_shelf_snapshot(root.path(), &id).unwrap();
    assert_eq!(meta.paths, ["a.txt"]);
    assert_eq!(patch, b"current");
    assert_eq!(
        fs::read_dir(shelf_dir(root.path(), &id)).unwrap().count(),
        3
    );
}

#[test]
fn incomplete_and_unsafe_generations_are_not_read_as_current_patches() {
    let root = tempfile::tempdir().unwrap();
    let id = create(root.path());
    let dir = shelf_dir(root.path(), &id);
    fs::write(
        dir.join("changes-00000000-0000-0000-0000-000000000000.patch"),
        b"interrupted",
    )
    .unwrap();
    assert_eq!(
        read_shelf_patch(root.path(), &id).unwrap(),
        b"original full patch"
    );
    let raw = fs::read(dir.join("meta.json")).unwrap();
    for name in [
        "../outside.patch",
        "changes-../../outside.patch",
        "changes-00000000-0000-0000-0000-000000000001.patch",
    ] {
        let mut record: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        record["patchFile"] = name.into();
        fs::write(dir.join("meta.json"), serde_json::to_vec(&record).unwrap()).unwrap();
        assert!(read_shelf_patch(root.path(), &id).is_err());
        assert!(rename_shelf(root.path(), &id, "bad").is_err());
    }
    assert_eq!(
        fs::read(dir.join("changes.patch")).unwrap(),
        b"original full patch"
    );
}

#[cfg(windows)]
#[test]
fn metadata_replacement_failure_keeps_original_pair_and_cleans_unpublished_patch() {
    use std::os::windows::fs::OpenOptionsExt;
    let root = tempfile::tempdir().unwrap();
    let id = create(root.path());
    let dir = shelf_dir(root.path(), &id);
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(dir.join("meta.json"))
        .unwrap();
    assert!(consume_shelf_patch(
        root.path(),
        &id,
        b"original full patch",
        &["a.txt".into()],
        b"new",
        false
    )
    .is_err());
    drop(lock);
    let (meta, patch) = load_shelf_snapshot(root.path(), &id).unwrap();
    assert_eq!(meta.paths, ["a.txt", "b.bin"]);
    assert_eq!(patch, b"original full patch");
    assert_eq!(fs::read_dir(dir).unwrap().count(), 2);
}

#[test]
fn external_readers_can_resolve_both_old_and_new_metadata_generations() {
    let root = tempfile::tempdir().unwrap();
    let id = create(root.path());
    let dir = shelf_dir(root.path(), &id);
    let mut manifests = vec![fs::read(dir.join("meta.json")).unwrap()];
    let mut expected = b"original full patch".to_vec();
    for n in 0..8 {
        let name = format!("generation-{n}");
        let bytes = name.repeat(8192).into_bytes();
        consume_shelf_patch(
            root.path(),
            &id,
            &expected,
            std::slice::from_ref(&name),
            &bytes,
            false,
        )
        .unwrap();
        manifests.push(fs::read(dir.join("meta.json")).unwrap());
        expected = bytes;
    }
    for (i, manifest) in manifests.iter().enumerate() {
        let meta: serde_json::Value = serde_json::from_slice(manifest).unwrap();
        let name = meta["patchFile"].as_str().unwrap_or("changes.patch");
        let bytes = fs::read(dir.join(name)).unwrap();
        if i == 0 {
            assert_eq!(bytes, b"original full patch");
        } else {
            assert_eq!(
                bytes,
                format!("generation-{}", i - 1).repeat(8192).into_bytes()
            );
        }
    }
}
