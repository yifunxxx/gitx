//! Per-repo gitx metadata storage (does not pollute the worktree).

#![allow(clippy::result_large_err)]

use gitx_core::{AppError, AppSettings, ErrorCode};
use std::fs;
use std::path::{Path, PathBuf};

pub fn gitx_dir(git_common_dir: &Path) -> PathBuf {
    git_common_dir.join("gitx")
}

pub fn ensure_meta_dir(git_common_dir: &Path) -> Result<PathBuf, AppError> {
    let dir = gitx_dir(git_common_dir);
    fs::create_dir_all(&dir)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("create gitx meta dir: {e}")))?;
    Ok(dir)
}

/// App-level settings path helper (caller supplies config dir from Tauri).
pub fn load_app_settings(path: &Path) -> Result<AppSettings, AppError> {
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(path)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("read settings: {e}")))?;
    let mut settings: AppSettings = serde_json::from_str(&raw)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("parse settings: {e}")))?;
    if settings.schema_version < gitx_core::SETTINGS_SCHEMA_VERSION {
        settings = migrate_settings(settings);
    }
    Ok(settings)
}

pub fn save_app_settings(path: &Path, settings: &AppSettings) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("create settings dir: {e}")))?;
    }
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(settings)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("serialize settings: {e}")))?;
    fs::write(&tmp, raw)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("write settings: {e}")))?;
    fs::rename(&tmp, path)
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("rename settings: {e}")))?;
    Ok(())
}

fn migrate_settings(mut settings: AppSettings) -> AppSettings {
    settings.schema_version = gitx_core::SETTINGS_SCHEMA_VERSION;
    settings
}
