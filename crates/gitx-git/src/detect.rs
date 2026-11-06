use gitx_core::{AppError, ErrorCode, WslPathInfo};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// Minimum supported git version (major.minor.patch).
pub const MIN_GIT_VERSION: (u32, u32, u32) = (2, 31, 0);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDetectResult {
    pub path: String,
    pub version: String,
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub supported: bool,
}

/// Detect `\\wsl$\Distro\…` / `\\wsl.localhost\Distro\…` paths (#9 WSL).
pub fn parse_wsl_unc_path(path: &str) -> Option<WslPathInfo> {
    let normalized = path.replace('/', "\\");
    let rest = normalized
        .strip_prefix("\\\\wsl$\\")
        .or_else(|| normalized.strip_prefix("\\\\wsl.localhost\\"))?;
    let mut parts = rest.splitn(2, '\\');
    let distro = parts.next()?.to_string();
    if distro.is_empty() {
        return None;
    }
    let win_tail = parts.next().unwrap_or("");
    let linux_path = if win_tail.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", win_tail.replace('\\', "/"))
    };
    Some(WslPathInfo {
        suggested_git: format!("wsl.exe -d {distro} git"),
        distro,
        linux_path,
    })
}

/// Convert a Windows WSL UNC path using `wslpath` when available.
pub fn wsl_translate_path(distro: &str, windows_path: &str) -> Option<String> {
    let output = Command::new("wsl.exe")
        .args(["-d", distro, "wslpath", "-a", windows_path])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// Prefer WSL git when the workspace lives under a WSL UNC path.
pub fn resolve_git_bin_for_path(preferred: Option<&str>, workspace: Option<&Path>) -> String {
    if let Some(ws) = workspace {
        if let Some(info) = parse_wsl_unc_path(&ws.to_string_lossy()) {
            return format!("wsl.exe -d {} git", info.distro);
        }
    }
    preferred.unwrap_or("git").to_string()
}

pub fn detect_git(preferred: Option<&str>) -> Result<GitDetectResult, AppError> {
    let candidates: Vec<&str> = preferred.into_iter().chain(["git"]).collect();

    let mut last_err: Option<AppError> = None;
    for bin in candidates {
        match probe(bin) {
            Ok(result) => return Ok(result),
            Err(err) => last_err = Some(err),
        }
    }
    Err(last_err.unwrap_or_else(|| {
        AppError::new(ErrorCode::GitNotFound, "git executable not found on PATH")
            .with_recover(vec![gitx_core::RecoverAction::ShowDetails])
    }))
}

fn probe(bin: &str) -> Result<GitDetectResult, AppError> {
    let output = Command::new(bin)
        .args(["--version"])
        .output()
        .map_err(|e| {
            AppError::new(
                ErrorCode::GitNotFound,
                format!("failed to spawn `{bin}`: {e}"),
            )
        })?;

    if !output.status.success() {
        return Err(AppError::new(
            ErrorCode::GitNotFound,
            format!("`{bin} --version` exited non-zero"),
        ));
    }

    let version_line = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let (major, minor, patch) = parse_version(&version_line).ok_or_else(|| {
        AppError::new(
            ErrorCode::Internal,
            format!("unable to parse git version from: {version_line}"),
        )
    })?;

    let supported = (major, minor, patch) >= MIN_GIT_VERSION;
    let path = which_path(bin).unwrap_or_else(|| bin.to_string());

    let result = GitDetectResult {
        path,
        version: version_line,
        major,
        minor,
        patch,
        supported,
    };

    if !supported {
        return Err(AppError::new(
            ErrorCode::GitTooOld,
            format!(
                "git {}.{}.{} is older than required {}.{}.{}",
                result.major,
                result.minor,
                result.patch,
                MIN_GIT_VERSION.0,
                MIN_GIT_VERSION.1,
                MIN_GIT_VERSION.2
            ),
        )
        .with_command(format!("{bin} --version")));
    }

    Ok(result)
}

fn parse_version(line: &str) -> Option<(u32, u32, u32)> {
    // "git version 2.43.0" or "git version 2.43.0.windows.1"
    let rest = line.strip_prefix("git version ")?;
    let mut parts = rest.split(|c: char| !c.is_ascii_digit());
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    Some((major, minor, patch))
}

fn which_path(bin: &str) -> Option<String> {
    if bin.contains('/') || bin.contains('\\') {
        return Some(bin.to_string());
    }
    #[cfg(unix)]
    {
        Command::new("which")
            .arg(bin)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    }
    #[cfg(windows)]
    {
        Command::new("where")
            .arg(bin)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .next()
                    .map(|s| s.trim().to_string())
            })
    }
}
