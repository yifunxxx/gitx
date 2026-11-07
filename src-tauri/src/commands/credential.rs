//! Credential session for askpass / git credential helper (GIT-41).

use crate::state::AppState;
use gitx_core::{AppError, ErrorCode};
use gitx_git::{helper_bin, GitInvocation, OpKind};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSessionReq {
    pub path: Option<String>,
    pub protocol: Option<String>,
    pub host: Option<String>,
    pub username: String,
    pub password: String,
    /// When true, also `git credential approve` into the system helper.
    pub store_helper: bool,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSessionRes {
    pub askpass_file: String,
    pub helper_bin: String,
    pub stored_helper: bool,
}

/// Parse protocol/host/username hints from a remote URL or git auth error text.
pub fn parse_auth_target(url_or_err: &str) -> (Option<String>, Option<String>, Option<String>) {
    // Prefer an explicit URL inside quotes: Password for 'https://user@host/…'
    let candidate = extract_url_candidate(url_or_err).unwrap_or(url_or_err);
    if let Some(rest) = candidate
        .strip_prefix("https://")
        .or_else(|| candidate.strip_prefix("http://"))
    {
        let protocol = if candidate.starts_with("https://") {
            "https"
        } else {
            "http"
        };
        let (user_host, _) = rest.split_once('/').unwrap_or((rest, ""));
        if let Some((user, host)) = user_host.split_once('@') {
            // user may itself contain @ (email): take host after last @
            if user.contains('@') || host.contains('@') {
                if let Some(idx) = user_host.rfind('@') {
                    let u = &user_host[..idx];
                    let h = user_host[idx + 1..]
                        .split('/')
                        .next()
                        .unwrap_or("")
                        .split(':')
                        .next()
                        .unwrap_or("");
                    return (
                        Some(protocol.into()),
                        Some(h.trim_end_matches('\'').to_string()),
                        Some(u.to_string()),
                    );
                }
            }
            let host = host.split(':').next().unwrap_or(host);
            return (
                Some(protocol.into()),
                Some(host.trim_end_matches('\'').to_string()),
                Some(user.to_string()),
            );
        }
        let host = user_host.split(':').next().unwrap_or(user_host);
        return (
            Some(protocol.into()),
            Some(host.trim_end_matches('\'').to_string()),
            None,
        );
    }
    if let Some(rest) = candidate.strip_prefix("git@") {
        let host = rest.split(':').next().unwrap_or(rest);
        return (
            Some("ssh".into()),
            Some(host.trim_end_matches('\'').to_string()),
            None,
        );
    }
    if let Some(rest) = candidate.strip_prefix("ssh://") {
        let rest = rest.split('@').nth(1).unwrap_or(rest);
        let host = rest
            .split('/')
            .next()
            .unwrap_or(rest)
            .split(':')
            .next()
            .unwrap_or(rest);
        return (
            Some("ssh".into()),
            Some(host.trim_end_matches('\'').to_string()),
            None,
        );
    }
    (None, None, None)
}

fn extract_url_candidate(s: &str) -> Option<&str> {
    // ...'https://…' or "https://…"
    for quote in ['\'', '"'] {
        if let Some(start) = s.find(quote) {
            let after = &s[start + quote.len_utf8()..];
            if let Some(end) = after.find(quote) {
                let inner = &after[..end];
                if inner.contains("://") || inner.starts_with("git@") {
                    return Some(inner);
                }
            }
        }
    }
    // Bare URL in the string
    for prefix in ["https://", "http://", "ssh://", "git@"] {
        if let Some(idx) = s.find(prefix) {
            let rest = &s[idx..];
            let end = rest
                .find(|c: char| c.is_whitespace() || c == '\'' || c == '"')
                .unwrap_or(rest.len());
            return Some(&rest[..end]);
        }
    }
    None
}

#[tauri::command]
#[specta::specta]
pub async fn credential_session_set(
    state: State<'_, AppState>,
    req: CredentialSessionReq,
) -> Result<CredentialSessionRes, AppError> {
    let settings = state.settings.read().await;
    let use_helper = settings.git.use_credential_helper;
    drop(settings);

    // Honor Settings toggle for subsequent network git runs.
    // SAFETY: single-process desktop app; env used only as a bridge into GitRunner.
    unsafe {
        std::env::set_var(
            "GITX_USE_CREDENTIAL_HELPER",
            if use_helper { "1" } else { "0" },
        );
    }

    let dir = std::env::temp_dir().join("gitx");
    fs::create_dir_all(&dir).map_err(|e| {
        AppError::new(ErrorCode::FsError, format!("temp dir: {e}"))
    })?;
    let file = dir.join(format!("askpass-{}.txt", std::process::id()));

    // Escape nothing special — helper parses line prefixes; disallow newlines in values.
    let user = req.username.replace(['\n', '\r'], "");
    let pass = req.password.replace(['\n', '\r'], "");
    let body = format!("username={user}\npassword={pass}\n");
    write_secret_file(&file, body.as_bytes())?;

    let askpass_path = file.to_string_lossy().into_owned();
    unsafe {
        std::env::set_var("GITX_ASKPASS_FILE", &askpass_path);
    }

    let helper = helper_bin();
    let mut stored_helper = false;

    if req.store_helper && use_helper {
        let (mut protocol, mut host, _) = match req.url.as_deref() {
            Some(u) => parse_auth_target(u),
            None => (None, None, None),
        };
        if protocol.is_none() {
            protocol = req.protocol.clone();
        }
        if host.is_none() {
            host = req.host.clone();
        }
        if let (Some(protocol), Some(host)) = (protocol, host) {
            if let Some(repo) = req.path.as_deref() {
                stored_helper = credential_approve(
                    &state,
                    Path::new(repo),
                    &protocol,
                    &host,
                    &user,
                    &pass,
                )
                .await
                .is_ok();
            }
        }
    }

    Ok(CredentialSessionRes {
        askpass_file: askpass_path,
        helper_bin: helper,
        stored_helper,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn credential_session_clear() -> Result<(), AppError> {
    if let Ok(path) = std::env::var("GITX_ASKPASS_FILE") {
        let _ = fs::remove_file(path);
    }
    unsafe {
        std::env::remove_var("GITX_ASKPASS_FILE");
    }
    Ok(())
}

fn write_secret_file(path: &PathBuf, bytes: &[u8]) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("askpass file: {e}")))?;
        f.write_all(bytes)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("askpass write: {e}")))?;
    }
    #[cfg(not(unix))]
    {
        fs::write(path, bytes)
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("askpass file: {e}")))?;
    }
    Ok(())
}

async fn credential_approve(
    state: &AppState,
    cwd: &Path,
    protocol: &str,
    host: &str,
    username: &str,
    password: &str,
) -> Result<(), AppError> {
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let input = format!(
        "protocol={protocol}\nhost={host}\nusername={username}\npassword={password}\n\n"
    );
    let inv = GitInvocation::new(cwd, ["credential", "approve"])
        .kind(OpKind::Write)
        .stdin(input.into_bytes())
        .timeout(Some(std::time::Duration::from_secs(15)))
        .git_bin(git.git_bin.clone());
    git.run(inv, &cancel).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gitee_password_prompt() {
        let msg = "fatal: could not read Password for 'https://xsaf1207@163.com@gitee.com': terminal prompts disabled";
        let (proto, host, user) = parse_auth_target(msg);
        assert_eq!(proto.as_deref(), Some("https"));
        assert_eq!(host.as_deref(), Some("gitee.com"));
        assert_eq!(user.as_deref(), Some("xsaf1207@163.com"));
    }

    #[test]
    fn parses_plain_https_url() {
        let (proto, host, user) = parse_auth_target("https://github.com/org/repo.git");
        assert_eq!(proto.as_deref(), Some("https"));
        assert_eq!(host.as_deref(), Some("github.com"));
        assert!(user.is_none());
    }
}
