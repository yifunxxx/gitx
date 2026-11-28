use gitx_core::{parse_wsl_unc_path, AppError, ErrorCode};
use std::path::{Component, Path, PathBuf};

fn git_path_text(output: &[u8]) -> Result<&str, AppError> {
    let text = std::str::from_utf8(output)
        .map_err(|_| AppError::new(ErrorCode::FsError, "Git repository path is not UTF-8"))?;
    // Git writes an LF record terminator. Whitespace before it belongs to the
    // path (including a trailing newline in single-path output on Unix).
    let text = text.strip_suffix('\n').unwrap_or(text);
    if text.is_empty() || text.contains('\0') {
        return Err(AppError::new(
            ErrorCode::GitCommandFailed,
            "Git returned an invalid repository path",
        ));
    }
    Ok(text)
}

pub(crate) fn parse_git_path_output(cwd: &Path, output: &[u8]) -> Result<PathBuf, AppError> {
    Ok(resolve_git_path(cwd, git_path_text(output)?))
}

/// Paths returned by the four-field workspace rev-parse probe.
pub struct RepositoryProbe {
    pub inside_worktree: bool,
    pub toplevel: PathBuf,
    pub git_dir: PathBuf,
    pub common_dir: PathBuf,
}

/// Shared by opening a workspace and discovering nested repositories so both
/// use the same exact paths. Ambiguous/missing records fail before filesystem use.
pub fn parse_repository_probe(cwd: &Path, output: &[u8]) -> Result<RepositoryProbe, AppError> {
    let fields: Vec<_> = git_path_text(output)?.split('\n').collect();
    if fields.len() != 4
        || !matches!(fields[0], "true" | "false")
        || fields[1..].iter().any(|field| field.is_empty())
    {
        return Err(AppError::new(
            ErrorCode::GitCommandFailed,
            "Git returned an invalid repository path probe",
        ));
    }
    let canonical_path = |raw: &str| {
        let path = resolve_git_path(cwd, raw);
        path.canonicalize().unwrap_or(path)
    };
    Ok(RepositoryProbe {
        inside_worktree: fields[0] == "true",
        toplevel: resolve_git_path(cwd, fields[1]),
        git_dir: canonical_path(fields[2]),
        common_dir: canonical_path(fields[3]),
    })
}

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
    fn git_path_output_preserves_whitespace_and_only_removes_one_terminator() {
        let cwd = std::env::temp_dir();
        for raw in [
            " leading",
            "trailing ",
            "metadata\u{3000}",
            "line\n",
            "carriage\r",
        ] {
            let output = format!("{raw}\n");
            assert_eq!(
                parse_git_path_output(&cwd, output.as_bytes()).unwrap(),
                cwd.join(raw)
            );
        }
        assert_eq!(
            parse_git_path_output(&cwd, b".git").unwrap(),
            cwd.join(".git")
        );
    }

    #[test]
    fn git_directory_output_translates_wsl_paths() {
        let cwd = Path::new(r"\\wsl$\Ubuntu\home\User\Repo");
        assert_eq!(
            parse_git_path_output(cwd, b"/home/User/main/.git\n").unwrap(),
            PathBuf::from(r"\\wsl.localhost\Ubuntu\home\User\main\.git")
        );
        assert_eq!(
            parse_git_path_output(cwd, b"../metadata \n").unwrap(),
            PathBuf::from("\\\\wsl.localhost\\Ubuntu\\home\\User\\Repo\\..\\metadata ")
        );
    }

    #[test]
    fn invalid_directory_output_does_not_fall_back_to_the_worktree() {
        let cwd = std::env::temp_dir();
        for raw in [b"".as_slice(), b"\n", b"bad\0path\n", b"bad\xffpath\n"] {
            assert!(parse_git_path_output(&cwd, raw).is_err());
        }
    }

    #[test]
    fn repository_probe_preserves_whitespace() {
        let fixture = tempfile::tempdir().unwrap();
        let cwd = fixture.path();
        let probe =
            parse_repository_probe(cwd, "true\nrepo\u{3000}\nmetadata \nmetadata \n".as_bytes())
                .unwrap();
        assert!(probe.inside_worktree);
        assert_eq!(probe.toplevel, cwd.join("repo\u{3000}"));
        assert_eq!(probe.git_dir, cwd.join("metadata "));
        assert_eq!(probe.git_dir, probe.common_dir);
    }

    #[test]
    fn repository_probe_rejects_missing_or_ambiguous_records() {
        let cwd = std::env::temp_dir();
        for raw in [
            "true\nrepo\n.git\n",
            "true\nrepo\n.git\n\n",
            "true\nrepo\nsplit\n.git\n.git\n",
            "maybe\nrepo\n.git\n.git\n",
        ] {
            assert!(
                parse_repository_probe(&cwd, raw.as_bytes()).is_err(),
                "{raw:?}"
            );
        }
    }

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
