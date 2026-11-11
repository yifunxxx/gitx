use crate::state::AppState;
use gitx_core::{AppError, AppSettings, ErrorCode};
use gitx_git::detect_git;
use gitx_meta::{load_app_settings, save_app_settings};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

const GITHUB_RELEASES_LATEST: &str = "https://api.github.com/repos/yifunxxx/gitx/releases/latest";

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub newer: bool,
    pub release_url: String,
    pub nsis_url: Option<String>,
    pub msi_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
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

fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let trimmed = raw.trim().trim_start_matches('v');
    let mut parts = trimmed.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts
        .next()
        .unwrap_or("0")
        .split(|c: char| !c.is_ascii_digit())
        .next()?
        .parse()
        .ok()?;
    Some((major, minor, patch))
}

fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_semver(latest), parse_semver(current)) {
        (Some(l), Some(c)) => l > c,
        _ => latest.trim_start_matches('v') != current.trim_start_matches('v'),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app_check_for_updates() -> Result<AppUpdateInfo, AppError> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .user_agent(format!("gitx/{current_version}"))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("http client: {e}")))?;
    let response = client
        .get(GITHUB_RELEASES_LATEST)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| AppError::new(ErrorCode::NetworkError, format!("update check failed: {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            ErrorCode::NetworkError,
            format!("GitHub Releases returned HTTP {}", response.status()),
        ));
    }
    let release: GithubRelease = response.json().await.map_err(|e| {
        AppError::new(
            ErrorCode::NetworkError,
            format!("invalid release payload: {e}"),
        )
    })?;
    let latest_version = release.tag_name.trim_start_matches('v').to_string();
    let mut nsis_url = None;
    let mut msi_url = None;
    for asset in release.assets {
        let name = asset.name.to_ascii_lowercase();
        if name.ends_with("-setup.exe") {
            nsis_url = Some(asset.browser_download_url);
        } else if name.ends_with(".msi") {
            msi_url = Some(asset.browser_download_url);
        }
    }
    Ok(AppUpdateInfo {
        newer: is_newer(&latest_version, &current_version),
        current_version,
        latest_version,
        release_url: release.html_url,
        nsis_url,
        msi_url,
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
pub async fn git_test_executable(path: String) -> Result<GitDetectDto, AppError> {
    let result = gitx_git::test_git_executable(&path)?;
    // Testing a draft must not change the runner; settings_set applies the choice.
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
