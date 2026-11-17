use gitx_core::{parse_wsl_unc_path, AppError, ErrorCode};
use std::path::{Component, Path, PathBuf};

/// Resolve a relative worktree path under `cwd`, rejecting traversal and absolute paths.
pub fn resolve_worktree_file(cwd: &Path, file_path: &str) -> Result<PathBuf, AppError> {
    if file_path.is_empty() || file_path.contains('\0') {
        return Err(AppError::new(ErrorCode::InvalidArgument, "empty file path"));
    }
    let rel = Path::new(file_path);
    if rel.is_absolute() {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "file path must be relative to the repository",
        ));
    }
    for component in rel.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            _ => {
                return Err(AppError::new(
                    ErrorCode::InvalidArgument,
                    "file path must stay inside the repository",
                ));
            }
        }
    }
    Ok(cwd.join(rel))
}

/// Resolve a path printed by Git in the context of the invocation's cwd.
/// WSL Git returns Linux paths; native filesystem consumers need UNC paths.
pub fn resolve_git_path(cwd: &Path, raw: &str) -> PathBuf {
    if let Some(info) = parse_wsl_unc_path(&cwd.to_string_lossy()) {
        let linux_path = if raw.starts_with('/') {
            raw.to_owned()
        } else {
            format!("{}/{raw}", info.linux_path.trim_end_matches('/'))
        };
        PathBuf::from(format!(
            r"\\wsl.localhost\{}{}",
            info.distro,
            linux_path.replace('/', "\\")
        ))
    } else {
        let path = PathBuf::from(raw);
        if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wsl_output_paths_keep_the_distro_and_linux_case() {
        let cwd = Path::new(r"\\?\UNC\WSL$\Ubuntu\home\User\Repo\subdir");
        for (raw, expected) in [
            ("/home/User/Repo", r"\\wsl.localhost\Ubuntu\home\User\Repo"),
            (
                "../.git",
                r"\\wsl.localhost\Ubuntu\home\User\Repo\subdir\..\.git",
            ),
            (
                "/home/User/main/.git/worktrees/Review",
                r"\\wsl.localhost\Ubuntu\home\User\main\.git\worktrees\Review",
            ),
            (
                "/home/User/main/.git",
                r"\\wsl.localhost\Ubuntu\home\User\main\.git",
            ),
        ] {
            assert_eq!(resolve_git_path(cwd, raw), PathBuf::from(expected));
        }
    }

    #[test]
    fn native_output_paths_still_resolve_from_the_invocation_directory() {
        let root = std::env::temp_dir();
        let cwd = root.join("repo/subdir");
        assert_eq!(resolve_git_path(&cwd, "../.git"), cwd.join("../.git"));
        assert_eq!(resolve_git_path(&cwd, &root.to_string_lossy()), root);
    }

    #[test]
    fn worktree_file_paths_reject_traversal_and_absolute_inputs() {
        let cwd = Path::new("/tmp/repo");
        assert_eq!(
            resolve_worktree_file(cwd, "src/a.txt").unwrap(),
            cwd.join("src/a.txt")
        );
        assert!(resolve_worktree_file(cwd, "").is_err());
        assert!(resolve_worktree_file(cwd, "../escape.txt").is_err());
        assert!(resolve_worktree_file(cwd, "/etc/passwd").is_err());
    }
}
