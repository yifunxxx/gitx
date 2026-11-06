//! Shelf storage under `<common-dir>/gitx/shelf/<id>/`.

use gitx_core::{AppError, ErrorCode, ShelfEntry};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::{ensure_meta_dir, gitx_dir};

pub fn shelf_root(git_common_dir: &Path) -> PathBuf {
    gitx_dir(git_common_dir).join("shelf")
}

pub fn deleted_root(git_common_dir: &Path) -> PathBuf {
    shelf_root(git_common_dir).join(".deleted")
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn list_shelf(git_common_dir: &Path) -> Result<Vec<ShelfEntry>, AppError> {
    let root = shelf_root(git_common_dir);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for ent in fs::read_dir(&root)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("read shelf dir: {e}")))?
    {
        let ent =
            ent.map_err(|e| AppError::new(ErrorCode::FsError, format!("read shelf entry: {e}")))?;
        let name = ent.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let meta_path = ent.path().join("meta.json");
        if !meta_path.exists() {
            continue;
        }
        let raw = fs::read_to_string(&meta_path)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("read shelf meta: {e}")))?;
        let meta: ShelfEntry = serde_json::from_str(&raw)
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("parse shelf meta: {e}")))?;
        entries.push(meta);
    }
    entries.sort_by_key(|e| std::cmp::Reverse(e.created_at));
    Ok(entries)
}

pub fn list_deleted_shelf(git_common_dir: &Path) -> Result<Vec<ShelfEntry>, AppError> {
    let root = deleted_root(git_common_dir);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for ent in fs::read_dir(&root)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("read deleted shelf: {e}")))?
    {
        let ent =
            ent.map_err(|e| AppError::new(ErrorCode::FsError, format!("read deleted entry: {e}")))?;
        let meta_path = ent.path().join("meta.json");
        if !meta_path.exists() {
            continue;
        }
        let raw = fs::read_to_string(&meta_path)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("read shelf meta: {e}")))?;
        if let Ok(meta) = serde_json::from_str::<ShelfEntry>(&raw) {
            entries.push(meta);
        }
    }
    entries.sort_by_key(|e| std::cmp::Reverse(e.created_at));
    Ok(entries)
}

pub struct NewShelf {
    pub id: String,
    pub dir: PathBuf,
    pub meta: ShelfEntry,
}

/// Allocate a new shelf directory and write meta + patch bytes.
pub fn create_shelf_entry(
    git_common_dir: &Path,
    message: &str,
    base_sha: &str,
    paths: &[String],
    patch: &[u8],
    source_changelist: Option<&str>,
    binary: bool,
    system: bool,
) -> Result<ShelfEntry, AppError> {
    ensure_meta_dir(git_common_dir)?;
    let root = shelf_root(git_common_dir);
    fs::create_dir_all(&root)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("create shelf root: {e}")))?;
    let id = Uuid::new_v4().to_string();
    let dir = root.join(&id);
    fs::create_dir_all(&dir)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("create shelf dir: {e}")))?;
    let meta = ShelfEntry {
        id: id.clone(),
        message: message.to_string(),
        created_at: now_secs(),
        base_sha: base_sha.to_string(),
        paths: paths.to_vec(),
        source_changelist: source_changelist.map(|s| s.to_string()),
        binary,
        system,
    };
    let meta_path = dir.join("meta.json");
    let tmp = meta_path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(&meta)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("serialize shelf meta: {e}")))?;
    fs::write(&tmp, raw)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("write shelf meta: {e}")))?;
    fs::rename(&tmp, &meta_path)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("rename shelf meta: {e}")))?;
    fs::write(dir.join("changes.patch"), patch)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("write shelf patch: {e}")))?;
    Ok(meta)
}

pub fn shelf_dir(git_common_dir: &Path, id: &str) -> PathBuf {
    shelf_root(git_common_dir).join(id)
}

pub fn load_shelf_meta(git_common_dir: &Path, id: &str) -> Result<ShelfEntry, AppError> {
    let path = shelf_dir(git_common_dir, id).join("meta.json");
    if !path.exists() {
        let deleted = deleted_root(git_common_dir).join(id).join("meta.json");
        if deleted.exists() {
            let raw = fs::read_to_string(&deleted)
                .map_err(|e| AppError::new(ErrorCode::FsError, format!("read shelf meta: {e}")))?;
            return serde_json::from_str(&raw)
                .map_err(|e| AppError::new(ErrorCode::Internal, format!("parse shelf meta: {e}")));
        }
        return Err(AppError::new(ErrorCode::NotFound, "shelf entry not found"));
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("read shelf meta: {e}")))?;
    serde_json::from_str(&raw)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("parse shelf meta: {e}")))
}

pub fn read_shelf_patch(git_common_dir: &Path, id: &str) -> Result<Vec<u8>, AppError> {
    let path = shelf_dir(git_common_dir, id).join("changes.patch");
    fs::read(&path).map_err(|e| AppError::new(ErrorCode::FsError, format!("read shelf patch: {e}")))
}

pub fn rename_shelf(
    git_common_dir: &Path,
    id: &str,
    message: &str,
) -> Result<ShelfEntry, AppError> {
    let mut meta = load_shelf_meta(git_common_dir, id)?;
    meta.message = message.to_string();
    let path = shelf_dir(git_common_dir, id).join("meta.json");
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(&meta)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("serialize shelf meta: {e}")))?;
    fs::write(&tmp, raw)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("write shelf meta: {e}")))?;
    fs::rename(&tmp, &path)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("rename shelf meta: {e}")))?;
    Ok(meta)
}

pub fn soft_delete_shelf(git_common_dir: &Path, id: &str) -> Result<(), AppError> {
    let src = shelf_dir(git_common_dir, id);
    if !src.exists() {
        return Err(AppError::new(ErrorCode::NotFound, "shelf entry not found"));
    }
    let dest_root = deleted_root(git_common_dir);
    fs::create_dir_all(&dest_root)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("create deleted shelf: {e}")))?;
    let dest = dest_root.join(id);
    if dest.exists() {
        let _ = fs::remove_dir_all(&dest);
    }
    fs::rename(&src, &dest)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("move shelf to deleted: {e}")))?;
    Ok(())
}

pub fn restore_shelf(git_common_dir: &Path, id: &str) -> Result<ShelfEntry, AppError> {
    let src = deleted_root(git_common_dir).join(id);
    if !src.exists() {
        return Err(AppError::new(
            ErrorCode::NotFound,
            "deleted shelf entry not found",
        ));
    }
    let dest = shelf_dir(git_common_dir, id);
    if dest.exists() {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "shelf entry already exists",
        ));
    }
    fs::create_dir_all(shelf_root(git_common_dir))
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("create shelf root: {e}")))?;
    fs::rename(&src, &dest)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("restore shelf: {e}")))?;
    load_shelf_meta(git_common_dir, id)
}

pub fn remove_paths_from_shelf(
    git_common_dir: &Path,
    id: &str,
    applied_paths: &[String],
) -> Result<Option<ShelfEntry>, AppError> {
    let mut meta = load_shelf_meta(git_common_dir, id)?;
    meta.paths
        .retain(|p| !applied_paths.iter().any(|a| a == p));
    if meta.paths.is_empty() {
        soft_delete_shelf(git_common_dir, id)?;
        return Ok(None);
    }
    let path = shelf_dir(git_common_dir, id).join("meta.json");
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(&meta)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("serialize shelf meta: {e}")))?;
    fs::write(&tmp, raw)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("write shelf meta: {e}")))?;
    fs::rename(&tmp, &path)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("rename shelf meta: {e}")))?;
    Ok(Some(meta))
}
