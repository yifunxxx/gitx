use gitx_core::{AppError, ErrorCode, RepoId};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;
use tracing::debug;
#[cfg(not(windows))]
use tracing::warn;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpKind {
    Read,
    Write,
    Network,
    NetworkWrite,
}

#[derive(Debug, Clone)]
pub struct GitInvocation {
    pub repo: Option<RepoId>,
    pub cwd: PathBuf,
    pub args: Vec<OsString>,
    pub kind: OpKind,
    pub stdin: Option<Vec<u8>>,
    pub timeout: Option<Duration>,
    pub git_bin: String,
    pub env: Vec<(String, String)>,
}

impl GitInvocation {
    pub fn new(
        cwd: impl Into<PathBuf>,
        args: impl IntoIterator<Item = impl Into<OsString>>,
    ) -> Self {
        Self {
            repo: None,
            cwd: cwd.into(),
            args: args.into_iter().map(Into::into).collect(),
            kind: OpKind::Read,
            stdin: None,
            timeout: Some(Duration::from_secs(30)),
            git_bin: "git".into(),
            env: Vec::new(),
        }
    }

    pub fn kind(mut self, kind: OpKind) -> Self {
        self.kind = kind;
        self
    }

    pub fn git_bin(mut self, bin: impl Into<String>) -> Self {
        self.git_bin = bin.into();
        self
    }

    pub fn timeout(mut self, timeout: Option<Duration>) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn stdin(mut self, bytes: impl Into<Vec<u8>>) -> Self {
        self.stdin = Some(bytes.into());
        self
    }

    pub fn env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.push((key.into(), value.into()));
        self
    }

    pub fn display_command(&self) -> String {
        let mut parts = vec![self.git_bin.clone()];
        for a in &self.args {
            parts.push(a.to_string_lossy().into_owned());
        }
        redact_command(&parts.join(" "))
    }
}

#[derive(Debug, Clone)]
pub struct GitOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_code: i32,
    pub command: String,
}

pub struct GitRunner {
    pub git_bin: String,
    /// When set, invoke via `wsl.exe -d <distro> -- git …` with a Linux cwd (#9).
    pub wsl_distro: Option<String>,
}

impl Default for GitRunner {
    fn default() -> Self {
        Self {
            git_bin: "git".into(),
            wsl_distro: None,
        }
    }
}

impl GitRunner {
    pub fn new(git_bin: impl Into<String>) -> Self {
        Self {
            git_bin: git_bin.into(),
            wsl_distro: None,
        }
    }

    pub fn with_wsl(mut self, distro: impl Into<String>) -> Self {
        self.wsl_distro = Some(distro.into());
        self
    }

    fn invocation_distro(&self, inv: &GitInvocation) -> Option<String> {
        crate::detect::parse_wsl_unc_path(&inv.cwd.to_string_lossy())
            .map(|info| info.distro)
            .or_else(|| self.wsl_distro.clone())
            .or_else(|| parse_wsl_git_bin(&inv.git_bin).map(|(d, _)| d))
    }

    pub async fn run(
        &self,
        mut inv: GitInvocation,
        cancel: &CancellationToken,
    ) -> Result<GitOutput, AppError> {
        if cancel.is_cancelled() {
            return Err(AppError::new(ErrorCode::Cancelled, "operation cancelled"));
        }
        if inv.git_bin == "git" {
            inv.git_bin = self.git_bin.clone();
        }
        let command = inv.display_command();
        debug!(%command, cwd = %inv.cwd.display(), "git run");

        let wsl_distro = self.invocation_distro(&inv);

        let mut cmd = if let Some(distro) = wsl_distro {
            build_wsl_git_command(&distro, &inv)
        } else {
            let mut c = Command::new(&inv.git_bin);
            c.args(&inv.args).current_dir(&inv.cwd);
            c
        };
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C");
        crate::process_win::hide_console_tokio(&mut cmd);

        // Network ops: point git/ssh at gitx-helper askpass so credentials can be
        // supplied without a TTY (GIT_TERMINAL_PROMPT=0). Helper reads GITX_ASKPASS_FILE.
        if matches!(inv.kind, OpKind::Network | OpKind::NetworkWrite) {
            // Read saved credentials, but let the application's dialog handle prompts.
            cmd.env("GCM_INTERACTIVE", "Never");
            let helper = helper_bin();
            cmd.env("GIT_ASKPASS", &helper);
            cmd.env("SSH_ASKPASS", &helper);
            cmd.env("SSH_ASKPASS_REQUIRE", "force");
            // DISPLAY is required on some platforms before SSH_ASKPASS is honored.
            if std::env::var_os("DISPLAY").is_none() {
                cmd.env("DISPLAY", ":0");
            }
        }

        for (k, v) in &inv.env {
            cmd.env(k, v);
        }

        if inv.stdin.is_some() {
            cmd.stdin(Stdio::piped());
        } else {
            cmd.stdin(Stdio::null());
        }

        // Standard CLI-first flags from the framework plan.
        // Callers still pass their own args; we inject safe defaults via -c.
        inject_base_config(&mut cmd, inv.kind);

        #[cfg(unix)]
        unsafe {
            cmd.pre_exec(|| {
                // New process group so cancel can kill the whole tree.
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }

        #[cfg(windows)]
        let process_job = crate::process_win::ProcessJob::new()
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("create process job: {e}")))?;
        #[cfg(windows)]
        process_job.prepare(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| {
            AppError::new(ErrorCode::FsError, format!("failed to spawn git: {e}"))
                .with_command(command.clone())
        })?;
        #[cfg(windows)]
        process_job
            .attach_and_resume(&child)
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("attach process job: {e}")))?;

        #[cfg(not(windows))]
        let pid = child.id();
        let timeout = inv.timeout.unwrap_or(Duration::from_secs(30));
        let stdin = child.stdin.take();
        let input = inv.stdin.take();
        // Drain stdout/stderr while writing stdin. A hook or helper may fill its
        // output pipe before consuming a large patch; writing first deadlocks.
        let output_future = async move {
            let write_input = async move {
                use tokio::io::AsyncWriteExt;
                if let (Some(mut stdin), Some(bytes)) = (stdin, input) {
                    stdin.write_all(&bytes).await?;
                    stdin.shutdown().await?;
                }
                Ok::<(), std::io::Error>(())
            };
            let (_, output) = tokio::try_join!(write_input, child.wait_with_output())?;
            Ok::<_, std::io::Error>(output)
        };
        // Keep the child alive until cancellation has terminated its whole tree.
        // Dropping wait_with_output first only kills the root on Windows.
        tokio::pin!(output_future);

        let output = tokio::select! {
            _ = cancel.cancelled() => {
                #[cfg(windows)]
                process_job.terminate();
                #[cfg(not(windows))]
                kill_process_tree(pid).await;
                return Err(AppError::new(ErrorCode::Cancelled, "git command cancelled")
                    .with_command(command.clone()));
            }
            result = &mut output_future => {
                match result {
                    Ok(output) => output,
                    Err(e) => {
                        #[cfg(windows)]
                        process_job.terminate();
                        #[cfg(not(windows))]
                        kill_process_tree(pid).await;
                        return Err(AppError::new(ErrorCode::Internal, format!("git I/O failed: {e}"))
                            .with_command(command.clone()));
                    }
                }
            }
            _ = tokio::time::sleep(timeout) => {
                #[cfg(windows)]
                process_job.terminate();
                #[cfg(not(windows))]
                kill_process_tree(pid).await;
                return Err(AppError::new(ErrorCode::Timeout, "git command timed out")
                    .with_command(command.clone()));
            }
        };
        let exit_code = output.status.code().unwrap_or(-1);
        let git_out = GitOutput {
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code,
            command,
        };

        if exit_code != 0 {
            let stderr = String::from_utf8_lossy(&git_out.stderr).trim().to_string();
            return Err(AppError::new(
                ErrorCode::GitCommandFailed,
                if stderr.is_empty() {
                    format!("git exited with code {exit_code}")
                } else {
                    stderr.clone()
                },
            )
            .with_command(git_out.command.clone())
            .with_stderr(stderr)
            .with_exit_code(exit_code)
            .with_recover(vec![
                gitx_core::RecoverAction::OpenConsole,
                gitx_core::RecoverAction::ShowDetails,
            ]));
        }

        Ok(git_out)
    }

    /// Convenience: run `git status --porcelain=v2 -z --branch` in a folder.
    pub async fn status_probe(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<GitOutput, AppError> {
        let inv = GitInvocation::new(
            cwd,
            [
                "-c",
                "core.quotepath=false",
                "-c",
                "color.ui=false",
                "--no-optional-locks",
                "status",
                "--porcelain=v2",
                "-z",
                "--branch",
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await
    }
}

fn inject_base_config(cmd: &mut Command, kind: OpKind) {
    // When Settings → Use credential helper is off, clear helpers so askpass owns auth.
    // Prefer GIT_CONFIG_* env (works regardless of argv position vs subcommand).
    // GITX_USE_CREDENTIAL_HELPER is maintained by credential_session / settings path.
    if matches!(kind, OpKind::Network | OpKind::NetworkWrite) {
        let use_helper = std::env::var("GITX_USE_CREDENTIAL_HELPER")
            .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
            .unwrap_or(true);
        let mut config = Vec::<(String, String)>::new();
        if !use_helper {
            config.push(("credential.helper".into(), String::new()));
        }
        if let Some(session) = std::env::var_os("GITX_ASKPASS_FILE")
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<gitx_core::CredentialSession>(&bytes).ok())
        {
            // Explicitly entered account wins over a globally configured username
            // or a stale saved credential, only for this origin.
            config.push((
                format!("credential.{}.helper", session.origin),
                String::new(),
            ));
            config.push((
                format!("credential.{}.username", session.origin),
                session.username,
            ));
        }
        if !config.is_empty() {
            let inherited = std::env::var("GIT_CONFIG_COUNT")
                .ok()
                .and_then(|n| n.parse::<usize>().ok())
                .unwrap_or(0);
            cmd.env("GIT_CONFIG_COUNT", (inherited + config.len()).to_string());
            for (offset, (key, value)) in config.into_iter().enumerate() {
                cmd.env(format!("GIT_CONFIG_KEY_{}", inherited + offset), key);
                cmd.env(format!("GIT_CONFIG_VALUE_{}", inherited + offset), value);
            }
        }
    }
}

/// Resolve `gitx-helper` beside the running binary (Tauri sidecar / cargo target).
pub fn helper_bin() -> String {
    if let Ok(p) = std::env::var("GITX_HELPER_PATH") {
        return p;
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("gitx-helper");
            if candidate.exists() {
                return candidate.to_string_lossy().into_owned();
            }
            #[cfg(windows)]
            {
                let candidate = dir.join("gitx-helper.exe");
                if candidate.exists() {
                    return candidate.to_string_lossy().into_owned();
                }
                // Tauri externalBin renames sidecars with the target triple.
                if let Ok(rd) = std::fs::read_dir(dir) {
                    for ent in rd.flatten() {
                        let name = ent.file_name();
                        let s = name.to_string_lossy();
                        if s.starts_with("gitx-helper") && s.ends_with(".exe") {
                            return ent.path().to_string_lossy().into_owned();
                        }
                    }
                }
            }
            #[cfg(unix)]
            {
                if let Ok(rd) = std::fs::read_dir(dir) {
                    for ent in rd.flatten() {
                        let name = ent.file_name();
                        let s = name.to_string_lossy();
                        if s.starts_with("gitx-helper") {
                            return ent.path().to_string_lossy().into_owned();
                        }
                    }
                }
            }
        }
    }
    "gitx-helper".into()
}

/// Parse `wsl.exe -d Distro git` style bins into (distro, "git").
fn parse_wsl_git_bin(bin: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = bin.split_whitespace().collect();
    if parts.len() >= 4 && parts[0].eq_ignore_ascii_case("wsl.exe") && parts[1] == "-d" {
        Some((parts[2].to_string(), parts[3..].join(" ")))
    } else {
        None
    }
}

fn build_wsl_git_command(distro: &str, inv: &GitInvocation) -> Command {
    let linux_cwd = crate::detect::parse_wsl_unc_path(&inv.cwd.to_string_lossy())
        .map(|i| i.linux_path)
        .or_else(|| crate::detect::wsl_translate_path(distro, &inv.cwd.to_string_lossy()))
        .unwrap_or_else(|| inv.cwd.to_string_lossy().replace('\\', "/"));
    let mut prefixed = vec![OsString::from("-C"), OsString::from(linux_cwd)];
    prefixed.extend(inv.args.iter().cloned());
    let mut c = Command::new("wsl.exe");
    c.arg("-d").arg(distro).arg("--").arg("git");
    c.args(&prefixed);
    c
}

fn redact_command(cmd: &str) -> String {
    // Strip credentials from URLs: https://user:pass@host → https://***@host
    let re = regex::Regex::new(r"(https?://)([^/@\s]+)@").ok();
    match re {
        Some(re) => re.replace_all(cmd, "${1}***@").into_owned(),
        None => cmd.to_string(),
    }
}

#[cfg(not(windows))]
async fn kill_process_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    #[cfg(unix)]
    {
        // Negative PID = process group (created via setsid).
        let pgid = pid as i32;
        unsafe {
            libc::kill(-pgid, libc::SIGINT);
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
    let _ = pid;
    warn!(pid, "cancelled git process tree");
}

#[cfg(test)]
mod routing_tests {
    use super::*;

    #[test]
    fn wsl_routing_is_local_to_each_invocation() {
        let runner = GitRunner::new("custom-git.exe");
        for (path, expected) in [
            (r"\\wsl$\Ubuntu\home\project", Some("Ubuntu")),
            (r"C:\repos\local", None),
            (r"\\wsl.localhost\Debian\tmp\repo", Some("Debian")),
            (r"C:\repos\other", None),
        ] {
            let inv = GitInvocation::new(path, ["status"]);
            assert_eq!(runner.invocation_distro(&inv).as_deref(), expected);
        }
        assert_eq!(runner.git_bin, "custom-git.exe");
        assert!(runner.wsl_distro.is_none());
    }
}
