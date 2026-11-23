use crate::state::AppState;
use futures_util::StreamExt;
use gitx_core::{AppError, AppSettings, ErrorCode};
use gitx_git::detect_git;
use gitx_meta::{load_app_settings, save_app_settings};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;

const GITHUB_RELEASES_LATEST: &str = "https://api.github.com/repos/yifunxxx/gitx/releases/latest";
const ALLOWED_DOWNLOAD_PREFIX: &str = "https://github.com/yifunxxx/gitx/releases/download/";

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
    /// GitHub Release body (markdown / plain text). Empty when absent.
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppDownloadUpdateReq {
    pub url: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppDownloadUpdateRes {
    pub path: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInstallUpdateReq {
    pub path: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
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
        notes: release.body.unwrap_or_default(),
    })
}

fn validate_download_url(url: &str) -> Result<(), AppError> {
    if url.starts_with(ALLOWED_DOWNLOAD_PREFIX) {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::InvalidArgument,
            "update download URL must be a gitx GitHub Release asset",
        ))
    }
}

fn installer_file_name(url: &str, version: &str) -> String {
    Path::new(url)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string())
        .unwrap_or_else(|| format!("gitx_{version}_x64-setup.exe"))
}

#[tauri::command]
#[specta::specta]
pub async fn app_download_update(
    app: AppHandle,
    req: AppDownloadUpdateReq,
) -> Result<AppDownloadUpdateRes, AppError> {
    validate_download_url(&req.url)?;
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .user_agent(format!("gitx/{current_version}"))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("http client: {e}")))?;
    let response = client
        .get(&req.url)
        .send()
        .await
        .map_err(|e| AppError::new(ErrorCode::NetworkError, format!("download failed: {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            ErrorCode::NetworkError,
            format!("download returned HTTP {}", response.status()),
        ));
    }
    let total = response.content_length();
    let file_name = installer_file_name(&req.url, &req.version);
    let dir = std::env::temp_dir().join("gitx-updates");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("create update dir: {e}")))?;
    let path = dir.join(&file_name);
    let partial = dir.join(format!("{file_name}.partial"));
    let mut file = tokio::fs::File::create(&partial)
        .await
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("create update file: {e}")))?;
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let _ = app.emit(
        "update://progress",
        serde_json::json!({
            "version": req.version,
            "downloaded": 0u64,
            "total": total,
        }),
    );
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|e| AppError::new(ErrorCode::NetworkError, format!("download stream: {e}")))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("write update file: {e}")))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        let _ = app.emit(
            "update://progress",
            serde_json::json!({
                "version": req.version,
                "downloaded": downloaded,
                "total": total,
            }),
        );
    }
    file.flush()
        .await
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("flush update file: {e}")))?;
    drop(file);
    tokio::fs::rename(&partial, &path)
        .await
        .map_err(|e| AppError::new(ErrorCode::FsError, format!("finalize update file: {e}")))?;
    Ok(AppDownloadUpdateRes {
        path: path.to_string_lossy().into_owned(),
        version: req.version,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn app_install_update(app: AppHandle, req: AppInstallUpdateReq) -> Result<(), AppError> {
    let path = PathBuf::from(&req.path);
    if !path.is_file() {
        return Err(AppError::new(
            ErrorCode::FsError,
            format!("installer not found: {}", path.display()),
        ));
    }
    #[cfg(windows)]
    {
        std::process::Command::new(&path)
            .spawn()
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("launch installer: {e}")))?;
        // Exit so the installer can replace running binaries.
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err(AppError::new(
            ErrorCode::Internal,
            "in-app install is only supported on Windows",
        ))
    }
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
    persist_preferences(&state.settings_path, &state.settings, &state.git, settings).await
}

async fn persist_preferences(
    path: &Path,
    current: &tokio::sync::RwLock<AppSettings>,
    git: &tokio::sync::RwLock<gitx_git::GitRunner>,
    mut settings: AppSettings,
) -> Result<AppSettings, AppError> {
    // Other commands may hold a Git read guard while reading settings. Keep
    // that lock order, and do not persist a draft while still waiting for Git.
    let mut git = git.write().await;
    let mut current = current.write().await;
    // Opening/removing a workspace owns this list. A preferences dialog can
    // have an older copy even when its editable fields are still valid.
    settings.recent_workspaces = current.recent_workspaces.clone();
    save_app_settings(path, &settings)?;
    match settings
        .git_executable
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(bin) => {
            *git = gitx_git::GitRunner::new(bin.to_string());
        }
        None => {
            // Empty = auto-detect; rebind runner to whatever is found now.
            if let Ok(detected) = detect_git(None) {
                *git = gitx_git::GitRunner::new(detected.path);
            } else {
                *git = gitx_git::GitRunner::new("git");
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
    *current = settings.clone();
    Ok(settings)
}

#[tauri::command]
#[specta::specta]
pub async fn settings_reload(state: State<'_, AppState>) -> Result<AppSettings, AppError> {
    reload_preferences(&state.settings_path, &state.settings).await
}

async fn reload_preferences(
    path: &Path,
    current: &tokio::sync::RwLock<AppSettings>,
) -> Result<AppSettings, AppError> {
    // Read disk under the same guard used by saves and recent-list updates;
    // a reload must not publish an earlier disk snapshot after a newer write.
    let mut current = current.write().await;
    let settings = load_app_settings(path)?;
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
    *current = settings.clone();
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::Future;
    use std::task::Poll;
    use tokio::sync::RwLock;

    struct SettingsFixture {
        _dir: tempfile::TempDir,
        path: PathBuf,
        current: RwLock<AppSettings>,
        git: RwLock<gitx_git::GitRunner>,
    }

    impl SettingsFixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("settings.json");
            let initial = AppSettings {
                git_executable: Some("git".into()),
                recent_workspaces: vec!["repo-old".into(), "worktree-removed".into()],
                ..AppSettings::default()
            };
            save_app_settings(&path, &initial).unwrap();
            Self {
                _dir: dir,
                path,
                current: RwLock::new(initial),
                git: RwLock::new(gitx_git::GitRunner::new("git")),
            }
        }

        async fn save(&self, next: AppSettings) -> AppSettings {
            persist_preferences(&self.path, &self.current, &self.git, next)
                .await
                .unwrap()
        }

        async fn assert_published(&self, expected: &AppSettings) {
            let expected = serde_json::to_value(expected).unwrap();
            assert_eq!(
                serde_json::to_value(self.current.read().await.clone()).unwrap(),
                expected
            );
            assert_eq!(
                serde_json::to_value(load_app_settings(&self.path).unwrap()).unwrap(),
                expected
            );
        }
    }

    #[tokio::test]
    async fn preferences_preserve_recent_projects_opened_after_the_draft() {
        let fixture = SettingsFixture::new();
        let mut draft = fixture.current.read().await.clone();
        {
            let mut current = fixture.current.write().await;
            current.recent_workspaces.insert(0, "repo-new".into());
            save_app_settings(&fixture.path, &current).unwrap();
        }
        draft.locale = "zh-CN".into();
        let saved = fixture.save(draft).await;
        assert_eq!(
            saved.recent_workspaces,
            ["repo-new", "repo-old", "worktree-removed"]
        );
        assert_eq!(saved.locale, "zh-CN");
        fixture.assert_published(&saved).await;
    }

    #[tokio::test]
    async fn preferences_do_not_resurrect_removed_worktrees_from_a_stale_draft() {
        let fixture = SettingsFixture::new();
        let mut draft = fixture.current.read().await.clone();
        {
            let mut current = fixture.current.write().await;
            current
                .recent_workspaces
                .retain(|path| path != "worktree-removed");
            save_app_settings(&fixture.path, &current).unwrap();
        }
        draft.show_ignored_files = true;
        let saved = fixture.save(draft).await;
        assert_eq!(saved.recent_workspaces, ["repo-old"]);
        assert!(saved.show_ignored_files);
        fixture.assert_published(&saved).await;
    }

    #[tokio::test]
    async fn preferences_do_not_accept_client_replacement_of_backend_recent_order() {
        let fixture = SettingsFixture::new();
        let initial = fixture.current.read().await.clone();
        for paths in [vec![], vec!["unrelated-client-path".into()]] {
            let mut draft = initial.clone();
            draft.recent_workspaces = paths;
            draft.staging_mode = true;
            let saved = fixture.save(draft).await;
            assert_eq!(saved.recent_workspaces, initial.recent_workspaces);
            assert!(saved.staging_mode);
            fixture.assert_published(&saved).await;
        }
    }

    #[tokio::test]
    async fn preferences_waiting_for_git_do_not_publish_disk_early_or_lose_new_recents() {
        let fixture = SettingsFixture::new();
        let initial = fixture.current.read().await.clone();
        let mut draft = initial.clone();
        draft.locale = "zh-CN".into();
        let git_reader = fixture.git.read().await;
        let save = persist_preferences(&fixture.path, &fixture.current, &fixture.git, draft);
        tokio::pin!(save);
        std::future::poll_fn(|cx| {
            assert!(matches!(save.as_mut().poll(cx), Poll::Pending));
            Poll::Ready(())
        })
        .await;
        fixture.assert_published(&initial).await;
        {
            let mut current = fixture.current.write().await;
            current
                .recent_workspaces
                .insert(0, "opened-during-save".into());
            save_app_settings(&fixture.path, &current).unwrap();
        }
        drop(git_reader);
        let saved = save.await.unwrap();
        assert_eq!(saved.recent_workspaces[0], "opened-during-save");
        assert_eq!(saved.locale, "zh-CN");
        fixture.assert_published(&saved).await;
    }

    #[tokio::test]
    async fn preferences_failed_persistence_keeps_committed_memory_and_disk() {
        let fixture = SettingsFixture::new();
        let initial = fixture.current.read().await.clone();
        let mut draft = initial.clone();
        draft.locale = "zh-CN".into();
        let blocked = fixture._dir.path().join("blocked.json");
        std::fs::create_dir(&blocked).unwrap();
        assert!(
            persist_preferences(&blocked, &fixture.current, &fixture.git, draft)
                .await
                .is_err()
        );
        fixture.assert_published(&initial).await;
        assert!(blocked.is_dir());
    }

    #[tokio::test]
    async fn preferences_reload_reads_after_an_in_progress_recent_update() {
        let fixture = SettingsFixture::new();
        let mut writer = fixture.current.write().await;
        let reload = reload_preferences(&fixture.path, &fixture.current);
        tokio::pin!(reload);
        std::future::poll_fn(|cx| {
            assert!(matches!(reload.as_mut().poll(cx), Poll::Pending));
            Poll::Ready(())
        })
        .await;
        writer
            .recent_workspaces
            .insert(0, "opened-before-reload".into());
        save_app_settings(&fixture.path, &writer).unwrap();
        drop(writer);
        let loaded = reload.await.unwrap();
        assert_eq!(loaded.recent_workspaces[0], "opened-before-reload");
        fixture.assert_published(&loaded).await;
    }

    #[tokio::test]
    async fn preferences_failed_reload_keeps_the_last_memory_snapshot() {
        let fixture = SettingsFixture::new();
        let initial = fixture.current.read().await.clone();
        std::fs::write(&fixture.path, b"invalid settings").unwrap();
        assert!(reload_preferences(&fixture.path, &fixture.current)
            .await
            .is_err());
        assert_eq!(
            serde_json::to_value(fixture.current.read().await.clone()).unwrap(),
            serde_json::to_value(initial).unwrap()
        );
        assert_eq!(std::fs::read(&fixture.path).unwrap(), b"invalid settings");
    }

    #[test]
    fn semver_compare_ignores_v_prefix() {
        assert!(is_newer("0.1.32", "0.1.31"));
        assert!(!is_newer("0.1.31", "0.1.31"));
        assert!(!is_newer("0.1.30", "0.1.31"));
        assert!(is_newer("v0.2.0", "0.1.99"));
    }

    #[test]
    fn download_url_must_be_gitx_release_asset() {
        assert!(validate_download_url(
            "https://github.com/yifunxxx/gitx/releases/download/v0.1.32/gitx_0.1.32_x64-setup.exe"
        )
        .is_ok());
        assert!(validate_download_url("https://evil.example/setup.exe").is_err());
    }

    #[test]
    fn installer_name_falls_back_when_url_has_no_file() {
        assert_eq!(
            installer_file_name(
                "https://github.com/yifunxxx/gitx/releases/download/v0.1.32/gitx_0.1.32_x64-setup.exe",
                "0.1.32"
            ),
            "gitx_0.1.32_x64-setup.exe"
        );
    }
}
