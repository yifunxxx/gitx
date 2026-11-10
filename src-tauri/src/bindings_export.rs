//! Explicit developer-only export, independent from normal application startup.

use std::error::Error;
use std::ffi::OsString;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// True means an explicit export completed and the caller should exit without
/// opening a GUI. A failed render/write/replace preserves the destination.
pub(crate) fn export_when_requested<E: Error + 'static>(
    destination: Option<OsString>,
    render: impl FnOnce() -> Result<String, E>,
) -> Result<bool, Box<dyn Error>> {
    let Some(destination) = destination else {
        return Ok(false);
    };
    if destination.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "GITX_EXPORT_BINDINGS must name a destination .ts file",
        )
        .into());
    }
    let destination = PathBuf::from(destination);
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    // Specta's direct file exporter truncates before rendering. Render first,
    // then publish through a unique sibling temporary file on the same volume.
    let contents = render()?;
    let mut temp = tempfile::Builder::new()
        .prefix(".gitx-bindings-")
        .suffix(".ts")
        .tempfile_in(parent)?;
    temp.write_all(contents.as_bytes())?;
    temp.flush()?;
    publish(temp.into_temp_path(), &destination)?;
    Ok(true)
}

fn publish(mut temp: tempfile::TempPath, destination: &Path) -> io::Result<()> {
    for attempt in 0..=8 {
        match temp.persist(destination) {
            Ok(()) => return Ok(()),
            Err(error) => {
                // Windows replacement can briefly fail while another process
                // replaces the same destination. Retry the complete temporary
                // file, never truncate or delete the destination to unblock it.
                // A persistent lock/ACL error still fails within 360 ms.
                if attempt == 8 || !retryable_replacement(&error.error) {
                    return Err(error.error);
                }
                temp = error.path;
                std::thread::sleep(std::time::Duration::from_millis(10 * (attempt + 1)));
            }
        }
    }
    unreachable!("the last replacement attempt returns")
}

fn retryable_replacement(error: &io::Error) -> bool {
    cfg!(windows) && matches!(error.raw_os_error(), Some(5 | 32 | 33))
}
