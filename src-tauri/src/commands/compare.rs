use crate::state::AppState;
use gitx_core::{
    AppError, CombinedDiffFile, CombinedDiffResult, DiffFileResult, DiffRefsResult, ErrorCode,
    IgnoreWhitespace,
};
use gitx_diff::{compute_hunks, decode_lossy, is_probably_binary, too_large, DiffComputeOptions};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffRefsReq {
    pub repo_id: String,
    pub path: String,
    pub left: String,
    pub right: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileAtReq {
    pub repo_id: String,
    pub path: String,
    pub file_path: String,
    /// Revision / side: HEAD | INDEX | WORKTREE | <sha-or-ref>
    pub left_rev: String,
    pub right_rev: String,
    /// Optional rename-follow path on the left side.
    #[serde(default)]
    pub left_path: Option<String>,
    #[serde(default)]
    pub right_path: Option<String>,
    #[serde(default)]
    pub ignore_whitespace: IgnoreWhitespace,
    /// When false, omit full file texts (collapsed Diff only needs hunks).
    #[serde(default = "default_include_texts_at")]
    pub include_texts: bool,
}

fn default_include_texts_at() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CombinedDiffReq {
    pub repo_id: String,
    pub path: String,
    /// Commit sha, or left..right for range; empty right means commit vs its first parent / empty tree.
    pub left: String,
    #[serde(default)]
    pub right: Option<String>,
    #[serde(default)]
    pub ignore_whitespace: IgnoreWhitespace,
    #[serde(default = "default_combined_limit")]
    pub limit: u32,
}

fn default_combined_limit() -> u32 {
    50
}

#[tauri::command]
#[specta::specta]
pub async fn diff_refs(
    state: State<'_, AppState>,
    req: DiffRefsReq,
) -> Result<DiffRefsResult, AppError> {
    let cwd = PathBuf::from(&req.path);
    if req.left.is_empty() {
        return Err(AppError::new(ErrorCode::FsError, "left revision required"));
    }
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let mut left = req.left.clone();
    let mut right = req.right.clone();
    // Prefer older → newer when both look like commits with known times (best-effort Swap).
    if !right.eq_ignore_ascii_case("WORKTREE")
        && !right.is_empty()
        && looks_like_rev(&left)
        && looks_like_rev(&right)
    {
        if let (Ok(lt), Ok(rt)) = (
            rev_time(&git, &cwd, &left, &cancel).await,
            rev_time(&git, &cwd, &right, &cancel).await,
        ) {
            if lt > rt {
                std::mem::swap(&mut left, &mut right);
            }
        }
    }
    let files = git
        .diff_refs_name_status(&cwd, &left, &right, &cancel)
        .await?;
    Ok(DiffRefsResult { left, right, files })
}

#[tauri::command]
#[specta::specta]
pub async fn diff_file_at(
    state: State<'_, AppState>,
    req: DiffFileAtReq,
) -> Result<DiffFileResult, AppError> {
    let cwd = PathBuf::from(&req.path);
    if req.file_path.is_empty() {
        return Err(AppError::new(ErrorCode::FsError, "empty file path"));
    }
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let left_path = req
        .left_path
        .clone()
        .unwrap_or_else(|| req.file_path.clone());
    let right_path = req
        .right_path
        .clone()
        .unwrap_or_else(|| req.file_path.clone());
    let left_rev = req.left_rev.clone();
    let right_rev = req.right_rev.clone();

    let (left_bytes, right_bytes) = tokio::try_join!(
        git.read_blob_at(&cwd, &left_rev, &left_path, &cancel),
        git.read_blob_at(&cwd, &right_rev, &right_path, &cancel),
    )?;

    let binary = left_bytes.as_ref().is_some_and(|b| is_probably_binary(b))
        || right_bytes.as_ref().is_some_and(|b| is_probably_binary(b));
    let large = too_large(left_bytes.as_deref()) || too_large(right_bytes.as_deref());
    let left_label = rev_label(&req.left_rev);
    let right_label = rev_label(&req.right_rev);

    if binary || large {
        return Ok(DiffFileResult {
            path: req.file_path,
            left_label,
            right_label,
            left_text: None,
            right_text: None,
            binary,
            too_large: large,
            hunks: Vec::new(),
            encoding: "utf-8".into(),
        });
    }

    let left_text = decode_lossy(left_bytes.as_deref());
    let right_text = decode_lossy(right_bytes.as_deref());
    let ignore = req.ignore_whitespace;
    let left_for_diff = left_text.clone();
    let right_for_diff = right_text.clone();
    let hunks = tokio::task::spawn_blocking(move || {
        compute_hunks(
            left_for_diff.as_deref(),
            right_for_diff.as_deref(),
            &DiffComputeOptions {
                ignore_whitespace: ignore,
            },
        )
    })
    .await
    .map_err(|e| AppError::new(ErrorCode::Internal, format!("diff join: {e}")))?;

    Ok(DiffFileResult {
        path: req.file_path,
        left_label,
        right_label,
        left_text: if req.include_texts { left_text } else { None },
        right_text: if req.include_texts { right_text } else { None },
        binary: false,
        too_large: false,
        hunks,
        encoding: "utf-8".into(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn diff_combined(
    state: State<'_, AppState>,
    req: CombinedDiffReq,
) -> Result<CombinedDiffResult, AppError> {
    let cwd = PathBuf::from(&req.path);
    let git = state.git.read().await;
    let cancel = CancellationToken::new();
    let left = req.left.clone();
    let right = req
        .right
        .clone()
        .unwrap_or_else(|| format!("{}^", req.left));

    let files = git
        .diff_refs_name_status(&cwd, &right, &left, &cancel)
        .await?;
    let limit = req.limit.clamp(1, 200) as usize;
    let mut out_files = Vec::new();
    for f in files.into_iter().take(limit) {
        let left_path = f.orig_path.as_deref().unwrap_or(&f.path);
        let left_bytes = git
            .read_blob_at(&cwd, &right, left_path, &cancel)
            .await
            .unwrap_or(None);
        let right_bytes = git
            .read_blob_at(&cwd, &left, &f.path, &cancel)
            .await
            .unwrap_or(None);
        let binary = left_bytes.as_ref().is_some_and(|b| is_probably_binary(b))
            || right_bytes.as_ref().is_some_and(|b| is_probably_binary(b));
        let hunks =
            if binary || too_large(left_bytes.as_deref()) || too_large(right_bytes.as_deref()) {
                Vec::new()
            } else {
                compute_hunks(
                    decode_lossy(left_bytes.as_deref()).as_deref(),
                    decode_lossy(right_bytes.as_deref()).as_deref(),
                    &DiffComputeOptions {
                        ignore_whitespace: req.ignore_whitespace,
                    },
                )
            };
        out_files.push(CombinedDiffFile {
            path: f.path,
            status: f.status,
            orig_path: f.orig_path,
            hunks,
            binary,
        });
    }

    Ok(CombinedDiffResult {
        left,
        right,
        files: out_files,
    })
}

fn rev_label(rev: &str) -> String {
    if rev.eq_ignore_ascii_case("WORKTREE") {
        "Local".into()
    } else if rev.eq_ignore_ascii_case("INDEX") || rev == ":0" {
        "Staged".into()
    } else if rev.eq_ignore_ascii_case("HEAD") {
        "HEAD".into()
    } else if rev.len() > 12 {
        format!("{}…", rev.chars().take(7).collect::<String>())
    } else {
        rev.to_string()
    }
}

fn looks_like_rev(s: &str) -> bool {
    !s.is_empty() && !s.eq_ignore_ascii_case("WORKTREE") && !s.eq_ignore_ascii_case("INDEX")
}

async fn rev_time(
    git: &gitx_git::GitRunner,
    cwd: &std::path::Path,
    rev: &str,
    cancel: &CancellationToken,
) -> Result<i64, AppError> {
    let details = git.log_commit_details(cwd, rev, cancel).await?;
    Ok(details.author_time)
}
