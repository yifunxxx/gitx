use gitx_core::{AppError, ErrorCode};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum FsOperation {
    CreateFile,
    CreateDirectory,
    Rename,
    Copy,
    Move,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsMutation {
    pub path: String,
    /// Exact workspace-relative destination, including the new name.
    pub destination: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsMutateReq {
    pub folder_path: String,
    pub operation: FsOperation,
    pub items: Vec<FsMutation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsMutationFailure {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsMutateResult {
    pub completed: Vec<FsMutation>,
    pub failures: Vec<FsMutationFailure>,
}

fn failure(message: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::FsError, message.to_string())
}

fn validate_relative(relative: &str) -> Result<(), AppError> {
    if relative.is_empty()
        || relative.contains(['\0', '\\', ':'])
        || relative.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || part.eq_ignore_ascii_case(".git")
                || part.ends_with(['.', ' '])
        })
        || Path::new(relative)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(failure(
            "use a workspace-relative path outside Git metadata",
        ));
    }
    Ok(())
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

/// Validate every existing component, not only the final canonical path. An
/// operation on a link must never accidentally mutate its target.
fn resolve(root: &Path, relative: &str, new_leaf: bool) -> Result<PathBuf, AppError> {
    validate_relative(relative)?;
    let mut path = root.to_path_buf();
    let parts: Vec<_> = relative.split('/').collect();
    for (index, part) in parts.iter().enumerate() {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(metadata) => {
                if is_link(&metadata) {
                    return Err(failure(
                        "file operations through symbolic links or junctions are not supported",
                    ));
                }
                if index + 1 < parts.len() && !metadata.is_dir() {
                    return Err(failure("parent is not a directory"));
                }
                if !path.canonicalize().map_err(failure)?.starts_with(root) {
                    return Err(failure("path must stay inside the workspace"));
                }
            }
            Err(error)
                if new_leaf
                    && index + 1 == parts.len()
                    && error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(failure(error)),
        }
    }
    Ok(path)
}

fn ensure_absent(path: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(failure("destination already exists; choose another name")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(failure(error)),
    }
}

fn inside(path: &Path, parent: &Path) -> bool {
    #[cfg(windows)]
    {
        let path = path.to_string_lossy().to_lowercase();
        let parent = parent.to_string_lossy().to_lowercase();
        path == parent || path.starts_with(&format!("{parent}\\"))
    }
    #[cfg(not(windows))]
    {
        path.starts_with(parent)
    }
}

// Standard fs::rename may replace a destination. Use the OS's exclusive rename
// so a destination created after preflight is also protected.
#[cfg(windows)]
fn rename_exclusive(from: &Path, to: &Path) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let from: Vec<u16> = from.as_os_str().encode_wide().chain([0]).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain([0]).collect();
    // SAFETY: NUL-terminated buffers live throughout this synchronous call.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } == 0 {
        return Err(failure(std::io::Error::last_os_error()));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn rename_exclusive(from: &Path, to: &Path) -> Result<(), AppError> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};
    renameat_with(CWD, from, CWD, to, RenameFlags::NOREPLACE).map_err(failure)
}

#[cfg(target_os = "macos")]
fn rename_exclusive(from: &Path, to: &Path) -> Result<(), AppError> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    unsafe extern "C" {
        fn renamex_np(
            from: *const std::ffi::c_char,
            to: *const std::ffi::c_char,
            flags: u32,
        ) -> i32;
    }
    let from = CString::new(from.as_os_str().as_bytes()).map_err(failure)?;
    let to = CString::new(to.as_os_str().as_bytes()).map_err(failure)?;
    // RENAME_EXCL, defined by Darwin stdio.h.
    if unsafe { renamex_np(from.as_ptr(), to.as_ptr(), 4) } != 0 {
        return Err(failure(std::io::Error::last_os_error()));
    }
    Ok(())
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn rename_exclusive(_from: &Path, _to: &Path) -> Result<(), AppError> {
    Err(failure("exclusive rename is unavailable on this platform"))
}

fn copy_entry(from: &Path, to: &Path, depth: usize) -> Result<(), AppError> {
    if depth > 256 {
        return Err(failure("directory nesting exceeds 256 levels"));
    }
    let metadata = fs::symlink_metadata(from).map_err(failure)?;
    if is_link(&metadata) {
        return Err(failure(
            "copying symbolic links or junctions is not supported",
        ));
    }
    if metadata.is_dir() {
        fs::create_dir(to).map_err(failure)?;
        for entry in fs::read_dir(from).map_err(failure)? {
            let entry = entry.map_err(failure)?;
            copy_entry(&entry.path(), &to.join(entry.file_name()), depth + 1)?;
        }
        fs::set_permissions(to, metadata.permissions()).map_err(failure)?;
    } else if metadata.is_file() {
        let mut input = fs::File::open(from).map_err(failure)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(to)
            .map_err(failure)?;
        std::io::copy(&mut input, &mut output).map_err(failure)?;
        output.sync_all().map_err(failure)?;
        output
            .set_permissions(metadata.permissions())
            .map_err(failure)?;
    } else {
        return Err(failure("only regular files and directories are supported"));
    }
    Ok(())
}

fn apply(root: &Path, operation: FsOperation, item: &FsMutation) -> Result<(), AppError> {
    let create = matches!(
        operation,
        FsOperation::CreateFile | FsOperation::CreateDirectory
    );
    let source = resolve(root, &item.path, create)?;
    if operation == FsOperation::Delete {
        // trash uses the system recycle bin (Windows requests a nuke warning
        // together with no UI, so unrecyclable entries fail). Never fall back
        // to remove_file/remove_dir_all on an error.
        return trash::delete(&source).map_err(failure);
    }
    if create {
        ensure_absent(&source)?;
        return if operation == FsOperation::CreateDirectory {
            fs::create_dir(source).map_err(failure)
        } else {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(source)
                .map(|_| ())
                .map_err(failure)
        };
    }
    let target_relative = item
        .destination
        .as_deref()
        .ok_or_else(|| failure("destination is required"))?;
    let target = resolve(root, target_relative, true)?;
    // Permit a case-only rename of the same entry on Windows, but never a copy
    // or move onto an unrelated existing entry.
    #[cfg(windows)]
    if operation == FsOperation::Rename
        && item.path != target_relative
        && source
            .to_string_lossy()
            .eq_ignore_ascii_case(&target.to_string_lossy())
    {
        return rename_exclusive(&source, &target);
    }
    if source == target || (source.is_dir() && inside(&target, &source)) {
        return Err(failure("cannot copy or move an entry into itself"));
    }
    ensure_absent(&target)?;
    if operation == FsOperation::Copy {
        // Stage in a private sibling directory. A failed copy never exposes a
        // half-written destination and never removes a pre-existing entry.
        let staging = tempfile::Builder::new()
            .prefix(".gitx-copy-")
            .tempdir_in(target.parent().unwrap())
            .map_err(failure)?;
        let prepared = staging.path().join("entry");
        copy_entry(&source, &prepared, 0)?;
        rename_exclusive(&prepared, &target)
    } else {
        rename_exclusive(&source, &target)
    }
}

fn mutate(req: FsMutateReq) -> Result<FsMutateResult, AppError> {
    if !Path::new(&req.folder_path).is_absolute() || req.items.is_empty() || req.items.len() > 1000
    {
        return Err(failure(
            "provide an absolute workspace and between 1 and 1000 entries",
        ));
    }
    let root = Path::new(&req.folder_path)
        .canonicalize()
        .map_err(failure)?;
    if !root.is_dir() {
        return Err(failure("workspace root is not a directory"));
    }
    let mut result = FsMutateResult::default();
    for item in req.items {
        match apply(&root, req.operation, &item) {
            Ok(()) => result.completed.push(item),
            Err(error) => result.failures.push(FsMutationFailure {
                path: item.path,
                message: error.message,
            }),
        }
    }
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn fs_mutate(req: FsMutateReq) -> Result<FsMutateResult, AppError> {
    static MUTATIONS: std::sync::Mutex<()> = std::sync::Mutex::new(());
    tokio::task::spawn_blocking(move || {
        let _guard = MUTATIONS.lock().map_err(failure)?;
        mutate(req)
    })
    .await
    .map_err(failure)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(
        root: &Path,
        operation: FsOperation,
        path: &str,
        destination: Option<&str>,
    ) -> FsMutateResult {
        mutate(FsMutateReq {
            folder_path: root.to_string_lossy().into_owned(),
            operation,
            items: vec![FsMutation {
                path: path.into(),
                destination: destination.map(str::to_owned),
            }],
        })
        .unwrap()
    }

    #[test]
    fn creates_renames_copies_and_moves_files_and_directories_without_git() {
        let root = tempfile::tempdir().unwrap();
        assert!(run(root.path(), FsOperation::CreateDirectory, "src", None)
            .failures
            .is_empty());
        assert!(run(root.path(), FsOperation::CreateFile, "src/a.txt", None)
            .failures
            .is_empty());
        fs::write(root.path().join("src/a.txt"), "中文\n").unwrap();
        assert!(run(
            root.path(),
            FsOperation::Rename,
            "src/a.txt",
            Some("src/b.txt")
        )
        .failures
        .is_empty());
        assert!(run(root.path(), FsOperation::Copy, "src", Some("copy"))
            .failures
            .is_empty());
        assert!(run(
            root.path(),
            FsOperation::Move,
            "copy/b.txt",
            Some("moved.txt")
        )
        .failures
        .is_empty());
        assert_eq!(
            fs::read_to_string(root.path().join("moved.txt")).unwrap(),
            "中文\n"
        );
        assert!(!root.path().join("copy/b.txt").exists());
        assert!(root.path().join("src/b.txt").exists());
    }

    #[test]
    fn rejects_escape_metadata_conflicts_and_descendant_targets() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("dir")).unwrap();
        fs::write(root.path().join("a"), "source").unwrap();
        fs::write(root.path().join("b"), "target").unwrap();
        for path in [
            "../escape",
            "/absolute",
            "C:/absolute",
            "a\\b",
            ".git/config",
            "dir/../a",
            "a:stream",
            "a.",
        ] {
            assert_eq!(
                run(root.path(), FsOperation::CreateFile, path, None)
                    .failures
                    .len(),
                1,
                "{path}"
            );
        }
        for operation in [FsOperation::Copy, FsOperation::Move, FsOperation::Rename] {
            assert_eq!(
                run(root.path(), operation, "a", Some("b")).failures.len(),
                1
            );
            assert_eq!(
                run(root.path(), operation, "dir", Some("dir/child"))
                    .failures
                    .len(),
                1
            );
        }
        assert_eq!(fs::read_to_string(root.path().join("a")).unwrap(), "source");
        assert_eq!(fs::read_to_string(root.path().join("b")).unwrap(), "target");
    }

    #[test]
    fn batch_reports_partial_success_and_does_not_overwrite() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("exists"), "keep").unwrap();
        let result = mutate(FsMutateReq {
            folder_path: root.path().to_string_lossy().into_owned(),
            operation: FsOperation::CreateFile,
            items: ["exists", "new"]
                .map(|path| FsMutation {
                    path: path.into(),
                    destination: None,
                })
                .to_vec(),
        })
        .unwrap();
        assert_eq!(result.completed[0].path, "new");
        assert_eq!(result.failures[0].path, "exists");
        assert_eq!(
            fs::read_to_string(root.path().join("exists")).unwrap(),
            "keep"
        );
    }

    #[test]
    fn rejects_links_and_rolls_back_an_incomplete_directory_copy() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("source")).unwrap();
        fs::write(root.path().join("source/a"), "safe").unwrap();
        fs::write(outside.path().join("keep"), "outside").unwrap();
        let link = root.path().join("source/link");
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(outside.path(), &link).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        assert_eq!(
            run(root.path(), FsOperation::Copy, "source", Some("copy"))
                .failures
                .len(),
            1
        );
        assert!(!root.path().join("copy").exists());
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
        assert_eq!(
            run(
                root.path(),
                FsOperation::CreateFile,
                "source/link/new",
                None
            )
            .failures
            .len(),
            1
        );
        assert_eq!(
            run(root.path(), FsOperation::Move, "source/link", Some("moved"))
                .failures
                .len(),
            1
        );
        assert_eq!(
            fs::read_to_string(outside.path().join("keep")).unwrap(),
            "outside"
        );
        assert!(!outside.path().join("new").exists());
    }

    #[cfg(windows)]
    #[test]
    fn supports_case_only_rename() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("name.txt"), "keep").unwrap();
        assert!(run(
            root.path(),
            FsOperation::Rename,
            "name.txt",
            Some("NAME.txt")
        )
        .failures
        .is_empty());
        assert_eq!(
            fs::read_dir(root.path())
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .file_name(),
            "NAME.txt"
        );
        fs::create_dir(root.path().join("dir")).unwrap();
        assert!(run(root.path(), FsOperation::Rename, "dir", Some("DIR"))
            .failures
            .is_empty());
        assert!(
            run(root.path(), FsOperation::Move, "DIR", Some("dir/child"))
                .completed
                .is_empty()
        );
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires the host Recycle Bin; run explicitly on temporary fixtures"]
    fn recycles_and_restores_own_fixture_and_preserves_locked_file() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("locked.txt"), "keep").unwrap();
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(root.path().join("locked.txt"))
            .unwrap();
        assert_eq!(
            run(root.path(), FsOperation::Delete, "locked.txt", None)
                .failures
                .len(),
            1
        );
        drop(locked);
        assert_eq!(
            fs::read_to_string(root.path().join("locked.txt")).unwrap(),
            "keep"
        );
        for (name, directory) in [("recycle-file.txt", false), ("recycle-folder", true)] {
            let target = root.path().join(name);
            if directory {
                fs::create_dir(&target).unwrap();
                fs::write(target.join("child"), "restore me").unwrap();
            } else {
                fs::write(&target, "restore me").unwrap();
            }
            let result = run(root.path(), FsOperation::Delete, name, None);
            assert!(result.failures.is_empty(), "{:?}", result.failures);
            assert!(!target.exists());
            // Only restore the exact unique test fixture; do not touch any
            // unrelated entry in the user's Recycle Bin.
            let items: Vec<_> = trash::os_limited::list()
                .unwrap()
                .into_iter()
                .filter(|item| {
                    item.original_parent == root.path() && item.name == std::ffi::OsStr::new(name)
                })
                .collect();
            assert_eq!(items.len(), 1);
            trash::os_limited::restore_all(items).unwrap();
            assert_eq!(
                fs::read_to_string(if directory {
                    target.join("child")
                } else {
                    target
                })
                .unwrap(),
                "restore me"
            );
        }
    }
}
