//! Per-repo gitx metadata storage (does not pollute the worktree).

#![allow(clippy::result_large_err)]

mod changelists;
mod recent;
mod shelf;
mod transaction;

pub use changelists::*;
pub use recent::deduplicate_recent_workspaces;
pub use shelf::*;

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
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new(ErrorCode::FsError, "settings path has no parent"))?;
    transaction::with_metadata_access(parent, || {
        let raw = fs::read_to_string(path)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("read settings: {e}")))?;
        let mut settings: AppSettings = serde_json::from_str(&raw)
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("parse settings: {e}")))?;
        if settings.schema_version < gitx_core::SETTINGS_SCHEMA_VERSION {
            settings = migrate_settings(settings);
        }
        Ok(settings)
    })
}

pub fn save_app_settings(path: &Path, settings: &AppSettings) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("create settings dir: {e}")))?;
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new(ErrorCode::FsError, "settings path has no parent"))?;
    transaction::with_metadata_access(parent, || transaction::write_json(path, settings))
}

fn migrate_settings(mut settings: AppSettings) -> AppSettings {
    // v1 → v2: flip default staging mode only when still at schema 1 and user never
    // customized (we cannot know; leave staging_mode as deserialized with new default
    // only for missing field — serde default handles that).
    settings.schema_version = gitx_core::SETTINGS_SCHEMA_VERSION;
    settings
}

/// Favorite ref full names (`refs/heads/main`, …) in the worktree's metadata.
pub fn favorites_path(git_common_dir: &Path) -> PathBuf {
    gitx_dir(git_common_dir).join("favorites.json")
}

pub fn load_favorites(git_common_dir: &Path) -> Result<Vec<String>, AppError> {
    transaction::with_metadata_access(git_common_dir, || load_favorites_unlocked(git_common_dir))
}

fn load_favorites_unlocked(git_common_dir: &Path) -> Result<Vec<String>, AppError> {
    let path = favorites_path(git_common_dir);
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(AppError::new(
                ErrorCode::FsError,
                format!("read favorites: {error}"),
            ))
        }
    };
    serde_json::from_str(&raw)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("parse favorites: {e}")))
}

pub fn save_favorites(git_common_dir: &Path, favorites: &[String]) -> Result<(), AppError> {
    transaction::with_metadata_access(git_common_dir, || {
        ensure_meta_dir(git_common_dir)?;
        transaction::write_json(&favorites_path(git_common_dir), favorites)
    })
}

pub fn toggle_favorite(git_dir: &Path, full_name: &str) -> Result<(), AppError> {
    update_favorites(git_dir, |favorites| {
        if favorites.iter().any(|name| name == full_name) {
            favorites.retain(|name| name != full_name);
        } else {
            favorites.push(full_name.into());
        }
    })
}

pub fn rename_favorite(git_dir: &Path, old_name: &str, new_name: &str) -> Result<(), AppError> {
    update_favorites(git_dir, |favorites| {
        let old_full = format!("refs/heads/{old_name}");
        for name in favorites.iter_mut() {
            if name == &old_full || name == old_name {
                *name = format!("refs/heads/{new_name}");
            }
        }
    })
}

fn update_favorites(git_dir: &Path, update: impl FnOnce(&mut Vec<String>)) -> Result<(), AppError> {
    transaction::with_metadata_access(git_dir, || {
        let mut favorites = load_favorites_unlocked(git_dir)?;
        update(&mut favorites);
        favorites.sort();
        favorites.dedup();
        ensure_meta_dir(git_dir)?;
        transaction::write_json(&favorites_path(git_dir), &favorites)
    })
}
