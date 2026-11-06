use gitx_core::{AppError, ErrorCode, RepoId};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};

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

    pub async fn run(
        &self,
        mut inv: GitInvocation,
        cancel: &CancellationToken,
    ) -> Result<GitOutput, AppError> {
        if inv.git_bin == "git" {
            inv.git_bin = self.git_bin.clone();
        }
        let command = inv.display_command();
        debug!(%command, cwd = %inv.cwd.display(), "git run");

        let wsl_distro = self
            .wsl_distro
            .clone()
            .or_else(|| parse_wsl_git_bin(&inv.git_bin).map(|(d, _)| d));

        let mut cmd = if let Some(distro) = wsl_distro {
            build_wsl_git_command(&distro, &inv)
        } else {
            let mut c = Command::new(&inv.git_bin);
            c.args(&inv.args).current_dir(&inv.cwd);
            c
        };
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C");
        crate::process_win::hide_console_tokio(&mut cmd);

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
        // (Applied only when the first arg is not already a global option chain — stub keeps it simple.)
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

        let mut child = cmd.spawn().map_err(|e| {
            AppError::new(ErrorCode::FsError, format!("failed to spawn git: {e}"))
                .with_command(command.clone())
        })?;

        if let Some(bytes) = inv.stdin.take() {
            use tokio::io::AsyncWriteExt;
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(&bytes).await.map_err(|e| {
                    AppError::new(
                        ErrorCode::FsError,
                        format!("failed to write git stdin: {e}"),
                    )
                    .with_command(command.clone())
                })?;
                stdin.shutdown().await.ok();
            }
        }

        let pid = child.id();
        let timeout = inv.timeout.unwrap_or(Duration::from_secs(30));

        let output = tokio::select! {
            _ = cancel.cancelled() => {
                kill_process_tree(pid).await;
                return Err(AppError::new(ErrorCode::Cancelled, "git command cancelled")
                    .with_command(command.clone()));
            }
            result = child.wait_with_output() => {
                result.map_err(|e| {
                    AppError::new(ErrorCode::Internal, format!("git wait failed: {e}"))
                        .with_command(command.clone())
                })?
            }
            _ = tokio::time::sleep(timeout) => {
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
    // Env already set; keep a hook for future -c injection based on OpKind.
    let _ = (cmd, kind);
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
    #[cfg(windows)]
    {
        // M0 stub: taskkill /T. Full Job Object integration lands with Windows CI.
        let mut kill = tokio::process::Command::new("taskkill");
        kill.args(["/PID", &pid.to_string(), "/T", "/F"]);
        crate::process_win::hide_console_tokio(&mut kill);
        let _ = kill.status().await;
    }
    let _ = pid;
    warn!(pid, "cancelled git process tree");
}
