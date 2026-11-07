//! gitx-helper sidecar — askpass / editor / seq-editor.
//!
//! M5: seq-editor / editor can inject a prepared file via env:
//! - `GITX_REBASE_TODO` — path copied over the git-rebase-todo
//! - `GITX_COMMIT_MSG` — path copied over COMMIT_EDITMSG (reword/squash)
//!
//! Askpass (GIT-41): when git/ssh invokes this binary via `GIT_ASKPASS` /
//! `SSH_ASKPASS`, credentials are read from `GITX_ASKPASS_FILE` (written by the
//! app after the in-app credential dialog). Format:
//! ```text
//! username=<user>
//! password=<pass>
//! ```
//! Prompt text containing "username" returns the username line; otherwise the
//! password. Full local IPC remains a future enhancement.

use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let Some(first) = args.next() else {
        eprintln!("usage: gitx-helper <askpass|editor|seq-editor> …");
        return ExitCode::from(2);
    };

    match first.as_str() {
        "askpass" => {
            let prompt = args.next().unwrap_or_default();
            askpass(&prompt)
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
        // GIT_ASKPASS / SSH_ASKPASS invoke `$ASKPASS <prompt>` with no subcommand.
        other => askpass(other),
    }
}

fn askpass(prompt: &str) -> ExitCode {
    let Ok(path) = env::var("GITX_ASKPASS_FILE") else {
        eprintln!("gitx-helper askpass: GITX_ASKPASS_FILE not set ({prompt})");
        return ExitCode::from(1);
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        eprintln!("gitx-helper askpass: cannot read {path}");
        return ExitCode::from(1);
    };

    let mut username = String::new();
    let mut password = String::new();
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("username=") {
            username = rest.to_string();
        } else if let Some(rest) = line.strip_prefix("password=") {
            password = rest.to_string();
        }
    }

    let lower = prompt.to_lowercase();
    let value = if lower.contains("username") {
        username
    } else {
        // Password / Passphrase / Password for 'https://…'
        password
    };

    if value.is_empty() && lower.contains("username") {
        eprintln!("gitx-helper askpass: empty username for prompt");
        return ExitCode::from(1);
    }

    // Never log the secret — only write to stdout for git.
    let mut out = io::stdout().lock();
    if writeln!(out, "{value}").is_err() {
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

fn copy_file(src: &str, dst: &str) -> std::io::Result<()> {
    let data = fs::read(src)?;
    if let Some(parent) = Path::new(dst).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(dst, data)
}
