//! gitx-helper sidecar — askpass / editor / seq-editor.
//!
//! M0 stub: prints prompt and exits non-zero (no IPC server yet). Full local IPC
//! (Unix socket / named pipe + GITX_IPC_TOKEN) lands before M2 credential flows.

use std::env;
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
        "editor" | "seq-editor" => {
            let file = args.next().unwrap_or_default();
            eprintln!("gitx-helper {cmd} stub — leaving file untouched: {file}");
            ExitCode::from(1)
        }
        other => {
            eprintln!("unknown subcommand: {other}");
            ExitCode::from(2)
        }
    }
}
