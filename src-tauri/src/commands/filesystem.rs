use crate::state::AppState;
use gitx_core::{AppError, ErrorCode};
use gitx_git::{GitInvocation, GitRunner};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashSet;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use tauri::State;
use tokio_util::sync::CancellationToken;

const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsReadDirReq {
    pub folder_path: String,
    pub dir: String,
    pub show_ignored: bool,
    pub show_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsReadFileReq {
    pub folder_path: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteFileReq {
    pub folder_path: String,
    pub file_path: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum FsEntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub kind: FsEntryKind,
}

fn fs_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::FsError, error.to_string())
}

/// Resolve only existing workspace entries. CRUD uses separate commands later.
/// Canonical containment also rejects links/junctions that escape the workspace.
fn resolve_entry(folder: &str, relative: &str, allow_root: bool) -> Result<PathBuf, AppError> {
    if !Path::new(folder).is_absolute()
        || (!allow_root && relative.is_empty())
        || relative.contains(['\0', '\\', ':'])
        || Path::new(relative)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "path must be relative to the workspace",
        ));
    }
    let root = Path::new(folder).canonicalize().map_err(fs_error)?;
    if !root.is_dir() {
        return Err(fs_error("workspace root is not a directory"));
    }
    let target = root.join(relative).canonicalize().map_err(fs_error)?;
    if !target.starts_with(&root) {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "path must stay inside the workspace",
        ));
    }
    Ok(target)
}

fn hidden(name: &str, metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        name.starts_with('.') || metadata.file_attributes() & 0x2 != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        name.starts_with('.')
    }
}

pub(super) fn read_dir_entries(req: &FsReadDirReq) -> Result<(PathBuf, Vec<FsEntry>), AppError> {
    let directory = resolve_entry(&req.folder_path, &req.dir, true)?;
    let root = Path::new(&req.folder_path)
        .canonicalize()
        .map_err(fs_error)?;
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&directory).map_err(fs_error)? {
        let entry = entry.map_err(fs_error)?;
        // The IPC contract carries UTF-8 paths; never return a lossy alias.
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let kind = entry.file_type().map_err(fs_error)?;
        let metadata = if kind.is_symlink() {
            let Ok(target) = entry.path().canonicalize() else {
                continue;
            };
            if !target.starts_with(&root) {
                continue;
            }
            std::fs::metadata(target).map_err(fs_error)?
        } else {
            entry.metadata().map_err(fs_error)?
        };
        if (!req.show_hidden && hidden(&name, &metadata))
            || (!metadata.is_file() && !metadata.is_dir())
        {
            continue;
        }
        let path = if req.dir.is_empty() {
            name.clone()
        } else {
            format!("{}/{name}", req.dir)
        };
        entries.push(FsEntry {
            name,
            path,
            kind: if metadata.is_dir() {
                FsEntryKind::Directory
            } else {
                FsEntryKind::File
            },
        });
    }
    entries.sort_by(|left, right| {
        (left.kind != FsEntryKind::Directory)
            .cmp(&(right.kind != FsEntryKind::Directory))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok((directory, entries))
}

async fn filter_ignored(
    git: &GitRunner,
    directory: &Path,
    entries: &mut Vec<FsEntry>,
) -> Result<(), AppError> {
    filter_ignored_cancel(git, directory, entries, &CancellationToken::new()).await
}

pub(super) async fn filter_ignored_cancel(
    git: &GitRunner,
    directory: &Path,
    entries: &mut Vec<FsEntry>,
    cancel: &CancellationToken,
) -> Result<(), AppError> {
    // Non-Git folders must remain browsable even when Git is unavailable.
    // Do not run check-ignore inside Git's own metadata directory.
    if entries.is_empty()
        || directory
            .components()
            .any(|part| part.as_os_str() == ".git")
        || !directory
            .ancestors()
            .any(|parent| parent.join(".git").exists())
    {
        return Ok(());
    }
    let input: Vec<u8> = entries
        .iter()
        .flat_map(|entry| entry.name.as_bytes().iter().copied().chain([0]))
        .collect();
    let invocation = GitInvocation::new(directory, ["check-ignore", "--stdin", "-z"])
        .git_bin(git.git_bin.clone())
        .stdin(input);
    let output = match git.run(invocation, cancel).await {
        Ok(output) => output,
        // check-ignore returns 1 when no supplied entry is ignored.
        Err(error) if error.exit_code == Some(1) => return Ok(()),
        Err(error) => return Err(error),
    };
    let ignored: HashSet<&[u8]> = output.stdout.split(|byte| *byte == 0).collect();
    entries.retain(|entry| !ignored.contains(entry.name.as_bytes()));
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn fs_read_dir(
    state: State<'_, AppState>,
    req: FsReadDirReq,
) -> Result<Vec<FsEntry>, AppError> {
    let show_ignored = req.show_ignored;
    let (directory, mut entries) = tokio::task::spawn_blocking(move || read_dir_entries(&req))
        .await
        .map_err(fs_error)??;
    if !show_ignored {
        filter_ignored(&*state.git.read().await, &directory, &mut entries).await?;
    }
    Ok(entries)
}

fn read_file(req: &FsReadFileReq) -> Result<String, AppError> {
    let path = resolve_entry(&req.folder_path, &req.file_path, false)?;
    let file = std::fs::File::open(path).map_err(fs_error)?;
    let metadata = file.metadata().map_err(fs_error)?;
    if !metadata.is_file() {
        return Err(fs_error("only regular text files can be opened"));
    }
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(fs_error("file exceeds the 5 MiB text editor limit"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(fs_error)?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Err(fs_error("file exceeds the 5 MiB text editor limit"));
    }
    if bytes.contains(&0) {
        return Err(fs_error("binary files cannot be edited as text"));
    }
    String::from_utf8(bytes).map_err(|_| fs_error("file is not valid UTF-8 text"))
}

#[tauri::command]
#[specta::specta]
pub async fn fs_read_file(req: FsReadFileReq) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || read_file(&req))
        .await
        .map_err(fs_error)?
}

fn write_file(req: &FsWriteFileReq) -> Result<(), AppError> {
    let path = resolve_entry(&req.folder_path, &req.file_path, false)?;
    if !path.is_file() {
        return Err(fs_error("only regular text files can be saved"));
    }
    if req.content.len() as u64 > MAX_TEXT_BYTES || req.content.contains('\0') {
        return Err(fs_error("content must be UTF-8 text no larger than 5 MiB"));
    }
    // Opening without create prevents a deleted file from silently being recreated.
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(fs_error)?;
    file.write_all(req.content.as_bytes()).map_err(fs_error)
}

#[tauri::command]
#[specta::specta]
pub async fn fs_write_file(req: FsWriteFileReq) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || write_file(&req))
        .await
        .map_err(fs_error)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list_req(root: &Path, dir: &str) -> FsReadDirReq {
        FsReadDirReq {
            folder_path: root.to_string_lossy().into_owned(),
            dir: dir.into(),
            show_ignored: false,
            show_hidden: false,
        }
    }

    #[test]
    fn lists_only_direct_children_in_non_git_folders_and_filters_hidden() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("folder")).unwrap();
        std::fs::write(root.path().join("folder/nested.txt"), "nested").unwrap();
        std::fs::write(root.path().join("text.txt"), "text").unwrap();
        std::fs::write(root.path().join(".hidden"), "hidden").unwrap();
        let mut req = list_req(root.path(), "");
        let (_, entries) = read_dir_entries(&req).unwrap();
        assert_eq!(
            entries.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
            ["folder", "text.txt"]
        );
        assert_eq!(entries[0].kind, FsEntryKind::Directory);
        req.show_hidden = true;
        assert_eq!(read_dir_entries(&req).unwrap().1.len(), 3);
        req.dir = "folder".into();
        assert_eq!(
            read_dir_entries(&req).unwrap().1[0].path,
            "folder/nested.txt"
        );
    }

    #[test]
    fn empty_directory_is_empty_and_missing_directory_errors() {
        let root = tempfile::tempdir().unwrap();
        assert!(read_dir_entries(&list_req(root.path(), ""))
            .unwrap()
            .1
            .is_empty());
        assert!(read_dir_entries(&list_req(root.path(), "missing")).is_err());
    }

    #[test]
    fn rejects_absolute_traversal_and_windows_path_aliases() {
        let root = tempfile::tempdir().unwrap();
        for relative in [
            "../escape",
            "a/../../escape",
            "/absolute",
            "C:/absolute",
            "a\\b",
            "file:stream",
            ".",
            "a\0b",
        ] {
            assert!(
                resolve_entry(root.path().to_str().unwrap(), relative, true).is_err(),
                "{relative:?}"
            );
        }
    }

    #[test]
    fn reads_and_saves_utf8_without_git_and_rejects_missing_files() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("中文.txt");
        std::fs::write(&path, "before\r\n").unwrap();
        let req = FsReadFileReq {
            folder_path: root.path().to_string_lossy().into_owned(),
            file_path: "中文.txt".into(),
        };
        assert_eq!(read_file(&req).unwrap(), "before\r\n");
        let write = FsWriteFileReq {
            folder_path: req.folder_path.clone(),
            file_path: req.file_path.clone(),
            content: "修改\r\n".into(),
        };
        write_file(&write).unwrap();
        assert_eq!(read_file(&req).unwrap(), "修改\r\n");
        std::fs::remove_file(path).unwrap();
        assert!(write_file(&write).is_err());
        assert!(read_file(&req).is_err());
    }

    #[test]
    fn rejects_binary_invalid_utf8_and_oversized_text() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file");
        let req = FsReadFileReq {
            folder_path: root.path().to_string_lossy().into_owned(),
            file_path: "file".into(),
        };
        for bytes in [
            vec![b'a', 0, b'b'],
            vec![255],
            vec![b'a'; MAX_TEXT_BYTES as usize + 1],
        ] {
            std::fs::write(&path, bytes).unwrap();
            assert!(read_file(&req).is_err());
        }
    }

    #[tokio::test]
    async fn ignores_use_git_rules_with_negation_and_keep_tracked_files() {
        let root = tempfile::tempdir().unwrap();
        let git = GitRunner::default();
        let cancel = CancellationToken::new();
        git.run(GitInvocation::new(root.path(), ["init", "-q"]), &cancel)
            .await
            .unwrap();
        std::fs::write(root.path().join("tracked.log"), "tracked").unwrap();
        git.run(
            GitInvocation::new(root.path(), ["add", "--", "tracked.log"]),
            &cancel,
        )
        .await
        .unwrap();
        std::fs::write(
            root.path().join(".gitignore"),
            "*.log\n!keep.log\nignored/\n",
        )
        .unwrap();
        std::fs::write(root.path().join("ignored.log"), "ignored").unwrap();
        std::fs::write(root.path().join("keep.log"), "keep").unwrap();
        std::fs::create_dir(root.path().join("ignored")).unwrap();
        std::fs::create_dir(root.path().join("nested")).unwrap();
        std::fs::write(root.path().join("nested/a.log"), "ignored").unwrap();
        let (directory, mut entries) = read_dir_entries(&list_req(root.path(), "")).unwrap();
        filter_ignored(&git, &directory, &mut entries)
            .await
            .unwrap();
        assert_eq!(
            entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            ["nested", "keep.log", "tracked.log"]
        );
        let (directory, mut entries) = read_dir_entries(&list_req(root.path(), "nested")).unwrap();
        filter_ignored(&git, &directory, &mut entries)
            .await
            .unwrap();
        assert!(entries.is_empty());
    }

    #[tokio::test]
    async fn non_git_listing_does_not_require_git_executable() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a.txt"), "text").unwrap();
        let (directory, mut entries) = read_dir_entries(&list_req(root.path(), "")).unwrap();
        filter_ignored(
            &GitRunner::new("does-not-exist-git"),
            &directory,
            &mut entries,
        )
        .await
        .unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn symlink_escape_is_not_listed_and_cannot_be_read_or_written() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "unchanged").unwrap();
        let link = root.path().join("outside");
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        #[cfg(windows)]
        {
            // Junctions exercise canonical containment without symlink privileges.
            let status = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", "New-Item -ItemType Junction -Path $env:GITX_TEST_LINK -Target $env:GITX_TEST_TARGET | Out-Null"])
                .env("GITX_TEST_LINK", &link)
                .env("GITX_TEST_TARGET", outside.path())
                .status().unwrap();
            assert!(status.success());
        }
        let folder_path = root.path().to_string_lossy().into_owned();
        assert!(resolve_entry(&folder_path, "outside/secret.txt", false).is_err());
        assert!(read_file(&FsReadFileReq {
            folder_path: folder_path.clone(),
            file_path: "outside/secret.txt".into()
        })
        .is_err());
        assert!(write_file(&FsWriteFileReq {
            folder_path,
            file_path: "outside/secret.txt".into(),
            content: "changed".into()
        })
        .is_err());
        assert!(read_dir_entries(&list_req(root.path(), ""))
            .unwrap()
            .1
            .is_empty());
        assert_eq!(
            std::fs::read_to_string(outside.path().join("secret.txt")).unwrap(),
            "unchanged"
        );
        // Remove only the link, so temporary directory cleanup never follows it.
        #[cfg(windows)]
        std::fs::remove_dir(link).unwrap();
        #[cfg(unix)]
        std::fs::remove_file(link).unwrap();
    }
}
