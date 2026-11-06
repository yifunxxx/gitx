//! gitx-helper sidecar — askpass / editor / seq-editor.
//!
//! M5: seq-editor / editor can inject a prepared file via env:
//! - `GITX_REBASE_TODO` — path copied over the git-rebase-todo
//! - `GITX_COMMIT_MSG` — path copied over COMMIT_EDITMSG (reword/squash)
//! Full local IPC (Unix socket / named pipe + GITX_IPC_TOKEN) remains for askpass UI.

use std::env;
use std::fs;
use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let Some(cmd) = args.next() else {
        eprintln!("usage: gitx-helper <askpass|editor|seq-editor> …");
        return ExitCode::from(2);
    };

    match cmd.as_str() {
        "askpass" => {
            let prompt = args.next().unwrap_or_default();
            eprintln!("gitx-helper askpass stub (no UI): {prompt}");
            // Non-zero → git treats as auth cancel.
            ExitCode::from(1)
        }
        "editor" => {
            let Some(file) = args.next() else {
                eprintln!("gitx-helper editor: missing path");
                return ExitCode::from(2);
            };
            if let Ok(src) = env::var("GITX_COMMIT_MSG") {
                if copy_file(&src, &file).is_ok() {
                    return ExitCode::SUCCESS;
                }
            }
            // Leave existing contents (git-prepared squash/reword default).
            ExitCode::SUCCESS
        }
        "seq-editor" => {
            let Some(file) = args.next() else {
                eprintln!("gitx-helper seq-editor: missing path");
                return ExitCode::from(2);
            };
            if let Ok(src) = env::var("GITX_REBASE_TODO") {
                if copy_file(&src, &file).is_ok() {
                    return ExitCode::SUCCESS;
                }
                eprintln!("gitx-helper seq-editor: failed to copy {src} → {file}");
                return ExitCode::from(1);
            }
            eprintln!("gitx-helper seq-editor: GITX_REBASE_TODO not set");
            ExitCode::from(1)
        }
        other => {
            eprintln!("unknown subcommand: {other}");
            ExitCode::from(2)
        }
    }
}

fn copy_file(src: &str, dst: &str) -> std::io::Result<()> {
    let data = fs::read(src)?;
    if let Some(parent) = Path::new(dst).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(dst, data)
}
