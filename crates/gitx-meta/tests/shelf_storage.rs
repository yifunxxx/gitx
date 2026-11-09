use gitx_core::{ErrorCode, ShelfEntry};
use gitx_meta::*;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Barrier};

fn create(root: &Path, message: &str) -> ShelfEntry {
    create_shelf_entry(
        root,
        message,
        "base",
        &["saved.txt".into()],
        b"saved patch",
        None,
        false,
        false,
    )
    .unwrap()
}

fn entry_dir(root: &Path, id: &str) -> std::path::PathBuf {
    shelf_root(root).join(id)
}

fn copy_entry(src: &Path, dest: &Path) {
    fs::create_dir_all(dest).unwrap();
    for name in ["meta.json", "changes.patch"] {
        fs::copy(src.join(name), dest.join(name)).unwrap();
    }
}

#[test]
fn invalid_ids_cannot_read_rename_delete_or_restore_other_directories() {
    let repo = tempfile::tempdir().unwrap();
    let entry = create(repo.path(), "valid");
    let victim = repo.path().join("victim");
    copy_entry(&entry_dir(repo.path(), &entry.id), &victim);
    let before = fs::read(victim.join("meta.json")).unwrap();
    for id in [
        "../../victim",
        "..\\..\\victim",
        ".deleted",
        "",
        "not-a-uuid",
        victim.to_str().unwrap(),
    ] {
        assert_eq!(
            read_shelf_patch(repo.path(), id).unwrap_err().code,
            ErrorCode::InvalidArgument,
            "{id}"
        );
        assert_eq!(
            load_shelf_meta(repo.path(), id).unwrap_err().code,
            ErrorCode::InvalidArgument,
            "{id}"
        );
        assert!(rename_shelf(repo.path(), id, "changed").is_err());
        assert!(soft_delete_shelf(repo.path(), id).is_err());
        assert!(restore_shelf(repo.path(), id).is_err());
    }
    assert_eq!(fs::read(victim.join("meta.json")).unwrap(), before);
    assert_eq!(
        fs::read(victim.join("changes.patch")).unwrap(),
        b"saved patch"
    );
}

#[test]
fn delete_collision_preserves_both_active_and_deleted_backups() {
    let repo = tempfile::tempdir().unwrap();
    let entry = create(repo.path(), "active");
    let active = entry_dir(repo.path(), &entry.id);
    let deleted = deleted_root(repo.path()).join(&entry.id);
    copy_entry(&active, &deleted);
    fs::write(deleted.join("changes.patch"), b"older backup").unwrap();
    assert!(soft_delete_shelf(repo.path(), &entry.id).is_err());
    assert_eq!(
        fs::read(active.join("changes.patch")).unwrap(),
        b"saved patch"
    );
    assert_eq!(
        fs::read(deleted.join("changes.patch")).unwrap(),
        b"older backup"
    );
    assert!(restore_shelf(repo.path(), &entry.id).is_err());
    assert_eq!(
        fs::read(deleted.join("changes.patch")).unwrap(),
        b"older backup"
    );
}

#[test]
fn incomplete_corrupt_and_mismatched_entries_do_not_hide_valid_shelves() {
    let repo = tempfile::tempdir().unwrap();
    let valid = create(repo.path(), "valid");
    let incomplete = create(repo.path(), "incomplete");
    fs::remove_file(entry_dir(repo.path(), &incomplete.id).join("changes.patch")).unwrap();
    let corrupt = create(repo.path(), "corrupt");
    fs::write(
        entry_dir(repo.path(), &corrupt.id).join("meta.json"),
        b"broken json",
    )
    .unwrap();
    let mismatched = create(repo.path(), "mismatched");
    let mut forged = mismatched.clone();
    forged.id = "../../victim".into();
    fs::write(
        entry_dir(repo.path(), &mismatched.id).join("meta.json"),
        serde_json::to_vec(&forged).unwrap(),
    )
    .unwrap();
    assert_eq!(
        list_shelf(repo.path())
            .unwrap()
            .iter()
            .map(|e| &e.id)
            .collect::<Vec<_>>(),
        [&valid.id]
    );
    assert!(load_shelf_meta(repo.path(), &incomplete.id).is_err());
    assert!(load_shelf_meta(repo.path(), &mismatched.id).is_err());
    assert!(rename_shelf(repo.path(), &mismatched.id, "new").is_err());
    assert!(soft_delete_shelf(repo.path(), &mismatched.id).is_err());
    assert_eq!(
        fs::read(entry_dir(repo.path(), &corrupt.id).join("meta.json")).unwrap(),
        b"broken json"
    );
}

#[test]
fn restore_validates_the_saved_entry_before_moving_it() {
    let repo = tempfile::tempdir().unwrap();
    let entry = create(repo.path(), "saved");
    soft_delete_shelf(repo.path(), &entry.id).unwrap();
    let deleted = deleted_root(repo.path()).join(&entry.id);
    fs::write(deleted.join("meta.json"), b"broken json").unwrap();
    assert!(restore_shelf(repo.path(), &entry.id).is_err());
    assert!(deleted.exists());
    assert!(!entry_dir(repo.path(), &entry.id).exists());
    assert_eq!(
        fs::read(deleted.join("changes.patch")).unwrap(),
        b"saved patch"
    );
}

#[test]
fn renamed_deleted_and_restored_entries_keep_their_patch_and_identity() {
    let repo = tempfile::tempdir().unwrap();
    let entry = create(repo.path(), "before");
    let renamed = rename_shelf(repo.path(), &entry.id, "after").unwrap();
    assert_eq!(renamed.id, entry.id);
    assert_eq!(renamed.message, "after");
    soft_delete_shelf(repo.path(), &entry.id).unwrap();
    assert!(list_shelf(repo.path()).unwrap().is_empty());
    assert_eq!(list_deleted_shelf(repo.path()).unwrap()[0].message, "after");
    assert!(rename_shelf(repo.path(), &entry.id, "wrong").is_err());
    let restored = restore_shelf(repo.path(), &entry.id).unwrap();
    assert_eq!(restored.message, "after");
    assert_eq!(
        read_shelf_patch(repo.path(), &entry.id).unwrap(),
        b"saved patch"
    );
    assert!(list_deleted_shelf(repo.path()).unwrap().is_empty());
}

#[test]
fn concurrent_renames_never_share_a_temporary_file_or_corrupt_metadata() {
    let repo = tempfile::tempdir().unwrap();
    let entry = create(repo.path(), "before");
    let gate = Arc::new(Barrier::new(16));
    std::thread::scope(|scope| {
        let jobs: Vec<_> = (0..16)
            .map(|n| {
                let gate = gate.clone();
                let path = repo.path();
                let id = &entry.id;
                scope.spawn(move || {
                    gate.wait();
                    for round in 0..8 {
                        rename_shelf(path, id, &format!("writer-{n}-{round}")).unwrap();
                    }
                })
            })
            .collect();
        for job in jobs {
            job.join().unwrap();
        }
    });
    assert!(load_shelf_meta(repo.path(), &entry.id)
        .unwrap()
        .message
        .starts_with("writer-"));
    assert_eq!(
        read_shelf_patch(repo.path(), &entry.id).unwrap(),
        b"saved patch"
    );
    assert_eq!(
        fs::read_dir(entry_dir(repo.path(), &entry.id))
            .unwrap()
            .count(),
        2
    );
}

#[test]
fn staging_directories_are_never_listed_as_completed_or_deleted_shelves() {
    let repo = tempfile::tempdir().unwrap();
    let entry = create(repo.path(), "valid");
    copy_entry(
        &entry_dir(repo.path(), &entry.id),
        &shelf_root(repo.path()).join(".pending-interrupted"),
    );
    copy_entry(
        &entry_dir(repo.path(), &entry.id),
        &deleted_root(repo.path()).join(".pending-interrupted"),
    );
    assert_eq!(list_shelf(repo.path()).unwrap().len(), 1);
    assert!(list_deleted_shelf(repo.path()).unwrap().is_empty());
}

#[test]
fn external_readers_only_see_complete_published_metadata_and_patch_pairs() {
    let repo = tempfile::tempdir().unwrap();
    fs::create_dir_all(shelf_root(repo.path())).unwrap();
    let bytes = vec![0x6a; 512 * 1024];
    std::thread::scope(|scope| {
        let (done, receiver) = std::sync::mpsc::channel();
        let root = repo.path();
        let data = &bytes;
        let writer = scope.spawn(move || {
            for n in 0..16 {
                create_shelf_entry(
                    root,
                    &format!("snapshot-{n}"),
                    "base",
                    &["saved.bin".into()],
                    data,
                    None,
                    true,
                    false,
                )
                .unwrap();
            }
            done.send(()).unwrap();
        });
        while receiver.try_recv() == Err(std::sync::mpsc::TryRecvError::Empty) {
            for dir in fs::read_dir(shelf_root(root)).unwrap() {
                let dir = dir.unwrap();
                let id = dir.file_name();
                let id = id.to_str().unwrap();
                if id.starts_with('.') {
                    continue;
                }
                let meta: ShelfEntry =
                    serde_json::from_slice(&fs::read(dir.path().join("meta.json")).unwrap())
                        .unwrap();
                assert_eq!(meta.id, id);
                assert_eq!(fs::read(dir.path().join("changes.patch")).unwrap(), bytes);
            }
        }
        writer.join().unwrap();
    });
    assert_eq!(list_shelf(repo.path()).unwrap().len(), 16);
    assert_eq!(fs::read_dir(shelf_root(repo.path())).unwrap().count(), 16);
}

#[cfg(any(unix, windows))]
#[test]
fn storage_links_cannot_redirect_patch_reads_or_new_shelves() {
    let repo = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    let entry = create(repo.path(), "saved");
    let patch = entry_dir(repo.path(), &entry.id).join("changes.patch");
    let outside = external.path().join("outside.patch");
    fs::write(&outside, b"outside content").unwrap();
    fs::remove_file(&patch).unwrap();
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(&outside, &patch);
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_file(&outside, &patch);
    if let Err(error) = linked {
        #[cfg(windows)]
        if error.raw_os_error() == Some(1314) {
            eprintln!("SKIPPED storage link checks: Windows symlink privilege is unavailable");
            return;
        }
        panic!("cannot create test symlink: {error}");
    }
    assert_eq!(
        read_shelf_patch(repo.path(), &entry.id).unwrap_err().code,
        ErrorCode::InvalidArgument
    );
    assert!(rename_shelf(repo.path(), &entry.id, "changed").is_err());
    assert!(soft_delete_shelf(repo.path(), &entry.id).is_err());
    assert_eq!(fs::read(&outside).unwrap(), b"outside content");

    let redirected = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(external.path(), redirected.path().join("gitx")).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(external.path(), redirected.path().join("gitx")).unwrap();
    assert!(list_shelf(redirected.path()).is_err());
    assert!(create_shelf_entry(
        redirected.path(),
        "blocked",
        "base",
        &["x".into()],
        b"patch",
        None,
        false,
        false
    )
    .is_err());
    assert!(!external.path().join("shelf").exists());
}
