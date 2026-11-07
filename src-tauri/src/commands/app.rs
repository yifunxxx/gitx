use crate::state::AppState;
use gitx_core::{AppError, AppSettings};
use gitx_git::detect_git;
use gitx_meta::{load_app_settings, save_app_settings};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitDetectDto {
    pub path: String,
    pub version: String,
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub supported: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn app_info() -> Result<AppInfo, AppError> {
    Ok(AppInfo {
        name: "gitx".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn git_detect(state: State<'_, AppState>) -> Result<GitDetectDto, AppError> {
    let preferred = {
        let settings = state.settings.read().await;
        settings.git_executable.clone()
    };
    let result = detect_git(preferred.as_deref())?;
    // Persist discovered absolute path so later ops don't rely on a stripped GUI PATH.
    if preferred.as_deref().map(str::trim).unwrap_or("").is_empty() {
        let mut git = state.git.write().await;
        *git = gitx_git::GitRunner::new(result.path.clone());
    }
    Ok(GitDetectDto {
        path: result.path,
        version: result.version,
        major: result.major,
        minor: result.minor,
        patch: result.patch,
        supported: result.supported,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn git_test_executable(
    state: State<'_, AppState>,
    path: String,
) -> Result<GitDetectDto, AppError> {
    let preferred = path.trim();
    let preferred = if preferred.is_empty() {
        None
    } else {
        Some(preferred)
    };
    let result = detect_git(preferred)?;
    // Testing an explicit path should also rebind the runner when it succeeds.
    if let Some(p) = preferred {
        let mut git = state.git.write().await;
        *git = gitx_git::GitRunner::new(p.to_string());
    } else {
        let mut git = state.git.write().await;
        *git = gitx_git::GitRunner::new(result.path.clone());
    }
    Ok(GitDetectDto {
        path: result.path,
        version: result.version,
        major: result.major,
        minor: result.minor,
        patch: result.patch,
        supported: result.supported,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn settings_get(state: State<'_, AppState>) -> Result<AppSettings, AppError> {
    Ok(state.settings.read().await.clone())
}

#[tauri::command]
#[specta::specta]
pub async fn settings_set(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, AppError> {
    save_app_settings(&state.settings_path, &settings)?;
    match settings
        .git_executable
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(bin) => {
            *state.git.write().await = gitx_git::GitRunner::new(bin.to_string());
        }
        None => {
            // Empty = auto-detect; rebind runner to whatever is found now.
            if let Ok(detected) = detect_git(None) {
                *state.git.write().await = gitx_git::GitRunner::new(detected.path);
            } else {
                *state.git.write().await = gitx_git::GitRunner::new("git");
            }
        }
    }
    // SAFETY: single-process desktop app; bridges Settings into GitRunner.
    unsafe {
        std::env::set_var(
            "GITX_USE_CREDENTIAL_HELPER",
            if settings.git.use_credential_helper {
                "1"
            } else {
                "0"
            },
        );
    }
    *state.settings.write().await = settings.clone();
    Ok(settings)
}

#[tauri::command]
#[specta::specta]
pub async fn settings_reload(state: State<'_, AppState>) -> Result<AppSettings, AppError> {
    let settings = load_app_settings(&state.settings_path)?;
    unsafe {
        std::env::set_var(
            "GITX_USE_CREDENTIAL_HELPER",
            if settings.git.use_credential_helper {
                "1"
            } else {
                "0"
            },
        );
    }
    *state.settings.write().await = settings.clone();
    Ok(settings)
}

#[tauri::command]
#[specta::specta]
pub async fn log_frontend(level: String, message: String) -> Result<(), AppError> {
    match level.as_str() {
        "error" => tracing::error!(target: "frontend", "{message}"),
        "warn" => tracing::warn!(target: "frontend", "{message}"),
        "debug" => tracing::debug!(target: "frontend", "{message}"),
        _ => tracing::info!(target: "frontend", "{message}"),
    }
    Ok(())
}
