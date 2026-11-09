//! Changelist persistence under `<git-dir>/gitx/changelists.json` (per worktree).

use gitx_core::{AppError, ChangelistInfo, ChangelistsState, ErrorCode, PathAssignment};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::{ensure_meta_dir, gitx_dir};

pub fn changelists_path(git_dir: &Path) -> PathBuf {
    gitx_dir(git_dir).join("changelists.json")
}

pub fn load_changelists(git_dir: &Path) -> Result<ChangelistsState, AppError> {
    crate::transaction::with_metadata_access(git_dir, || load_changelists_unlocked(git_dir))
}

fn load_changelists_unlocked(git_dir: &Path) -> Result<ChangelistsState, AppError> {
    let path = changelists_path(git_dir);
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ChangelistsState::default())
        }
        Err(error) => {
            return Err(AppError::new(
                ErrorCode::FsError,
                format!("read changelists: {error}"),
            ))
        }
    };
    serde_json::from_str(&raw)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("parse changelists: {e}")))
}

fn save_changelists(git_dir: &Path, state: &ChangelistsState) -> Result<(), AppError> {
    ensure_meta_dir(git_dir)?;
    crate::transaction::write_json(&changelists_path(git_dir), state)
}

pub fn create_changelist(
    git_dir: &Path,
    name: &str,
    comment: &str,
    set_active: bool,
) -> Result<ChangelistsState, AppError> {
    crate::transaction::with_metadata_access(git_dir, || {
        let mut state = load_changelists_unlocked(git_dir)?;
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "changelist name is empty",
            ));
        }
        if state
            .lists
            .iter()
            .any(|l| l.name.eq_ignore_ascii_case(name))
        {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                format!("changelist '{name}' already exists"),
            ));
        }
        if set_active {
            for l in &mut state.lists {
                l.active = false;
            }
        }
        state.lists.push(ChangelistInfo {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            comment: comment.to_string(),
            active: set_active || state.lists.iter().all(|l| !l.active),
        });
        save_changelists(git_dir, &state)?;
        Ok(state)
    })
}

pub fn rename_changelist(
    git_dir: &Path,
    id: &str,
    name: &str,
) -> Result<ChangelistsState, AppError> {
    crate::transaction::with_metadata_access(git_dir, || {
        let mut state = load_changelists_unlocked(git_dir)?;
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "changelist name is empty",
            ));
        }
        if state
            .lists
            .iter()
            .any(|l| l.id != id && l.name.eq_ignore_ascii_case(name))
        {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                format!("changelist '{name}' already exists"),
            ));
        }
        let list = state
            .lists
            .iter_mut()
            .find(|l| l.id == id)
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "changelist not found"))?;
        if list.id == "default" && name != "Changes" {
            // Allow rename of default list name (IDEA does).
        }
        list.name = name.to_string();
        save_changelists(git_dir, &state)?;
        Ok(state)
    })
}

pub fn delete_changelist(
    git_dir: &Path,
    id: &str,
    move_to: Option<&str>,
) -> Result<ChangelistsState, AppError> {
    crate::transaction::with_metadata_access(git_dir, || {
        let mut state = load_changelists_unlocked(git_dir)?;
        if id == "default" {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "default Changes list cannot be deleted",
            ));
        }
        let target = move_to
            .map(|s| s.to_string())
            .or_else(|| state.lists.iter().find(|l| l.active).map(|l| l.id.clone()))
            .unwrap_or_else(|| "default".into());
        if target == id {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "cannot move files onto the list being deleted",
            ));
        }
        if !state.lists.iter().any(|l| l.id == target) {
            return Err(AppError::new(
                ErrorCode::NotFound,
                "target changelist not found",
            ));
        }
        let was_active = state
            .lists
            .iter()
            .find(|l| l.id == id)
            .map(|l| l.active)
            .unwrap_or(false);
        state.lists.retain(|l| l.id != id);
        for a in &mut state.assignments {
            if a.list_id == id {
                a.list_id = target.clone();
                a.hunk_ranges.clear();
            }
        }
        if was_active {
            if let Some(t) = state.lists.iter_mut().find(|l| l.id == target) {
                t.active = true;
            }
        }
        save_changelists(git_dir, &state)?;
        Ok(state)
    })
}

pub fn set_active_changelist(git_dir: &Path, id: &str) -> Result<ChangelistsState, AppError> {
    crate::transaction::with_metadata_access(git_dir, || {
        let mut state = load_changelists_unlocked(git_dir)?;
        if !state.lists.iter().any(|l| l.id == id) {
            return Err(AppError::new(ErrorCode::NotFound, "changelist not found"));
        }
        for l in &mut state.lists {
            l.active = l.id == id;
        }
        save_changelists(git_dir, &state)?;
        Ok(state)
    })
}

pub fn move_paths(
    git_dir: &Path,
    paths: &[String],
    target_list_id: &str,
) -> Result<ChangelistsState, AppError> {
    crate::transaction::with_metadata_access(git_dir, || {
        let mut state = load_changelists_unlocked(git_dir)?;
        if !state.lists.iter().any(|l| l.id == target_list_id) {
            return Err(AppError::new(ErrorCode::NotFound, "changelist not found"));
        }
        for path in paths {
            if let Some(existing) = state.assignments.iter_mut().find(|a| a.path == *path) {
                existing.list_id = target_list_id.to_string();
                existing.hunk_ranges.clear();
            } else {
                state.assignments.push(PathAssignment {
                    path: path.clone(),
                    list_id: target_list_id.to_string(),
                    hunk_ranges: Vec::new(),
                });
            }
        }
        save_changelists(git_dir, &state)?;
        Ok(state)
    })
}

/// Drop assignments for paths that no longer have local changes.
pub fn prune_missing(
    git_dir: &Path,
    present_paths: &[String],
) -> Result<ChangelistsState, AppError> {
    crate::transaction::with_metadata_access(git_dir, || {
        let mut state = load_changelists_unlocked(git_dir)?;
        let before = state.assignments.len();
        state
            .assignments
            .retain(|a| present_paths.iter().any(|p| p == &a.path));
        if state.assignments.len() != before {
            save_changelists(git_dir, &state)?;
        }
        Ok(state)
    })
}

pub fn active_list_id(state: &ChangelistsState) -> String {
    state
        .lists
        .iter()
        .find(|l| l.active)
        .map(|l| l.id.clone())
        .unwrap_or_else(|| "default".into())
}
