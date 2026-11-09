//! Shelf storage under `<common-dir>/gitx/shelf/<id>/`.

use gitx_core::{AppError, ErrorCode, ShelfEntry};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::{gitx_dir, transaction};

pub fn shelf_root(git_common_dir: &Path) -> PathBuf {
    gitx_dir(git_common_dir).join("shelf")
}

pub fn deleted_root(git_common_dir: &Path) -> PathBuf {
    shelf_root(git_common_dir).join(".deleted")
}

/// Construct a path only. Every storage operation validates the ID and the
/// storage directories before accessing it.
pub fn shelf_dir(git_common_dir: &Path, id: &str) -> PathBuf {
    shelf_root(git_common_dir).join(id)
}

fn validate_id(id: &str) -> Result<(), AppError> {
    if Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id) {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::InvalidArgument,
            "invalid Shelf ID",
        ))
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn fs_error(action: &str, error: std::io::Error) -> AppError {
    AppError::new(ErrorCode::FsError, format!("{action}: {error}"))
}

fn is_link(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Also reject junctions and other reparse points, not just symlinks.
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

/// False means missing. Existing components must have the expected plain type.
fn check_component(path: &Path, directory: bool) -> Result<bool, AppError> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(fs_error("inspect Shelf storage", error)),
    };
    if is_link(&meta)
        || (if directory {
            !meta.is_dir()
        } else {
            !meta.is_file()
        })
    {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "Shelf storage must use plain directories and files",
        ));
    }
    Ok(true)
}

fn checked_root(common: &Path, deleted: bool, create: bool) -> Result<PathBuf, AppError> {
    let mut parts = vec![gitx_dir(common), shelf_root(common)];
    if deleted {
        parts.push(deleted_root(common));
    }
    for path in &parts {
        if !check_component(path, true)? && create {
            match fs::create_dir(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(fs_error("create Shelf storage", error)),
            }
            check_component(path, true)?;
        }
    }
    Ok(parts.pop().expect("Shelf root"))
}

fn load_entry(root: &Path, id: &str) -> Result<ShelfEntry, AppError> {
    validate_id(id)?;
    let dir = root.join(id);
    if !check_component(&dir, true)? {
        return Err(AppError::new(ErrorCode::NotFound, "Shelf entry not found"));
    }
    if !check_component(&dir.join("meta.json"), false)?
        || !check_component(&dir.join("changes.patch"), false)?
    {
        return Err(AppError::new(
            ErrorCode::ShelfFailed,
            "Shelf metadata or patch is missing",
        ));
    }
    let raw = fs::read(dir.join("meta.json")).map_err(|e| fs_error("read Shelf metadata", e))?;
    let meta: ShelfEntry = serde_json::from_slice(&raw)
        .map_err(|e| AppError::new(ErrorCode::ShelfFailed, format!("parse Shelf metadata: {e}")))?;
    if meta.id != id {
        return Err(AppError::new(
            ErrorCode::ShelfFailed,
            "Shelf metadata ID does not match its directory",
        ));
    }
    Ok(meta)
}

fn list_entries(common: &Path, deleted: bool) -> Result<Vec<ShelfEntry>, AppError> {
    let root = checked_root(common, deleted, false)?;
    let directory = match fs::read_dir(&root) {
        Ok(directory) => directory,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(fs_error("read Shelf directory", error)),
    };
    let mut entries = Vec::new();
    for entry in directory {
        let entry = entry.map_err(|e| fs_error("read Shelf entry", e))?;
        let id = entry.file_name();
        let Some(id) = id.to_str() else { continue };
        // Interrupted staging directories and unrelated files are not entries.
        if validate_id(id).is_err() {
            continue;
        }
        match load_entry(&root, id) {
            Ok(meta) => entries.push(meta),
            Err(error) => {
                tracing::warn!(shelf_id = id, %error, "skipping damaged Shelf; files preserved")
            }
        }
    }
    entries.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(entries)
}

pub fn list_shelf(common: &Path) -> Result<Vec<ShelfEntry>, AppError> {
    transaction::with_metadata_access(common, || list_entries(common, false))
}

pub fn list_deleted_shelf(common: &Path) -> Result<Vec<ShelfEntry>, AppError> {
    transaction::with_metadata_access(common, || list_entries(common, true))
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let mut file = fs::File::create(path).map_err(|e| fs_error("create Shelf file", e))?;
    file.write_all(bytes)
        .map_err(|e| fs_error("write Shelf file", e))?;
    file.sync_all().map_err(|e| fs_error("flush Shelf file", e))
}

/// Publish a complete metadata/patch pair with a single directory rename. An
/// interrupted write leaves only a hidden staging directory, never a live entry.
#[allow(clippy::too_many_arguments)]
pub fn create_shelf_entry(
    common: &Path,
    message: &str,
    base_sha: &str,
    paths: &[String],
    patch: &[u8],
    source_changelist: Option<&str>,
    binary: bool,
    system: bool,
) -> Result<ShelfEntry, AppError> {
    transaction::with_metadata_access(common, || {
        let root = checked_root(common, false, true)?;
        let id = Uuid::new_v4().to_string();
        let meta = ShelfEntry {
            id: id.clone(),
            message: message.into(),
            created_at: now_secs(),
            base_sha: base_sha.into(),
            paths: paths.to_vec(),
            source_changelist: source_changelist.map(str::to_owned),
            binary,
            system,
        };
        let staging = tempfile::Builder::new()
            .prefix(".pending-")
            .tempdir_in(&root)
            .map_err(|e| fs_error("create Shelf staging directory", e))?;
        write_synced(&staging.path().join("changes.patch"), patch)?;
        let raw = serde_json::to_vec_pretty(&meta).map_err(|e| {
            AppError::new(
                ErrorCode::Internal,
                format!("serialize Shelf metadata: {e}"),
            )
        })?;
        write_synced(&staging.path().join("meta.json"), &raw)?;
        let target = root.join(id);
        require_absent(&target)?;
        fs::rename(staging.path(), &target).map_err(|e| fs_error("publish Shelf", e))?;
        Ok(meta)
    })
}

pub fn load_shelf_meta(common: &Path, id: &str) -> Result<ShelfEntry, AppError> {
    validate_id(id)?;
    transaction::with_metadata_access(common, || {
        load_entry(&checked_root(common, false, false)?, id)
    })
}

pub fn read_shelf_patch(common: &Path, id: &str) -> Result<Vec<u8>, AppError> {
    validate_id(id)?;
    transaction::with_metadata_access(common, || {
        let root = checked_root(common, false, false)?;
        load_entry(&root, id)?;
        fs::read(root.join(id).join("changes.patch")).map_err(|e| fs_error("read Shelf patch", e))
    })
}

pub fn rename_shelf(common: &Path, id: &str, message: &str) -> Result<ShelfEntry, AppError> {
    validate_id(id)?;
    transaction::with_metadata_access(common, || {
        let root = checked_root(common, false, false)?;
        let mut meta = load_entry(&root, id)?;
        meta.message = message.to_owned();
        transaction::write_json(&root.join(id).join("meta.json"), &meta)?;
        Ok(meta)
    })
}

fn require_absent(path: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(AppError::new(
            ErrorCode::InvalidArgument,
            "Shelf destination already exists; both entries were preserved",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(fs_error("inspect Shelf destination", error)),
    }
}

pub fn soft_delete_shelf(common: &Path, id: &str) -> Result<(), AppError> {
    validate_id(id)?;
    transaction::with_metadata_access(common, || {
        let root = checked_root(common, false, false)?;
        load_entry(&root, id)?;
        let deleted = checked_root(common, true, true)?.join(id);
        require_absent(&deleted)?;
        fs::rename(root.join(id), deleted).map_err(|e| fs_error("move Shelf to deleted", e))
    })
}

pub fn restore_shelf(common: &Path, id: &str) -> Result<ShelfEntry, AppError> {
    validate_id(id)?;
    transaction::with_metadata_access(common, || {
        let deleted = checked_root(common, true, false)?;
        let meta = load_entry(&deleted, id)?;
        let dest = checked_root(common, false, true)?.join(id);
        require_absent(&dest)?;
        fs::rename(deleted.join(id), dest).map_err(|e| fs_error("restore Shelf", e))?;
        Ok(meta)
    })
}
