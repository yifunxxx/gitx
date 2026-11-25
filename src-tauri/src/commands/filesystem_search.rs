use super::filesystem::{filter_ignored_cancel, read_dir_entries, FsEntryKind, FsReadDirReq};
use crate::state::AppState;
use gitx_core::{AppError, ErrorCode};
use gitx_git::GitRunner;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsSearchReq {
    pub folder_path: String,
    pub query: String,
    pub show_hidden: bool,
    pub show_ignored: bool,
    pub session_id: String,
    pub generation: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsCancelSearchReq {
    pub session_id: String,
    pub generation: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsSearchMatch {
    pub path: String,
    pub score: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsSearchResult {
    pub matches: Vec<FsSearchMatch>,
    pub scanned: u32,
    pub skipped: u32,
    pub truncated: bool,
}

struct SearchSession {
    generation: u32,
    cancel: CancellationToken,
    touched: Instant,
}
fn sessions() -> &'static Mutex<HashMap<String, SearchSession>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, SearchSession>>> = OnceLock::new();
    SESSIONS.get_or_init(Mutex::default)
}
fn error(message: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::FsError, message.to_string())
}
fn cancelled() -> AppError {
    AppError::new(ErrorCode::Cancelled, "search cancelled")
}
fn prune(sessions: &mut HashMap<String, SearchSession>) {
    sessions.retain(|_, old| {
        let keep = old.touched.elapsed() < Duration::from_secs(300);
        if !keep {
            old.cancel.cancel();
        }
        keep
    });
    if sessions.len() >= 64 {
        if let Some(id) = sessions
            .iter()
            .min_by_key(|(_, old)| old.touched)
            .map(|(id, _)| id.clone())
        {
            if let Some(old) = sessions.remove(&id) {
                old.cancel.cancel();
            }
        }
    }
}
fn begin(session: &str, generation: u32) -> Result<CancellationToken, AppError> {
    if session.is_empty() || session.len() > 128 {
        return Err(error("invalid search session"));
    }
    let mut sessions = sessions().lock().map_err(error)?;
    if sessions
        .get(session)
        .is_some_and(|old| old.generation >= generation)
    {
        return Err(cancelled());
    }
    if let Some(old) = sessions.remove(session) {
        old.cancel.cancel();
    }
    // Keep cancellation tombstones briefly, so an IPC already queued when the
    // dialog closed cannot start a new scan after the cancellation arrives.
    prune(&mut sessions);
    let cancel = CancellationToken::new();
    sessions.insert(
        session.into(),
        SearchSession {
            generation,
            cancel: cancel.clone(),
            touched: Instant::now(),
        },
    );
    Ok(cancel)
}

#[tauri::command]
#[specta::specta]
pub fn fs_cancel_search(req: FsCancelSearchReq) -> Result<(), AppError> {
    if req.session_id.is_empty() || req.session_id.len() > 128 {
        return Err(error("invalid search session"));
    }
    let mut sessions = sessions().lock().map_err(error)?;
    if let Some(old) = sessions.get(&req.session_id) {
        if old.generation > req.generation {
            return Ok(());
        }
        old.cancel.cancel();
    }
    sessions.remove(&req.session_id);
    prune(&mut sessions);
    let cancel = CancellationToken::new();
    cancel.cancel();
    sessions.insert(
        req.session_id,
        SearchSession {
            generation: req.generation,
            cancel,
            touched: Instant::now(),
        },
    );
    Ok(())
}

/// Lower is better: prefer contiguous basenames, then basename subsequences,
/// then path subsequences. Unicode characters, not bytes, define positions.
fn fuzzy_score(path: &str, query: &str) -> Option<u32> {
    let path = path.to_lowercase();
    let query = query.to_lowercase().replace('\\', "/");
    let name = path.rsplit('/').next().unwrap_or(&path);
    if name == query {
        return Some(0);
    }
    if let Some(index) = name.find(&query) {
        return Some(10 + index as u32);
    }
    fn subsequence(text: &str, query: &str) -> Option<u32> {
        let mut wanted = query.chars().peekable();
        let mut score = 0;
        let mut previous = None;
        for (index, ch) in text.chars().enumerate() {
            if wanted.peek() == Some(&ch) {
                wanted.next();
                score += previous.map_or(index, |old| index - old - 1) as u32;
                previous = Some(index);
                if wanted.peek().is_none() {
                    return Some(score);
                }
            }
        }
        None
    }
    subsequence(name, &query)
        .map(|score| 100 + score)
        .or_else(|| subsequence(&path, &query).map(|score| 1000 + score))
}

async fn search_files(
    req: FsSearchReq,
    git: &GitRunner,
    cancel: &CancellationToken,
) -> Result<FsSearchResult, AppError> {
    let query = req.query.trim();
    if query.is_empty() {
        return Ok(FsSearchResult::default());
    }
    if query.len() > 1024 {
        return Err(error("search query is too long"));
    }
    let mut pending = VecDeque::from([String::new()]);
    let mut visited = HashSet::new();
    let mut result = FsSearchResult::default();
    let start = Instant::now();
    while let Some(dir) = pending.pop_front() {
        if cancel.is_cancelled() {
            return Err(cancelled());
        }
        if start.elapsed() > Duration::from_secs(15)
            || result.scanned >= 100_000
            || visited.len() >= 10_000
        {
            result.truncated = true;
            break;
        }
        let list_req = FsReadDirReq {
            folder_path: req.folder_path.clone(),
            dir: dir.clone(),
            show_ignored: req.show_ignored,
            show_hidden: req.show_hidden,
        };
        let loaded = tokio::task::spawn_blocking(move || read_dir_entries(&list_req))
            .await
            .map_err(error)?;
        let (directory, mut entries) = match loaded {
            Ok(value) => value,
            Err(error) if dir.is_empty() => return Err(error),
            Err(_) => {
                result.skipped += 1;
                continue;
            }
        };
        if !visited.insert(directory.clone()) {
            continue;
        }
        if !req.show_ignored {
            filter_ignored_cancel(git, &directory, &mut entries, cancel).await?;
        }
        for entry in entries {
            if cancel.is_cancelled() {
                return Err(cancelled());
            }
            if entry.name.eq_ignore_ascii_case(".git") || entry.name.starts_with(".gitx-copy-") {
                continue;
            }
            result.scanned += 1;
            if entry.kind == FsEntryKind::Directory {
                if entry.path.split('/').count() < 256 {
                    pending.push_back(entry.path);
                } else {
                    result.skipped += 1;
                }
            } else if let Some(score) = fuzzy_score(&entry.path, query) {
                result.matches.push(FsSearchMatch {
                    path: entry.path,
                    score,
                });
            }
            if result.scanned >= 100_000 {
                result.truncated = true;
                break;
            }
        }
    }
    result
        .matches
        .sort_by(|a, b| a.score.cmp(&b.score).then_with(|| a.path.cmp(&b.path)));
    if result.matches.len() > 500 {
        result.truncated = true;
        result.matches.truncate(500);
    }
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn fs_search_files(
    state: State<'_, AppState>,
    req: FsSearchReq,
) -> Result<FsSearchResult, AppError> {
    let cancel = begin(&req.session_id, req.generation)?;
    let git = {
        let git = state.git.read().await;
        GitRunner {
            git_bin: git.git_bin.clone(),
            wsl_distro: git.wsl_distro.clone(),
        }
    };
    search_files(req, &git, &cancel).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn req(root: &std::path::Path, query: &str) -> FsSearchReq {
        FsSearchReq {
            folder_path: root.to_string_lossy().into_owned(),
            query: query.into(),
            show_hidden: false,
            show_ignored: false,
            session_id: "test".into(),
            generation: 1,
        }
    }
    #[test]
    fn fuzzy_matches_basename_path_and_unicode_with_stable_ranking() {
        assert!(fuzzy_score("a/FileViewer.vue", "fv").is_some());
        assert!(fuzzy_score("src/文件/内容.txt", "文件内").is_some());
        assert!(fuzzy_score("readme.md", "xyz").is_none());
        assert!(
            fuzzy_score("src/file.ts", "file").unwrap()
                < fuzzy_score("src/file-other.ts", "fle").unwrap()
        );
    }
    #[tokio::test]
    async fn searches_unopened_directories_and_honors_hidden_and_gitignore() {
        let root = tempfile::tempdir().unwrap();
        fs_init(root.path());
        std::fs::create_dir(root.path().join("nested")).unwrap();
        std::fs::write(root.path().join("nested/needle.txt"), "text").unwrap();
        std::fs::write(root.path().join(".needle"), "hidden").unwrap();
        std::fs::write(root.path().join("needle.log"), "ignored").unwrap();
        std::fs::write(root.path().join(".gitignore"), "*.log\n").unwrap();
        let git = GitRunner::default();
        let mut request = req(root.path(), "ndl");
        let result = search_files(request.clone(), &git, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(
            result
                .matches
                .iter()
                .map(|m| m.path.as_str())
                .collect::<Vec<_>>(),
            ["nested/needle.txt"]
        );
        request.show_hidden = true;
        request.show_ignored = true;
        assert_eq!(
            search_files(request, &git, &CancellationToken::new())
                .await
                .unwrap()
                .matches
                .len(),
            3
        );
    }
    fn fs_init(path: &std::path::Path) {
        assert!(std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(path)
            .status()
            .unwrap()
            .success());
    }
    #[tokio::test]
    async fn non_git_search_and_cancellation_do_not_require_git() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("file.txt"), "text").unwrap();
        let git = GitRunner::new("missing-git");
        let cancel = CancellationToken::new();
        assert_eq!(
            search_files(req(root.path(), "file"), &git, &cancel)
                .await
                .unwrap()
                .matches
                .len(),
            1
        );
        cancel.cancel();
        assert_eq!(
            search_files(req(root.path(), "file"), &git, &cancel)
                .await
                .unwrap_err()
                .code,
            ErrorCode::Cancelled
        );
    }
    #[test]
    fn newer_search_and_cancel_reject_older_queued_requests() {
        let id = uuid::Uuid::new_v4().to_string();
        let old = begin(&id, 1).unwrap();
        let new = begin(&id, 2).unwrap();
        assert!(old.is_cancelled());
        assert!(begin(&id, 1).is_err());
        fs_cancel_search(FsCancelSearchReq {
            session_id: id.clone(),
            generation: 3,
        })
        .unwrap();
        assert!(new.is_cancelled());
        assert!(begin(&id, 3).is_err());
        assert!(!begin(&id, 4).unwrap().is_cancelled());
    }
}
