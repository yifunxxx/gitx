//! gitx-helper sidecar — askpass / editor / seq-editor.
//!
//! M5: seq-editor / editor can inject a prepared file via env:
//! - `GITX_REBASE_TODO` — path copied over the git-rebase-todo
//! - `GITX_REBASE_PLAN` — per-commit edits persisted with the active sequencer
//! - `GITX_COMMIT_MSG` — path copied over COMMIT_EDITMSG (reword/squash)
//!
//! Askpass (GIT-41): when git/ssh invokes this binary via `GIT_ASKPASS` /
//! `SSH_ASKPASS`, credentials are read from `GITX_ASKPASS_FILE` (written by the
//! app after the in-app credential dialog) as a JSON CredentialSession.
//! Only matching HTTP(S) origins and usernames can request the password.

use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::process::ExitCode;

mod rebase;

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
            if let Err(error) = rebase::edit_message(Path::new(&file)) {
                eprintln!("gitx-helper editor: {error}");
                return ExitCode::FAILURE;
            }
            ExitCode::SUCCESS
        }
        "seq-editor" => {
            let Some(file) = args.next() else {
                eprintln!("gitx-helper seq-editor: missing path");
                return ExitCode::from(2);
            };
            if let Err(error) = rebase::edit_todo(Path::new(&file)) {
                eprintln!("gitx-helper seq-editor: {error}");
                return ExitCode::FAILURE;
            }
            ExitCode::SUCCESS
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

    let Ok(session) = serde_json::from_str::<gitx_core::CredentialSession>(&raw) else {
        eprintln!("gitx-helper askpass: invalid credential session");
        return ExitCode::from(1);
    };
    let Some(value) = session.answer(prompt) else {
        eprintln!("gitx-helper askpass: no credential for this target");
        return ExitCode::from(1);
    };

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
