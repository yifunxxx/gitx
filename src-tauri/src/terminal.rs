//! Interactive PTYs with bounded output and explicit window ownership.
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};

const BUFFER_LIMIT: usize = 128 * 1024;
const READ_LIMIT: usize = 64 * 1024;
const SESSION_LIMIT: usize = 16;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum TerminalShell {
    Default,
    Powershell,
    Cmd,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub id: String,
    pub cwd: String,
    pub shell: String,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub data: Vec<u8>,
    pub exited: bool,
    pub exit_code: Option<u32>,
    pub error: Option<String>,
}

#[derive(Default)]
struct OutputState {
    chunks: VecDeque<Vec<u8>>,
    bytes: usize,
    exited: bool,
    exit_code: Option<u32>,
    process_done: bool,
    error: Option<String>,
}

#[derive(Default)]
struct OutputQueue {
    state: Mutex<OutputState>,
    changed: Condvar,
}

impl OutputQueue {
    fn push(&self, data: &[u8]) -> bool {
        let mut state = self.state.lock().unwrap();
        while !state.exited && state.bytes + data.len() > BUFFER_LIMIT {
            state = self.changed.wait(state).unwrap();
        }
        if state.exited {
            return false;
        }
        state.bytes += data.len();
        state.chunks.push_back(data.to_vec());
        self.changed.notify_all();
        true
    }

    fn finish(&self, code: Option<u32>, error: Option<String>) {
        let mut state = self.state.lock().unwrap();
        state.exited = true;
        state.exit_code = code;
        state.error = error;
        self.changed.notify_all();
    }

    fn read(&self) -> TerminalOutput {
        let mut state = self.state.lock().unwrap();
        while state.chunks.is_empty() && !state.exited {
            state = self.changed.wait(state).unwrap();
        }
        let mut data = Vec::with_capacity(state.bytes.min(READ_LIMIT));
        while let Some(chunk) = state.chunks.front() {
            if data.len() + chunk.len() > READ_LIMIT {
                break;
            }
            let chunk = state.chunks.pop_front().unwrap();
            state.bytes -= chunk.len();
            data.extend(chunk);
        }
        self.changed.notify_all();
        TerminalOutput {
            data,
            exited: state.exited && state.chunks.is_empty(),
            exit_code: state.exit_code,
            error: state.error.clone(),
        }
    }
}

pub struct TerminalSession {
    owner: String,
    output: Arc<OutputQueue>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl TerminalSession {
    pub fn read(&self) -> TerminalOutput {
        self.output.read()
    }

    pub fn write(&self, data: &str) -> Result<(), String> {
        if data.len() > READ_LIMIT {
            return Err("Terminal input exceeds 64 KiB".into());
        }
        let mut writer = self.writer.lock().unwrap();
        let writer = writer.as_mut().ok_or("Terminal is closed")?;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let size = terminal_size(cols, rows)?;
        let master = self.master.lock().unwrap();
        master
            .as_ref()
            .ok_or("Terminal is closed")?
            .resize(size)
            .map_err(|e| e.to_string())
    }

    fn stop(&self) {
        // Wake both an idle consumer and a producer blocked by backpressure.
        self.output.finish(None, None);
        let _ = self.killer.lock().unwrap().kill();
        self.writer.lock().unwrap().take();
        // Closing ConPTY also releases attached console processes. Do this on a
        // worker, never the WebView/UI thread (ClosePseudoConsole may wait).
        self.master.lock().unwrap().take();
    }
}

#[derive(Default)]
struct Registry {
    sessions: HashMap<String, Arc<TerminalSession>>,
    stopped: bool,
}

#[derive(Default)]
pub struct TerminalManager(Mutex<Registry>);

impl TerminalManager {
    pub fn open(
        &self,
        owner: String,
        cwd: &Path,
        shell: TerminalShell,
        cols: u16,
        rows: u16,
    ) -> Result<TerminalInfo, String> {
        let size = terminal_size(cols, rows)?;
        if !cwd.is_absolute() || !cwd.is_dir() {
            return Err("Terminal working directory must be an existing absolute directory".into());
        }
        let (mut command, label) = shell_command(shell)?;
        command.cwd(cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TERM_PROGRAM", "gitx");
        let mut registry = self.0.lock().unwrap();
        if registry.stopped {
            return Err("Terminal manager is shutting down".into());
        }
        if registry.sessions.len() >= SESSION_LIMIT {
            return Err("Close a terminal before opening more (maximum 16)".into());
        }
        let pair = native_pty_system()
            .openpty(size)
            .map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| e.to_string())?;
        drop(pair.slave);
        let output = Arc::new(OutputQueue::default());
        let session = Arc::new(TerminalSession {
            owner,
            output: output.clone(),
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(Some(writer)),
            killer: Mutex::new(child.clone_killer()),
        });
        let worker = std::thread::Builder::new()
            .name("gitx-terminal-output".into())
            .spawn(move || {
                let mut buffer = [0; 8192];
                let mut error = None;
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(count) if !output.push(&buffer[..count]) => break,
                        Ok(_) => {}
                        // PTYs on Unix report EIO when the slave closes.
                        Err(e) if cfg!(unix) && e.raw_os_error() == Some(5) => break,
                        Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => break,
                        Err(e) => {
                            error = Some(e.to_string());
                            break;
                        }
                    }
                }
                drop(reader);
                let code = {
                    let mut state = output.state.lock().unwrap();
                    while !state.process_done && !state.exited {
                        state = output.changed.wait(state).unwrap();
                    }
                    state.exit_code
                };
                output.finish(code, error);
            });
        if let Err(error) = worker {
            session.stop();
            let _ = child.wait();
            return Err(error.to_string());
        }
        let waiting = session.clone();
        let waiter = std::thread::Builder::new()
            .name("gitx-terminal-wait".into())
            .spawn(move || {
                let code = child.wait().ok().map(|status| status.exit_code());
                {
                    let mut state = waiting.output.state.lock().unwrap();
                    state.exit_code = code;
                    state.process_done = true;
                    waiting.output.changed.notify_all();
                }
                waiting.writer.lock().unwrap().take();
                // ConPTY can keep its output pipe open after the shell exits.
                // Closing the master on a separate thread lets the reader drain
                // the final screen updates before reporting EOF to the frontend.
                waiting.master.lock().unwrap().take();
            });
        if let Err(error) = waiter {
            session.stop();
            return Err(error.to_string());
        }
        let id = uuid::Uuid::new_v4().to_string();
        registry.sessions.insert(id.clone(), session);
        Ok(TerminalInfo {
            id,
            cwd: cwd.to_string_lossy().into_owned(),
            shell: label,
        })
    }

    pub fn get(&self, owner: &str, id: &str) -> Result<Arc<TerminalSession>, String> {
        let registry = self.0.lock().unwrap();
        registry
            .sessions
            .get(id)
            .filter(|session| session.owner == owner)
            .cloned()
            .ok_or_else(|| "Terminal session is closed or belongs to another window".into())
    }

    pub fn close(&self, owner: &str, id: &str) -> Result<(), String> {
        let session = {
            let mut registry = self.0.lock().unwrap();
            if let Some(session) = registry.sessions.get(id) {
                if session.owner != owner {
                    return Err("Terminal belongs to another window".into());
                }
            }
            registry.sessions.remove(id)
        };
        if let Some(session) = session {
            session.stop();
        }
        Ok(())
    }

    pub fn shutdown(&self) {
        let sessions = {
            let mut registry = self.0.lock().unwrap();
            registry.stopped = true;
            registry
                .sessions
                .drain()
                .map(|(_, session)| session)
                .collect::<Vec<_>>()
        };
        for session in sessions {
            session.stop();
        }
    }
}

fn terminal_size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(2..=500).contains(&cols) || !(1..=300).contains(&rows) {
        return Err("Invalid terminal dimensions".into());
    }
    Ok(PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn shell_command(shell: TerminalShell) -> Result<(CommandBuilder, String), String> {
    #[cfg(windows)]
    {
        let system = std::env::var_os("SystemRoot").ok_or("SystemRoot is unavailable")?;
        let system = Path::new(&system).join("System32");
        let (path, label, args) = match shell {
            TerminalShell::Cmd => (system.join("cmd.exe"), "Command Prompt", vec!["/D"]),
            _ => (
                system.join("WindowsPowerShell/v1.0/powershell.exe"),
                "PowerShell",
                vec!["-NoLogo"],
            ),
        };
        let mut command = CommandBuilder::new(path);
        command.args(args);
        Ok((command, label.into()))
    }
    #[cfg(not(windows))]
    {
        if !matches!(shell, TerminalShell::Default) {
            return Err("This shell is only available on Windows".into());
        }
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        if !Path::new(&shell).is_absolute() {
            return Err("SHELL must be an absolute path".into());
        }
        let label = Path::new(&shell)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let mut command = CommandBuilder::new(shell);
        command.arg("-l");
        Ok((command, label))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn output_is_bounded_ordered_and_unblocks_on_close() {
        let output = Arc::new(OutputQueue::default());
        let bytes = vec![7; 8192];
        for _ in 0..16 {
            assert!(output.push(&bytes));
        }
        let producer = output.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            tx.send(producer.push(&[8; 8192])).unwrap();
        });
        assert!(rx.recv_timeout(Duration::from_millis(30)).is_err());
        let read = output.read();
        assert_eq!(read.data, vec![7; READ_LIMIT]);
        assert!(rx.recv_timeout(Duration::from_secs(2)).unwrap());
        worker.join().unwrap();
        output.finish(Some(0), None);
        assert!(!output.read().exited);
        let tail = output.read();
        assert_eq!(tail.data, vec![8; 8192]);
        assert!(tail.exited);
        assert_eq!(tail.exit_code, Some(0));
        assert!(!output.push(&[1]));
    }

    #[test]
    fn closing_wakes_a_producer_at_the_limit() {
        let output = Arc::new(OutputQueue::default());
        for _ in 0..16 {
            output.push(&[0; 8192]);
        }
        let producer = output.clone();
        let worker = std::thread::spawn(move || producer.push(&[1]));
        output.finish(None, None);
        assert!(!worker.join().unwrap());
    }

    #[test]
    fn rejects_invalid_startup_and_shutdown_rejects_new_sessions() {
        let manager = TerminalManager::default();
        assert!(manager
            .open(
                "main".into(),
                Path::new("relative"),
                TerminalShell::Default,
                80,
                24
            )
            .is_err());
        assert!(terminal_size(0, 24).is_err());
        assert!(terminal_size(80, 301).is_err());
        manager.shutdown();
        assert!(manager
            .open(
                "main".into(),
                &std::env::temp_dir(),
                TerminalShell::Default,
                80,
                24
            )
            .is_err());
    }

    #[test]
    fn interactive_shell_preserves_cwd_streams_output_resizes_and_exits() {
        let cwd = tempfile::Builder::new()
            .prefix("gitx terminal 中文 ")
            .tempdir()
            .unwrap();
        let manager = TerminalManager::default();
        let shell = if cfg!(windows) {
            TerminalShell::Cmd
        } else {
            TerminalShell::Default
        };
        let info = manager
            .open("main".into(), cwd.path(), shell, 80, 24)
            .unwrap();
        assert!(manager.get("other-window", &info.id).is_err());
        assert!(manager.close("other-window", &info.id).is_err());
        let session = manager.get("main", &info.id).unwrap();
        session.resize(100, 30).unwrap();
        assert_eq!(
            session
                .master
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .get_size()
                .unwrap()
                .cols,
            100
        );
        let reading = session.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            loop {
                let output = reading.read();
                if output.data.windows(4).any(|chunk| chunk == b"\x1b[6n") {
                    let _ = reading.write("\x1b[1;1R");
                }
                bytes.extend(output.data);
                if output.exited {
                    let _ = tx.send((bytes, output.exit_code));
                    break;
                }
            }
        });
        session
            .write(if cfg!(windows) {
                "echo GITX_PTY_OK\rcd\rexit 7\r"
            } else {
                "echo GITX_PTY_OK; pwd; exit 7\n"
            })
            .unwrap();
        let result = rx.recv_timeout(Duration::from_secs(15));
        manager.close("main", &info.id).unwrap();
        let (bytes, code) = result.expect("terminal must drain and finish after shell exit");
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("GITX_PTY_OK"), "{text}");
        assert!(text.contains("gitx terminal"), "{text}");
        assert_eq!(code, Some(7));
        manager.close("main", &info.id).unwrap();
    }

    #[test]
    fn closing_a_live_shell_unblocks_idle_reads_and_releases_resources() {
        let manager = Arc::new(TerminalManager::default());
        let cwd = tempfile::tempdir().unwrap();
        let shell = if cfg!(windows) {
            TerminalShell::Cmd
        } else {
            TerminalShell::Default
        };
        let info = manager
            .open("main".into(), cwd.path(), shell, 80, 24)
            .unwrap();
        let session = manager.get("main", &info.id).unwrap();
        let reading = session.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            loop {
                let output = reading.read();
                if output.data.windows(4).any(|chunk| chunk == b"\x1b[6n") {
                    let _ = reading.write("\x1b[1;1R");
                }
                if output.exited {
                    break;
                }
            }
            tx.send(()).unwrap();
        });
        manager.close("main", &info.id).unwrap();
        rx.recv_timeout(Duration::from_secs(3))
            .expect("close must wake pending read");
        assert!(session.master.lock().unwrap().is_none());
        assert!(session.writer.lock().unwrap().is_none());
        assert!(manager.get("main", &info.id).is_err());
    }
}
