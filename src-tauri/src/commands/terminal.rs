use crate::state::AppState;
use crate::terminal::{TerminalInfo, TerminalOutput, TerminalShell};
use gitx_core::{AppError, ErrorCode};
use serde::Deserialize;
use specta::Type;
use std::path::Path;
use tauri::{State, WebviewWindow};

#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOpenReq {
    pub cwd: String,
    pub shell: TerminalShell,
    pub cols: u16,
    pub rows: u16,
}
#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteReq {
    pub id: String,
    pub data: String,
}
#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeReq {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}
fn error(error: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::Internal, format!("Terminal: {error}"))
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_open(
    window: WebviewWindow,
    state: State<'_, AppState>,
    req: TerminalOpenReq,
) -> Result<TerminalInfo, AppError> {
    let terminals = state.terminals.clone();
    let owner = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        terminals.open(owner, Path::new(&req.cwd), req.shell, req.cols, req.rows)
    })
    .await
    .map_err(error)?
    .map_err(error)
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_read(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<TerminalOutput, AppError> {
    let session = state.terminals.get(window.label(), &id).map_err(error)?;
    tauri::async_runtime::spawn_blocking(move || session.read())
        .await
        .map_err(error)
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_write(
    window: WebviewWindow,
    state: State<'_, AppState>,
    req: TerminalWriteReq,
) -> Result<(), AppError> {
    let session = state
        .terminals
        .get(window.label(), &req.id)
        .map_err(error)?;
    tauri::async_runtime::spawn_blocking(move || session.write(&req.data))
        .await
        .map_err(error)?
        .map_err(error)
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_resize(
    window: WebviewWindow,
    state: State<'_, AppState>,
    req: TerminalResizeReq,
) -> Result<(), AppError> {
    let session = state
        .terminals
        .get(window.label(), &req.id)
        .map_err(error)?;
    tauri::async_runtime::spawn_blocking(move || session.resize(req.cols, req.rows))
        .await
        .map_err(error)?
        .map_err(error)
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_close(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let terminals = state.terminals.clone();
    let owner = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || terminals.close(&owner, &id))
        .await
        .map_err(error)?
        .map_err(error)
}
