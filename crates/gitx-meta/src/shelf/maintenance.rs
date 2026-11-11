//! Retention under the caller's common-directory Shelf operation lock.

use super::*;

pub const SHELF_RETENTION_SECS: i64 = 30 * 24 * 60 * 60;

pub struct RetainedShelf {
    pub entry: ShelfEntry,
    pub deleted: bool,
    pub objects: Option<Vec<String>>,
}

#[derive(Default)]
pub struct ShelfInventory {
    pub entries: Vec<RetainedShelf>,
    pub expired: usize,
    /// False means unknown storage may still need any of the internal refs.
    pub complete: bool,
}

/// An OS lock is released on process exit, without stale lock-file recovery.
/// GitRunner holds it across both Git refs and metadata publication. Do not
/// delete the lock file: other processes may already have its inode open.
pub fn try_shelf_operation_lock(common: &Path) -> Result<Option<fs::File>, AppError> {
    transaction::with_metadata_access(common, || {
        checked_root(common, false, true)?;
        let path = gitx_dir(common).join("shelf-operation.lock");
        check_component(&path, false)?;
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .map_err(|e| fs_error("open Shelf operation lock", e))?;
        match file.try_lock() {
            Ok(()) => Ok(Some(file)),
            Err(fs::TryLockError::WouldBlock) => Ok(None),
            Err(fs::TryLockError::Error(error)) => Err(fs_error("lock Shelf storage", error)),
        }
    })
}

pub fn shelf_maintenance_due(common: &Path, now: i64) -> Result<bool, AppError> {
    transaction::with_metadata_access(common, || {
        checked_root(common, false, false)?;
        let path = gitx_dir(common).join("shelf-maintenance.json");
        if !check_component(&path, false)? {
            return Ok(true);
        }
        let raw = fs::read(&path).map_err(|e| fs_error("read Shelf maintenance time", e))?;
        let last: i64 = serde_json::from_slice(&raw).unwrap_or(0);
        Ok(last <= 0 || now < last || now.saturating_sub(last) >= 3600)
    })
}

pub fn record_shelf_maintenance(common: &Path, now: i64) -> Result<(), AppError> {
    transaction::with_metadata_access(common, || {
        checked_root(common, false, true)?;
        let path = gitx_dir(common).join("shelf-maintenance.json");
        check_component(&path, false)?;
        transaction::write_json(&path, &now)
    })
}

fn is_patch(name: &str) -> bool {
    name == "changes.patch"
        || name
            .strip_prefix("changes-")
            .and_then(|s| s.strip_suffix(".patch"))
            .is_some_and(|id| validate_id(id).is_ok())
}

/// Only our flat, ordinary files may be removed or migrated. Unknown files,
/// directories and links keep the entry and prevent orphan-ref reclamation.
fn patch_files(dir: &Path) -> Result<Vec<PathBuf>, AppError> {
    check_component(dir, true)?;
    let mut patches = Vec::new();
    for item in fs::read_dir(dir).map_err(|e| fs_error("inspect Shelf files", e))? {
        let item = item.map_err(|e| fs_error("inspect Shelf file", e))?;
        check_component(&item.path(), false)?;
        let name = item.file_name();
        if name == "meta.json" {
            continue;
        }
        if !name.to_str().is_some_and(is_patch) {
            return Err(AppError::new(
                ErrorCode::ShelfFailed,
                "unrecognized Shelf file; preserved",
            ));
        }
        patches.push(item.path());
    }
    patches.sort();
    Ok(patches)
}

fn expired(record: &ShelfRecord, now: i64) -> bool {
    !record.meta.system
        && record.deleted_at.is_some_and(|deleted| {
            deleted > 0 && now.saturating_sub(deleted) >= SHELF_RETENTION_SECS
        })
}

fn purge_expired(dir: &Path, id: &str, now: i64) -> Result<(), AppError> {
    let patches = patch_files(dir)?;
    let meta = dir.join("meta.json");
    if check_component(&meta, false)? {
        let raw = fs::read(&meta).map_err(|e| fs_error("read expired Shelf", e))?;
        let record: ShelfRecord = serde_json::from_slice(&raw).map_err(|e| {
            AppError::new(ErrorCode::ShelfFailed, format!("parse expired Shelf: {e}"))
        })?;
        if record.meta.id != id || !expired(&record, now) {
            return Err(AppError::new(
                ErrorCode::ShelfFailed,
                "expired Shelf could not be verified",
            ));
        }
        // Metadata is removed last so interrupted deletion can be retried.
        for patch in patches {
            fs::remove_file(patch).map_err(|e| fs_error("remove expired Shelf patch", e))?;
        }
        fs::remove_file(meta).map_err(|e| fs_error("remove expired Shelf metadata", e))?;
    } else if !patches.is_empty() {
        return Err(AppError::new(
            ErrorCode::ShelfFailed,
            "expired Shelf metadata missing; preserved",
        ));
    }
    fs::remove_dir(dir).map_err(|e| fs_error("remove expired Shelf directory", e))
}

/// Only deleted non-system entries can expire. Creation time and filesystem
/// mtime are never used as deletion time, including for legacy installations.
pub fn maintain_deleted_shelves(common: &Path, now: i64) -> Result<ShelfInventory, AppError> {
    if now <= 0 {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "invalid Shelf maintenance time",
        ));
    }
    transaction::with_metadata_access(common, || {
        let mut inventory = ShelfInventory {
            complete: true,
            ..Default::default()
        };
        for deleted in [false, true] {
            let root = checked_root(common, deleted, false)?;
            let items = match fs::read_dir(&root) {
                Ok(items) => items,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(fs_error("read Shelf storage", e)),
            };
            for item in items {
                let item = item.map_err(|e| fs_error("read Shelf entry", e))?;
                let name = item.file_name();
                let Some(name) = name.to_str() else {
                    inventory.complete = false;
                    continue;
                };
                if !deleted && name == ".deleted" {
                    continue;
                }
                if deleted {
                    if let Some(id) = name
                        .strip_prefix(".expired-")
                        .filter(|id| validate_id(id).is_ok())
                    {
                        match purge_expired(&item.path(), id, now) {
                            Ok(()) => inventory.expired += 1,
                            Err(error) => {
                                inventory.complete = false;
                                tracing::warn!(%error, "preserving unfinished Shelf cleanup");
                            }
                        }
                        continue;
                    }
                }
                let result = (|| {
                    let mut record = load_record(&root, name)?;
                    patch_files(&item.path())?;
                    if deleted && !record.meta.system {
                        if record.deleted_at.is_none_or(|time| time <= 0) {
                            record.deleted_at = Some(now);
                            transaction::write_json(&item.path().join("meta.json"), &record)?;
                        }
                        if expired(&record, now) {
                            let tombstone = root.join(format!(".expired-{name}"));
                            require_absent(&tombstone)?;
                            fs::rename(item.path(), &tombstone)
                                .map_err(|e| fs_error("retire expired Shelf", e))?;
                            purge_expired(&tombstone, name, now)?;
                            inventory.expired += 1;
                            return Ok(());
                        }
                    }
                    inventory.entries.push(RetainedShelf {
                        entry: record.meta,
                        deleted,
                        objects: record.retained_objects,
                    });
                    Ok::<_, AppError>(())
                })();
                if let Err(error) = result {
                    inventory.complete = false;
                    tracing::warn!(shelf_id = name, %error, "preserving unverified Shelf storage and refs");
                }
            }
        }
        Ok(inventory)
    })
}

/// A bounded one-time migration includes every saved generation, not just
/// the partially-consumed patch. Oversized legacy entries keep existing refs.
pub fn shelf_legacy_patches(
    common: &Path,
    id: &str,
    deleted: bool,
) -> Result<Vec<Vec<u8>>, AppError> {
    transaction::with_metadata_access(common, || {
        let root = checked_root(common, deleted, false)?;
        load_record(&root, id)?;
        let mut remaining = 32 * 1024 * 1024;
        let mut result = Vec::new();
        for path in patch_files(&root.join(id))? {
            let mut bytes = Vec::new();
            fs::File::open(path)
                .map_err(|e| fs_error("open legacy Shelf patch", e))?
                .take(remaining + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| fs_error("read legacy Shelf patch", e))?;
            if bytes.len() as u64 > remaining {
                return Err(AppError::new(
                    ErrorCode::ShelfFailed,
                    "legacy Shelf exceeds migration limit; refs preserved",
                ));
            }
            remaining -= bytes.len() as u64;
            result.push(bytes);
        }
        Ok(result)
    })
}

pub fn record_shelf_objects(
    common: &Path,
    id: &str,
    deleted: bool,
    objects: Vec<String>,
) -> Result<(), AppError> {
    transaction::with_metadata_access(common, || {
        let root = checked_root(common, deleted, false)?;
        let mut record = load_record(&root, id)?;
        record.retained_objects = Some(objects);
        transaction::write_json(&root.join(id).join("meta.json"), &record)
    })
}
