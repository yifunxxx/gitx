pub use gitx_core::parse_wsl_unc_path;
use gitx_core::{AppError, ErrorCode};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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

/// Convert a Windows WSL UNC path using `wslpath` when available.
pub fn wsl_translate_path(distro: &str, windows_path: &str) -> Option<String> {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["-d", distro, "wslpath", "-a", windows_path]);
    crate::process_win::hide_console_std(&mut cmd);
    let output = cmd.output().ok()?;
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

/// Merge machine/user PATH + common Git dirs into this process env.
/// WebView2 GUI apps often inherit a stripped PATH vs an interactive shell.
pub fn ensure_windows_git_path() {
    #[cfg(windows)]
    {
        augment_windows_path();
    }
}

/// Validate the exact draft executable. Only an empty draft requests discovery.
pub fn test_git_executable(path: &str) -> Result<GitDetectResult, AppError> {
    let path = path.trim();
    if path.is_empty() {
        detect_git(None)
    } else {
        ensure_windows_git_path();
        probe(path)
    }
}

pub fn detect_git(preferred: Option<&str>) -> Result<GitDetectResult, AppError> {
    ensure_windows_git_path();

    let mut candidates: Vec<String> = Vec::new();
    if let Some(p) = preferred {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            candidates.push(trimmed.to_string());
        }
    }
    candidates.push("git".to_string());
    candidates.push("git.exe".to_string());
    for extra in windows_git_candidates() {
        if !candidates.iter().any(|c| c.eq_ignore_ascii_case(&extra)) {
            candidates.push(extra);
        }
    }

    let mut last_err: Option<AppError> = None;
    for bin in &candidates {
        match probe(bin) {
            Ok(result) => return Ok(result),
            Err(err) => last_err = Some(err),
        }
    }
    Err(last_err.unwrap_or_else(|| {
        AppError::new(
            ErrorCode::GitNotFound,
            "git executable not found (install Git for Windows, or set Settings → Git executable to git.exe)",
        )
        .with_recover(vec![gitx_core::RecoverAction::ShowDetails])
    }))
}

#[cfg(windows)]
fn augment_windows_path() {
    use std::collections::BTreeSet;
    use std::ffi::OsString;

    let mut entries: Vec<String> = Vec::new();
    let mut seen = BTreeSet::new();
    let mut push_dir = |raw: String| {
        let trimmed = raw.trim().trim_matches('"').to_string();
        if trimmed.is_empty() {
            return;
        }
        let key = trimmed.to_ascii_lowercase();
        if !seen.insert(key) {
            return;
        }
        entries.push(trimmed);
    };

    // Prefer known Git install dirs first so `Command::new("git")` can resolve.
    for dir in windows_git_dir_candidates() {
        if Path::new(&dir).is_dir() {
            push_dir(dir);
        }
    }

    if let Some(reg) = windows_registry_path_value() {
        for part in reg.split(';') {
            push_dir(expand_windows_env(part));
        }
    }

    if let Ok(existing) = std::env::var("PATH") {
        for part in existing.split(';') {
            push_dir(part.to_string());
        }
    }

    let merged = entries.join(";");
    std::env::set_var("PATH", OsString::from(merged));
}

#[cfg(windows)]
fn windows_registry_path_value() -> Option<String> {
    let machine =
        reg_query_path(r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment");
    let user = reg_query_path(r"HKCU\Environment");
    match (machine, user) {
        (Some(m), Some(u)) => Some(format!("{m};{u}")),
        (Some(m), None) => Some(m),
        (None, Some(u)) => Some(u),
        (None, None) => None,
    }
}

#[cfg(windows)]
fn reg_query_path(key: &str) -> Option<String> {
    let mut cmd = Command::new("reg");
    cmd.args(["query", key, "/v", "Path"]);
    crate::process_win::hide_console_std(&mut cmd);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let line = line.trim();
        // REG_SZ / REG_EXPAND_SZ value follows the type token.
        let Some(rest) = line
            .split_once("REG_EXPAND_SZ")
            .or_else(|| line.split_once("REG_SZ"))
            .map(|(_, v)| v.trim())
        else {
            continue;
        };
        if !rest.is_empty() {
            return Some(expand_windows_env(rest));
        }
    }
    None
}

#[cfg(windows)]
fn expand_windows_env(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let Some(end) = input[i + 1..].find('%') {
                let name = &input[i + 1..i + 1 + end];
                if !name.is_empty() {
                    if let Ok(val) = std::env::var(name) {
                        out.push_str(&val);
                        i += name.len() + 2;
                        continue;
                    }
                }
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

#[cfg(windows)]
fn windows_git_dir_candidates() -> Vec<String> {
    let mut dirs = Vec::new();
    let mut push = |p: String| {
        if !dirs.iter().any(|d: &String| d.eq_ignore_ascii_case(&p)) {
            dirs.push(p);
        }
    };
    if let Ok(pf) = std::env::var("ProgramFiles") {
        push(format!(r"{pf}\Git\cmd"));
        push(format!(r"{pf}\Git\bin"));
        push(format!(r"{pf}\Git\mingw64\bin"));
    }
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        push(format!(r"{pf86}\Git\cmd"));
        push(format!(r"{pf86}\Git\bin"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        push(format!(r"{local}\Programs\Git\cmd"));
        push(format!(r"{local}\Programs\Git\bin"));
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        push(format!(r"{home}\scoop\apps\git\current\cmd"));
        push(format!(r"{home}\scoop\shims"));
        push(format!(r"{home}\AppData\Local\Programs\Git\cmd"));
    }
    for p in [
        r"C:\Program Files\Git\cmd",
        r"C:\Program Files\Git\bin",
        r"C:\Program Files\Git\mingw64\bin",
        r"C:\Program Files (x86)\Git\cmd",
        r"C:\Program Files (x86)\Git\bin",
    ] {
        push(p.to_string());
    }
    dirs
}

/// Common Git for Windows install locations when PATH is incomplete.
fn windows_git_candidates() -> Vec<String> {
    #[cfg(windows)]
    {
        let mut out = Vec::new();
        let mut push = |p: String| {
            // Accept existing files; also keep likely paths so spawn errors stay informative.
            if Path::new(&p).is_file() {
                out.push(p);
            }
        };
        for dir in windows_git_dir_candidates() {
            push(format!(r"{dir}\git.exe"));
        }
        // Chocolatey shim / portable leftovers.
        if let Ok(home) = std::env::var("ProgramData") {
            push(format!(r"{home}\chocolatey\bin\git.exe"));
        }
        out
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

fn probe(bin: &str) -> Result<GitDetectResult, AppError> {
    let mut cmd = Command::new(bin);
    cmd.args(["--version"]);
    crate::process_win::hide_console_std(&mut cmd);
    let output = cmd.output().map_err(|e| {
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
    if Path::new(bin).is_file() {
        return PathBuf::from(bin)
            .canonicalize()
            .ok()
            .map(|p| {
                let s = p.to_string_lossy().into_owned();
                // Windows canonicalize may prefix `\\?\`; strip for display / Command.
                s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
            })
            .or_else(|| Some(bin.to_string()));
    }
    if bin.contains('/') || bin.contains('\\') {
        return Some(bin.to_string());
    }
    #[cfg(unix)]
    {
        let mut cmd = Command::new("which");
        cmd.arg(bin);
        cmd.output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    }
    #[cfg(windows)]
    {
        let mut cmd = Command::new("where");
        cmd.arg(bin);
        crate::process_win::hide_console_std(&mut cmd);
        cmd.output()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_windows_suffix() {
        assert_eq!(
            parse_version("git version 2.43.0.windows.1"),
            Some((2, 43, 0))
        );
    }

    #[test]
    fn parse_version_plain() {
        assert_eq!(parse_version("git version 2.31.0"), Some((2, 31, 0)));
    }
}
