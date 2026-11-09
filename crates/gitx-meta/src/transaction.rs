use gitx_core::{AppError, ErrorCode};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock, Weak};

type Locks = Mutex<HashMap<String, Weak<Mutex<()>>>>;
static LOCKS: OnceLock<Locks> = OnceLock::new();

/// Protect the complete metadata read/modify/write, including callers outside
/// Tauri. Resolve aliases before choosing a lock; idle entries retain no data.
/// Readers use the same in-process lock so Windows cannot reject our replace
/// while another application task still has the destination open for reading.
pub(crate) fn with_metadata_access<T>(
    git_dir: &Path,
    operation: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let dir = git_dir.canonicalize().map_err(|e| {
        AppError::new(
            ErrorCode::FsError,
            format!("resolve metadata directory: {e}"),
        )
    })?;
    let key = gitx_core::host_path_key(&dir.to_string_lossy());
    let mutex = {
        let mut map = LOCKS
            .get_or_init(Mutex::default)
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        map.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = map.get(&key).and_then(Weak::upgrade) {
            lock
        } else {
            let lock = Arc::new(Mutex::new(()));
            map.insert(key, Arc::downgrade(&lock));
            lock
        }
    };
    let _guard = mutex.lock().unwrap_or_else(|p| p.into_inner());
    operation()
}

/// Readers see either complete version. A unique temporary file cannot be
/// stolen by another writer and is removed automatically on any failure.
pub(crate) fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), AppError> {
    let raw = serde_json::to_vec_pretty(value)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("serialize metadata: {e}")))?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new(ErrorCode::FsError, "metadata path has no parent"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| {
        AppError::new(
            ErrorCode::FsError,
            format!("create metadata temporary file: {e}"),
        )
    })?;
    temp.write_all(&raw)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("write metadata: {e}")))?;
    temp.persist(path)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("replace metadata: {}", e.error)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_locks_are_reclaimed() {
        for _ in 0..100 {
            let dir = tempfile::tempdir().unwrap();
            with_metadata_access(dir.path(), || Ok(())).unwrap();
        }
        let map = LOCKS.get().unwrap().lock().unwrap();
        assert!(map.values().all(|lock| lock.upgrade().is_none()));
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn failed_replace_cleans_up_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("metadata.json");
        std::fs::create_dir(&target).unwrap();
        assert!(write_json(&target, &["value"]).is_err());
        assert!(target.is_dir());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
