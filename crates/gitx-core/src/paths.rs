use crate::WslPathInfo;

/// Recognize both WSL UNC aliases, including Windows verbatim UNC paths.
/// Only the server/share are Windows names; the Linux tail is case-sensitive.
pub fn parse_wsl_unc_path(path: &str) -> Option<WslPathInfo> {
    let path = without_verbatim_prefix(path);
    let rest = path.strip_prefix("//")?;
    let (server, rest) = rest.split_once('/')?;
    if !server.eq_ignore_ascii_case("wsl$") && !server.eq_ignore_ascii_case("wsl.localhost") {
        return None;
    }
    let (distro, tail) = rest.split_once('/').unwrap_or((rest, ""));
    if distro.is_empty() || matches!(distro, "." | "..") {
        return None;
    }
    Some(WslPathInfo {
        distro: distro.to_owned(),
        linux_path: format!("/{tail}"),
        suggested_git: format!("wsl.exe -d {distro} git"),
    })
}

fn without_verbatim_prefix(path: &str) -> String {
    let path = path.replace('\\', "/");
    if path
        .get(..8)
        .is_some_and(|s| s.eq_ignore_ascii_case("//?/UNC/"))
    {
        format!("//{}", &path[8..])
    } else {
        path.strip_prefix("//?/").unwrap_or(&path).to_owned()
    }
}

/// A host path comparison key that never probes disk or a network share.
/// On Windows, unify UNC aliases while preserving case in WSL Linux paths.
pub fn host_path_key(path: &str) -> String {
    #[cfg(windows)]
    let path = if let Some(info) = parse_wsl_unc_path(path) {
        format!(
            "//wsl.localhost/{}{}",
            info.distro.to_ascii_lowercase(),
            info.linux_path
        )
    } else {
        without_verbatim_prefix(path).to_ascii_lowercase()
    };
    #[cfg(not(windows))]
    let path = path.to_owned();
    let is_drive_root = path.len() == 3 && path.as_bytes()[1] == b':' && path.ends_with('/');
    if path == "/" || is_drive_root {
        path
    } else {
        path.trim_end_matches('/').to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wsl_aliases_and_verbatim_paths_preserve_linux_case() {
        for path in [
            r"\\wsl$\Ubuntu\home\User\Repo",
            "//WSL.LOCALHOST/Ubuntu/home/User/Repo",
            r"\\?\UNC\wsl.localhost\Ubuntu\home\User\Repo",
            r"\\?\unc\WSL$\Ubuntu\home\User\Repo",
        ] {
            let info = parse_wsl_unc_path(path).unwrap();
            assert_eq!(info.distro, "Ubuntu");
            assert_eq!(info.linux_path, "/home/User/Repo");
        }
        assert_eq!(
            parse_wsl_unc_path(r"\\wsl$\Ubuntu").unwrap().linux_path,
            "/"
        );
        for path in [
            r"C:\repo",
            "/home/repo",
            r"\\server\share\repo",
            r"\\wsl$\",
            r"\\wsl$\..\repo",
        ] {
            assert!(parse_wsl_unc_path(path).is_none(), "{path}");
        }
    }

    #[test]
    #[cfg(windows)]
    fn windows_keys_preserve_roots_and_wsl_case() {
        assert_eq!(host_path_key(r"\\?\C:\Repo\"), host_path_key("c:/repo"));
        assert_eq!(
            host_path_key(r"\\?\UNC\Server\Share\Repo"),
            host_path_key(r"\\server\share\repo")
        );
        assert_eq!(
            host_path_key(r"\\wsl$\Ubuntu\home\Repo"),
            host_path_key(r"\\?\UNC\WSL.LOCALHOST\ubuntu\home\Repo")
        );
        assert_ne!(
            host_path_key(r"\\wsl$\Ubuntu\home\Repo"),
            host_path_key(r"\\wsl$\Ubuntu\home\repo")
        );
        assert_eq!(host_path_key("C:/"), "c:/");
        assert_eq!(host_path_key("/"), "/");
    }
}
