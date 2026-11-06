use serde::{Deserialize, Serialize};
use specta::Type;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    GitNotFound,
    GitTooOld,
    NotARepository,
    RepoNotFound,
    IndexLocked,
    Cancelled,
    Timeout,
    FsError,
    Internal,
    GitCommandFailed,
    NothingToCommit,
    EmptyCommitMessage,
    HookFailed,
    UnsafeRepository,
    AlreadyRepository,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RecoverAction {
    Retry,
    OpenConsole,
    ShowDetails,
    RemoveLock,
}

#[derive(Debug, Clone, Error, Serialize, Deserialize, Type)]
#[error("{message}")]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recover: Vec<RecoverAction>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            args: None,
            git_stderr: None,
            command: None,
            exit_code: None,
            recover: Vec::new(),
        }
    }

    pub fn with_command(mut self, command: impl Into<String>) -> Self {
        self.command = Some(command.into());
        self
    }

    pub fn with_stderr(mut self, stderr: impl Into<String>) -> Self {
        self.git_stderr = Some(stderr.into());
        self
    }

    pub fn with_exit_code(mut self, code: i32) -> Self {
        self.exit_code = Some(code);
        self
    }

    pub fn with_recover(mut self, actions: Vec<RecoverAction>) -> Self {
        self.recover = actions;
        self
    }
}
