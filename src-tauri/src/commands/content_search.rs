//! Saved-text search. Scans run off the IPC thread; results live in a temporary
//! spool, so neither a large workspace nor many matches require one huge IPC.
use super::{
    filesystem::resolve_entry,
    filesystem_search::{begin, FsCancelSearchReq},
};
use gitx_core::{AppError, ErrorCode};
use globset::{Glob, GlobSet, GlobSetBuilder};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::File,
    io::{BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write},
    path::Path,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tempfile::NamedTempFile;
use tokio_util::sync::CancellationToken;

const PAGE: usize = 200;
fn err(e: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::FsError, e.to_string())
}
fn check(cancel: &CancellationToken) -> Result<(), AppError> {
    if cancel.is_cancelled() {
        Err(AppError::new(ErrorCode::Cancelled, "Search cancelled"))
    } else {
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchReq {
    pub folder_path: String,
    pub query: String,
    pub replacement: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
    pub include: String,
    pub exclude: String,
    pub show_hidden: bool,
    pub show_ignored: bool,
    pub session_id: String,
    pub generation: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchPageReq {
    pub session_id: String,
    pub generation: u32,
    pub page: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ContentMatch {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub preview: String,
    pub match_start: u32,
    pub match_end: u32,
    pub replacement_preview: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchPage {
    pub matches: Vec<ContentMatch>,
    pub total: u32,
    pub files: u32,
    pub scanned: u32,
    pub skipped: u32,
    pub issues: Vec<String>,
    pub done: bool,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ContentReplaceReq {
    pub session_id: String,
    pub generation: u32,
    pub excluded_paths: Vec<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ContentReplaceResult {
    pub completed: Vec<String>,
    pub failed: Vec<String>,
}
struct Progress {
    spool: BufWriter<NamedTempFile>,
    pages: Vec<u64>,
    bytes: u64,
    total: u32,
    scanned: u32,
    skipped: u32,
    issues: Vec<String>,
    done: bool,
    stopped: bool,
    error: Option<String>,
    hashes: BTreeMap<String, Vec<u8>>,
    replacing: bool,
    replaced: bool,
}
struct Search {
    req: ContentSearchReq,
    cancel: CancellationToken,
    progress: Mutex<Progress>,
    touched: Mutex<Instant>,
}
fn sessions() -> &'static Mutex<HashMap<String, Arc<Search>>> {
    static S: OnceLock<Mutex<HashMap<String, Arc<Search>>>> = OnceLock::new();
    S.get_or_init(Mutex::default)
}
pub(super) fn cancel_session(id: &str, generation: u32) {
    if let Ok(mut jobs) = sessions().lock() {
        if jobs
            .get(id)
            .is_some_and(|job| job.req.generation <= generation)
        {
            if let Some(job) = jobs.remove(id) {
                job.cancel.cancel();
            }
        }
    }
}
pub(super) fn stop_session(id: &str, generation: u32) -> Result<bool, AppError> {
    let jobs = sessions().lock().map_err(err)?;
    let Some(job) = jobs.get(id).filter(|job| job.req.generation == generation) else {
        return Ok(false);
    };
    job.progress.lock().map_err(err)?.stopped = true;
    job.cancel.cancel();
    Ok(true)
}

/// Stop scanning while retaining completed files' results for paging. Closing
/// the dialog or starting a new query still uses fs_cancel_search to release them.
#[tauri::command]
#[specta::specta]
pub fn fs_stop_content_search(req: FsCancelSearchReq) -> Result<bool, AppError> {
    super::filesystem_search::cancel_search(req, true)
}

fn get(id: &str, generation: u32) -> Result<Arc<Search>, AppError> {
    super::filesystem_search::touch(id, generation);
    let jobs = sessions().lock().map_err(err)?;
    let job = jobs
        .get(id)
        .filter(|s| s.req.generation == generation)
        .ok_or_else(|| err("Search expired; search again"))?
        .clone();
    *job.touched.lock().map_err(err)? = Instant::now();
    Ok(job)
}
fn pattern(req: &ContentSearchReq) -> Result<Regex, AppError> {
    if req.query.is_empty() {
        return Err(err("Enter a search term"));
    }
    let source = if req.regex {
        req.query.clone()
    } else {
        regex::escape(&req.query)
    };
    let source = if req.whole_word {
        format!(r"\b(?:{source})\b")
    } else {
        source
    };
    RegexBuilder::new(&source)
        .case_insensitive(!req.case_sensitive)
        .build()
        .map_err(err)
}
fn globs(value: &str) -> Result<GlobSet, AppError> {
    let mut builder = GlobSetBuilder::new();
    for item in value.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let item = item.replace('\\', "/");
        builder.add(Glob::new(&item).map_err(err)?);
        // A bare name matches at any depth; a directory also matches descendants.
        if !item.contains('/') {
            builder.add(Glob::new(&format!("**/{item}")).map_err(err)?);
        }
        builder.add(Glob::new(&format!("{}/**", item.trim_end_matches('/'))).map_err(err)?);
        if !item.contains('/') {
            builder.add(Glob::new(&format!("**/{item}/**")).map_err(err)?);
        }
    }
    builder.build().map_err(err)
}
fn append(job: &Search, value: ContentMatch) -> Result<(), AppError> {
    check(&job.cancel)?;
    let mut p = job.progress.lock().map_err(err)?;
    let mut bytes = serde_json::to_vec(&value).map_err(err)?;
    bytes.push(b'\n');
    if (p.total as usize).is_multiple_of(PAGE) {
        let offset = p.bytes;
        p.pages.push(offset);
    }
    if let Err(e) = p.spool.write_all(&bytes) {
        p.error = Some(format!("Cannot store search results: {e}"));
        return Err(err(e));
    }
    p.bytes += bytes.len() as u64;
    p.total += 1;
    Ok(())
}
fn preview(line: &str, start: usize, end: usize, replacement: &str) -> (String, u32, u32, String) {
    let left = line[..start]
        .char_indices()
        .rev()
        .nth(60)
        .map_or(0, |(i, _)| i);
    let right = line[start..]
        .char_indices()
        .nth(180)
        .map_or(line.len(), |(i, _)| start + i);
    let prefix = if left > 0 { "…" } else { "" };
    let text = format!(
        "{prefix}{}{}",
        &line[left..right],
        if right < line.len() { "…" } else { "" }
    );
    let from = prefix.encode_utf16().count() + line[left..start].encode_utf16().count();
    let to = from + line[start..end.min(right)].encode_utf16().count();
    let after = format!(
        "{prefix}{}{}{}",
        &line[left..start],
        replacement.chars().take(240).collect::<String>(),
        line[end..].chars().take(80).collect::<String>()
    );
    (text, from as u32, to as u32, after)
}
fn scan_file(job: &Search, path: &Path, relative: &str, regex: &Regex) -> Result<(), AppError> {
    let mut lines = TextLines::new(BufReader::new(File::open(path).map_err(err)?));
    let mut hasher = Sha256::new();
    let mut line_number = 0;
    let mut found = false;
    while let Some(bytes) = lines.next(&job.cancel)? {
        hasher.update(bytes);
        line_number += 1;
        if bytes.contains(&0) {
            return Err(err("Binary file"));
        }
        let line = std::str::from_utf8(bytes)
            .map_err(|_| err("Not UTF-8 text"))?
            .trim_end_matches(['\r', '\n']);
        let bom = line_number == 1 && line.starts_with('\u{feff}');
        let line = if bom {
            &line['\u{feff}'.len_utf8()..]
        } else {
            line
        };
        let mut previous = 0;
        // File editors retain the BOM in their text buffer; keep reveal columns
        // aligned while treating the encoding marker as non-searchable metadata.
        let mut column = if bom { 2 } else { 1 };
        for caps in regex.captures_iter(line) {
            check(&job.cancel)?;
            let m = caps.get(0).unwrap();
            column += line[previous..m.start()].encode_utf16().count() as u32;
            previous = m.start();
            let mut replacement = String::new();
            if job.req.regex {
                caps.expand(&job.req.replacement, &mut replacement);
            } else {
                replacement = job.req.replacement.clone();
            }
            let (text, from, to, after) = preview(line, m.start(), m.end(), &replacement);
            append(
                job,
                ContentMatch {
                    path: relative.into(),
                    line: line_number,
                    column,
                    preview: text,
                    match_start: from,
                    match_end: to,
                    replacement_preview: after,
                },
            )?;
            found = true;
        }
    }
    if found {
        job.progress
            .lock()
            .map_err(err)?
            .hashes
            .insert(relative.into(), hasher.finalize().to_vec());
    }
    Ok(())
}

/// Stream editor lines while retaining their original separators for hashing
/// and replacement. Empty documents and a final separator each have an empty
/// last line, just as the editor does; no extra line follows unterminated text.
struct TextLines<R> {
    reader: R,
    bytes: Vec<u8>,
    finished: bool,
}
impl<R: BufRead> TextLines<R> {
    fn new(reader: R) -> Self {
        Self {
            reader,
            bytes: Vec::new(),
            finished: false,
        }
    }
    fn next(&mut self, cancel: &CancellationToken) -> Result<Option<&[u8]>, AppError> {
        check(cancel)?;
        if self.finished {
            return Ok(None);
        }
        self.bytes.clear();
        read_line(&mut self.reader, &mut self.bytes, cancel)?;
        self.finished = !matches!(self.bytes.last(), Some(b'\r' | b'\n'));
        Ok(Some(&self.bytes))
    }
}
fn read_line(
    reader: &mut impl BufRead,
    out: &mut Vec<u8>,
    cancel: &CancellationToken,
) -> Result<usize, AppError> {
    loop {
        check(cancel)?;
        let chunk = reader.fill_buf().map_err(err)?;
        if chunk.is_empty() {
            return Ok(out.len());
        }
        let end = chunk.iter().position(|b| matches!(b, b'\r' | b'\n'));
        let n = end.map_or(chunk.len(), |i| i + 1);
        out.extend_from_slice(&chunk[..n]);
        reader.consume(n);
        if end.is_some() {
            // CRLF is one editor separator even if it straddles two buffers.
            if out.last() == Some(&b'\r') {
                check(cancel)?;
                if reader.fill_buf().map_err(err)?.first() == Some(&b'\n') {
                    out.push(b'\n');
                    reader.consume(1);
                }
            }
            return Ok(out.len());
        }
    }
}
fn search_entries(
    root: &Path,
    req: &ContentSearchReq,
    exclude: GlobSet,
    cancel: CancellationToken,
) -> impl Iterator<Item = Result<ignore::DirEntry, AppError>> {
    let base = root.to_path_buf();
    let interrupt = cancel.clone();
    let mut walker = ignore::WalkBuilder::new(root)
        .hidden(!req.show_hidden)
        .ignore(!req.show_ignored)
        .git_ignore(!req.show_ignored)
        .git_global(!req.show_ignored)
        .git_exclude(!req.show_ignored)
        .follow_links(false)
        .filter_entry(move |entry| {
            // Return control from Walk::next even when all remaining entries
            // would be filtered out. The outer iterator converts this entry
            // into cancellation before it can reach the scanner.
            if interrupt.is_cancelled() {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if name.eq_ignore_ascii_case(".git")
                || name.starts_with(".gitx-copy-")
                || name.starts_with(".gitx-replace-")
            {
                return false;
            }
            // Excluded directories include their descendants (see globs).
            // Filter them before descent; include globs must not prune parents
            // that do not match yet, since matching files can be below them.
            if exclude.is_empty()
                || entry.depth() == 0
                || !entry.file_type().is_some_and(|kind| kind.is_dir())
            {
                return true;
            }
            entry
                .path()
                .strip_prefix(&base)
                .ok()
                .and_then(Path::to_str)
                .is_none_or(|path| !exclude.is_match(path.replace('\\', "/")))
        })
        .build();
    let mut finished = false;
    std::iter::from_fn(move || {
        if finished {
            return None;
        }
        let entry = if cancel.is_cancelled() {
            None
        } else {
            walker.next()
        };
        // Also check after next: it can exhaust a filtered directory without
        // yielding a result, or return an entry just as cancellation arrives.
        if let Err(error) = check(&cancel) {
            finished = true;
            return Some(Err(error));
        }
        finished = entry.is_none();
        entry.map(|entry| entry.map_err(err))
    })
}
fn scan(job: &Search) -> Result<(), AppError> {
    let regex = pattern(&job.req)?;
    let include = globs(&job.req.include)?;
    let exclude = globs(&job.req.exclude)?;
    let root = resolve_entry(&job.req.folder_path, "", true)?;
    for entry in search_entries(&root, &job.req, exclude.clone(), job.cancel.clone()) {
        check(&job.cancel)?;
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                issue(job, e.to_string());
                continue;
            }
        };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let Some(relative) = entry.path().strip_prefix(&root).ok().and_then(Path::to_str) else {
            issue(job, "Non UTF-8 path".into());
            continue;
        };
        let relative = relative.replace('\\', "/");
        if (!include.is_empty() && !include.is_match(&relative)) || exclude.is_match(&relative) {
            continue;
        }
        job.progress.lock().map_err(err)?.scanned += 1;
        let path = match resolve_entry(&job.req.folder_path, &relative, false) {
            Ok(path) => path,
            Err(e) => {
                issue(job, format!("{relative}: {}", e.message));
                continue;
            }
        };
        let (bytes, total) = {
            let p = job.progress.lock().map_err(err)?;
            (p.bytes, p.total)
        };
        if let Err(e) = scan_file(job, &path, &relative, &regex) {
            // A late invalid byte/binary marker invalidates this file, including
            // matches provisionally published while reading its earlier lines.
            {
                let mut p = job.progress.lock().map_err(err)?;
                if p.error.is_some() {
                    return Err(e);
                }
                p.spool.flush().map_err(err)?;
                p.spool
                    .get_mut()
                    .as_file_mut()
                    .set_len(bytes)
                    .map_err(err)?;
                p.spool.seek(SeekFrom::Start(bytes)).map_err(err)?;
                p.bytes = bytes;
                p.total = total;
                p.pages.truncate((total as usize).div_ceil(PAGE));
            }
            check(&job.cancel)?;
            issue(job, format!("{relative}: {}", e.message));
        }
    }
    Ok(())
}
fn issue(job: &Search, text: String) {
    if let Ok(mut p) = job.progress.lock() {
        p.skipped += 1;
        if p.issues.len() < 20 {
            p.issues.push(text);
        }
    }
}
#[tauri::command]
#[specta::specta]
pub fn fs_start_content_search(req: ContentSearchReq) -> Result<(), AppError> {
    pattern(&req)?;
    globs(&req.include)?;
    globs(&req.exclude)?;
    resolve_entry(&req.folder_path, "", true)?;
    let cancel = begin(&req.session_id, req.generation)?;
    let job = Arc::new(Search {
        req,
        cancel,
        touched: Mutex::new(Instant::now()),
        progress: Mutex::new(Progress {
            spool: BufWriter::new(NamedTempFile::new().map_err(err)?),
            pages: vec![],
            bytes: 0,
            total: 0,
            scanned: 0,
            skipped: 0,
            issues: vec![],
            done: false,
            stopped: false,
            error: None,
            hashes: BTreeMap::new(),
            replacing: false,
            replaced: false,
        }),
    });
    let mut jobs = sessions().lock().map_err(err)?;
    jobs.retain(|_, old| {
        let keep = old
            .touched
            .lock()
            .is_ok_and(|t| t.elapsed() < Duration::from_secs(1800));
        if !keep {
            old.cancel.cancel();
        }
        keep
    });
    check(&job.cancel)?;
    if jobs
        .get(&job.req.session_id)
        .is_some_and(|old| old.req.generation >= job.req.generation)
    {
        return Err(err("Search superseded"));
    }
    if jobs.len() >= 64 && !jobs.contains_key(&job.req.session_id) {
        return Err(err("Too many searches; close unused search windows"));
    }
    jobs.insert(job.req.session_id.clone(), job.clone());
    // Synchronous Tauri commands may run on the window thread, outside a
    // Tokio context. Dispatch through Tauri's runtime instead of thread-local Tokio.
    tauri::async_runtime::spawn_blocking(move || {
        let result = scan(&job);
        if let Ok(mut p) = job.progress.lock() {
            p.done = true;
            if let Err(e) = result {
                if !(p.stopped && e.code == ErrorCode::Cancelled) {
                    p.error = Some(e.message);
                }
            }
        }
    });
    Ok(())
}
#[tauri::command]
#[specta::specta]
pub async fn fs_content_search_page(
    req: ContentSearchPageReq,
) -> Result<ContentSearchPage, AppError> {
    tokio::task::spawn_blocking(move || {
        let job = get(&req.session_id, req.generation)?;
        let mut p = job.progress.lock().map_err(err)?;
        p.spool.flush().map_err(err)?;
        let mut result = ContentSearchPage {
            matches: vec![],
            total: p.total,
            files: p.hashes.len() as u32,
            scanned: p.scanned,
            skipped: p.skipped,
            issues: p.issues.clone(),
            done: p.done,
            error: p.error.clone(),
        };
        if let Some(offset) = p.pages.get(req.page as usize) {
            let mut file = File::open(p.spool.get_ref().path()).map_err(err)?;
            file.seek(SeekFrom::Start(*offset)).map_err(err)?;
            for line in BufReader::new(file).lines().take(PAGE) {
                result
                    .matches
                    .push(serde_json::from_str(&line.map_err(err)?).map_err(err)?);
            }
        }
        Ok(result)
    })
    .await
    .map_err(err)?
}
fn hash(path: &Path, cancel: &CancellationToken) -> Result<Vec<u8>, AppError> {
    let mut file = File::open(path).map_err(err)?;
    let mut bytes = [0u8; 65536];
    let mut h = Sha256::new();
    loop {
        check(cancel)?;
        let n = file.read(&mut bytes).map_err(err)?;
        if n == 0 {
            break;
        }
        h.update(&bytes[..n]);
    }
    Ok(h.finalize().to_vec())
}
fn replace_file(
    job: &Search,
    relative: &str,
    expected: &[u8],
    regex: &Regex,
) -> Result<(), AppError> {
    let path = resolve_entry(&job.req.folder_path, relative, false)?;
    let source = File::open(&path).map_err(err)?;
    let permissions = source.metadata().map_err(err)?.permissions();
    if permissions.readonly() {
        return Err(err("File is read-only"));
    }
    let mut lines = TextLines::new(BufReader::new(source));
    let mut temp = tempfile::Builder::new()
        .prefix(".gitx-replace-")
        .tempfile_in(path.parent().unwrap())
        .map_err(err)?;
    let mut h = Sha256::new();
    let mut first_line = true;
    let mut writer = BufWriter::new(temp.as_file_mut());
    while let Some(bytes) = lines.next(&job.cancel)? {
        h.update(bytes);
        let line = std::str::from_utf8(bytes).map_err(err)?;
        let line = if first_line && line.starts_with('\u{feff}') {
            writer.write_all("\u{feff}".as_bytes()).map_err(err)?;
            &line['\u{feff}'.len_utf8()..]
        } else {
            line
        };
        first_line = false;
        let body = line.trim_end_matches(['\r', '\n']);
        let ending = &line[body.len()..];
        let replaced = if job.req.regex {
            regex.replace_all(body, job.req.replacement.as_str())
        } else {
            regex.replace_all(body, regex::NoExpand(&job.req.replacement))
        };
        writer.write_all(replaced.as_bytes()).map_err(err)?;
        writer.write_all(ending.as_bytes()).map_err(err)?;
    }
    writer.flush().map_err(err)?;
    drop(writer);
    if h.finalize().as_slice() != expected || hash(&path, &job.cancel)? != expected {
        return Err(err("File changed since search; search again"));
    }
    // Re-resolve immediately before publishing to reject a changed symlink/junction.
    if resolve_entry(&job.req.folder_path, relative, false)? != path {
        return Err(err("File location changed"));
    }
    check(&job.cancel)?;
    temp.as_file().set_permissions(permissions).map_err(err)?;
    temp.as_file().sync_all().map_err(err)?;
    drop(lines);
    temp.persist(&path).map_err(err)?;
    Ok(())
}
fn replace(job: &Search, excluded: &[String]) -> Result<ContentReplaceResult, AppError> {
    let files = {
        let mut p = job.progress.lock().map_err(err)?;
        if !p.done || p.error.is_some() || p.replacing || p.replaced {
            return Err(err("Complete a fresh search before replacing"));
        }
        check(&job.cancel)?;
        p.replacing = true;
        let excluded: HashSet<_> = excluded.iter().collect();
        p.hashes
            .iter()
            .filter(|(path, _)| !excluded.contains(path))
            .map(|(p, h)| (p.clone(), h.clone()))
            .collect::<Vec<_>>()
    };
    let result = (|| {
        let regex = pattern(&job.req)?;
        // Validate the entire selection before the first write.
        for (relative, expected) in &files {
            let path = resolve_entry(&job.req.folder_path, relative, false)?;
            if hash(&path, &job.cancel)? != *expected {
                return Err(err(format!(
                    "{relative}: file changed since search; search again"
                )));
            }
        }
        let mut result = ContentReplaceResult::default();
        for (relative, expected) in files {
            match replace_file(job, &relative, &expected, &regex) {
                Ok(()) => result.completed.push(relative),
                Err(e) => {
                    result.failed.push(format!("{relative}: {}", e.message));
                    break;
                }
            }
        }
        Ok(result)
    })();
    let mut p = job.progress.lock().map_err(err)?;
    p.replacing = false;
    p.replaced = true;
    result
}
#[tauri::command]
#[specta::specta]
pub async fn fs_replace_content(req: ContentReplaceReq) -> Result<ContentReplaceResult, AppError> {
    let job = get(&req.session_id, req.generation)?;
    tokio::task::spawn_blocking(move || replace(&job, &req.excluded_paths))
        .await
        .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_command_starts_without_a_tokio_context() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a"), "hit hit").unwrap();
        let req = request(root.path(), "hit");
        assert!(tokio::runtime::Handle::try_current().is_err());
        fs_start_content_search(req.clone()).unwrap();
        let job = get(&req.session_id, req.generation).unwrap();
        let started = Instant::now();
        loop {
            if job.progress.lock().unwrap().done {
                break;
            }
            assert!(started.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(matches(&job).len(), 2);
        assert!(job.progress.lock().unwrap().error.is_none());
        cancel_session(&req.session_id, req.generation);
    }
    fn request(root: &Path, query: &str) -> ContentSearchReq {
        ContentSearchReq {
            folder_path: root.to_string_lossy().into(),
            query: query.into(),
            replacement: "new".into(),
            case_sensitive: false,
            whole_word: false,
            regex: false,
            include: String::new(),
            exclude: String::new(),
            show_hidden: false,
            show_ignored: false,
            session_id: uuid::Uuid::new_v4().to_string(),
            generation: 1,
        }
    }
    fn job(req: ContentSearchReq) -> Arc<Search> {
        Arc::new(Search {
            req,
            cancel: CancellationToken::new(),
            touched: Mutex::new(Instant::now()),
            progress: Mutex::new(Progress {
                spool: BufWriter::new(NamedTempFile::new().unwrap()),
                pages: vec![],
                bytes: 0,
                total: 0,
                scanned: 0,
                skipped: 0,
                issues: vec![],
                done: false,
                stopped: false,
                error: None,
                hashes: BTreeMap::new(),
                replacing: false,
                replaced: false,
            }),
        })
    }
    fn run(req: ContentSearchReq) -> Arc<Search> {
        let job = job(req);
        scan(&job).unwrap();
        job.progress.lock().unwrap().done = true;
        job
    }
    fn matches(job: &Search) -> Vec<ContentMatch> {
        let mut p = job.progress.lock().unwrap();
        p.spool.flush().unwrap();
        BufReader::new(File::open(p.spool.get_ref().path()).unwrap())
            .lines()
            .map(|line| serde_json::from_str(&line.unwrap()).unwrap())
            .collect()
    }
    fn cancel_request(req: &ContentSearchReq) -> FsCancelSearchReq {
        FsCancelSearchReq {
            session_id: req.session_id.clone(),
            generation: req.generation,
        }
    }
    async fn wait_done(job: &Search) {
        let started = Instant::now();
        while !job.progress.lock().unwrap().done {
            assert!(started.elapsed() < Duration::from_secs(10));
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    }
    #[tokio::test]
    async fn stopped_results_remain_pageable_but_cannot_replace_and_close_releases_spool() {
        let root = tempfile::tempdir().unwrap();
        let contents = "hit\n".repeat(1001);
        std::fs::write(root.path().join("a"), &contents).unwrap();
        let req = request(root.path(), "hit");
        fs_start_content_search(req.clone()).unwrap();
        let job = get(&req.session_id, req.generation).unwrap();
        wait_done(&job).await;
        let spool = job
            .progress
            .lock()
            .unwrap()
            .spool
            .get_ref()
            .path()
            .to_owned();
        assert!(fs_stop_content_search(cancel_request(&req)).unwrap());
        let mut all = vec![];
        for page in 0..6 {
            let found = fs_content_search_page(ContentSearchPageReq {
                session_id: req.session_id.clone(),
                generation: req.generation,
                page,
            })
            .await
            .unwrap();
            assert!(found.done && found.error.is_none());
            assert_eq!(found.total, 1001);
            assert_eq!(found.files, 1);
            all.extend(found.matches);
        }
        assert_eq!(all.len(), 1001);
        assert_eq!(
            all.iter().map(|m| m.line).collect::<Vec<_>>(),
            (1..=1001).collect::<Vec<_>>()
        );
        assert_eq!(replace(&job, &[]).unwrap_err().code, ErrorCode::Cancelled);
        assert_eq!(
            std::fs::read_to_string(root.path().join("a")).unwrap(),
            contents
        );
        super::super::filesystem_search::fs_cancel_search(cancel_request(&req)).unwrap();
        assert!(get(&req.session_id, req.generation).is_err());
        drop(job);
        assert!(!spool.exists());
    }
    #[tokio::test]
    async fn stopping_an_active_file_rolls_back_its_provisional_results_without_error() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a"), "hit\n".repeat(200_000)).unwrap();
        let req = request(root.path(), "hit");
        fs_start_content_search(req.clone()).unwrap();
        let job = get(&req.session_id, req.generation).unwrap();
        let started = Instant::now();
        loop {
            let total = job.progress.lock().unwrap().total;
            if total >= 200 {
                assert!(total < 200_000, "scan must still be inside the file");
                break;
            }
            assert!(started.elapsed() < Duration::from_secs(10));
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        assert!(fs_stop_content_search(cancel_request(&req)).unwrap());
        wait_done(&job).await;
        let found = fs_content_search_page(ContentSearchPageReq {
            session_id: req.session_id.clone(),
            generation: req.generation,
            page: 0,
        })
        .await
        .unwrap();
        assert!(found.done && found.error.is_none());
        assert_eq!(found.total, 0);
        assert_eq!(found.files, 0);
        assert!(found.matches.is_empty());
        let p = job.progress.lock().unwrap();
        assert!(p.pages.is_empty());
        assert_eq!(p.bytes, 0);
        drop(p);
        super::super::filesystem_search::fs_cancel_search(cancel_request(&req)).unwrap();
    }
    #[tokio::test]
    async fn stop_before_start_rejects_late_start_and_old_stop_cannot_cancel_a_new_scan() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a"), "hit").unwrap();
        let mut req = request(root.path(), "hit");
        let old = cancel_request(&req);
        assert!(!fs_stop_content_search(cancel_request(&req)).unwrap());
        assert_eq!(
            fs_start_content_search(req.clone()).unwrap_err().code,
            ErrorCode::Cancelled
        );
        req.generation += 1;
        fs_start_content_search(req.clone()).unwrap();
        let job = get(&req.session_id, req.generation).unwrap();
        assert!(!fs_stop_content_search(old).unwrap());
        assert!(!job.cancel.is_cancelled());
        wait_done(&job).await;
        assert_eq!(matches(&job).len(), 1);
        assert_eq!(replace(&job, &[]).unwrap().completed, ["a"]);
        super::super::filesystem_search::fs_cancel_search(cancel_request(&req)).unwrap();
    }
    #[test]
    fn every_occurrence_case_word_unicode_and_original_columns() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("a"),
            "😀中文 Needle needle needles\r\nNEEDLE",
        )
        .unwrap();
        let mut req = request(root.path(), "needle");
        let found = matches(&run(req.clone()));
        assert_eq!(found.len(), 4);
        assert_eq!(found[0].column, 6);
        assert_eq!(found[1].column, 13);
        req.whole_word = true;
        assert_eq!(matches(&run(req.clone())).len(), 3);
        req.case_sensitive = true;
        assert_eq!(matches(&run(req)).len(), 1);
    }
    #[test]
    fn cr_and_mixed_newlines_report_editor_line_and_utf16_column() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("a"),
            "\u{feff}hit\r😀 hit\r\nprefix\rhit\nhit",
        )
        .unwrap();
        let found = matches(&run(request(root.path(), "hit")));
        assert_eq!(
            found.iter().map(|m| (m.line, m.column)).collect::<Vec<_>>(),
            [(1, 2), (2, 4), (4, 1), (5, 1)]
        );
        assert!(found.iter().all(|m| !m.preview.contains(['\r', '\n'])));
    }
    #[test]
    fn anchored_replacement_preserves_every_mixed_line_ending() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("a"),
            "\u{feff}foo1\rfoo2\r\n\rfoo3\nfoo4\r\rfoo5",
        )
        .unwrap();
        let mut req = request(root.path(), r"^foo(\d)$");
        req.regex = true;
        req.replacement = "bar$1".into();
        let job = run(req);
        assert_eq!(
            matches(&job).iter().map(|m| m.line).collect::<Vec<_>>(),
            [1, 2, 4, 5, 7]
        );
        assert_eq!(replace(&job, &[]).unwrap().completed, ["a"]);
        assert_eq!(
            std::fs::read(root.path().join("a")).unwrap(),
            "\u{feff}bar1\rbar2\r\n\rbar3\nbar4\r\rbar5".as_bytes()
        );
    }
    #[test]
    fn reader_keeps_crlf_together_at_each_buffer_boundary() {
        let input = b"abc\r\n\r\rdef\nz\rlast";
        for capacity in [1, 2, 3, 4, 8, 8192] {
            let mut reader = BufReader::with_capacity(capacity, input.as_slice());
            let mut lines = Vec::new();
            loop {
                let mut line = Vec::new();
                if read_line(&mut reader, &mut line, &CancellationToken::new()).unwrap() == 0 {
                    break;
                }
                lines.push(line);
            }
            assert_eq!(
                lines,
                [
                    b"abc\r\n".as_slice(),
                    b"\r",
                    b"\r",
                    b"def\n",
                    b"z\r",
                    b"last"
                ],
                "buffer capacity {capacity}"
            );
            assert_eq!(lines.concat(), input);
        }
    }
    #[test]
    fn empty_file_and_terminal_empty_lines_match_and_replace_like_the_editor() {
        for (text, line, column, expected) in [
            ("", 1, 1, "new"),
            ("\u{feff}", 1, 2, "\u{feff}new"),
            ("first\n", 2, 1, "first\nnew"),
            ("first\r", 2, 1, "first\rnew"),
            ("first\r\n", 2, 1, "first\r\nnew"),
        ] {
            let root = tempfile::tempdir().unwrap();
            std::fs::write(root.path().join("a"), text).unwrap();
            let mut req = request(root.path(), "^$");
            req.regex = true;
            let job = run(req);
            assert_eq!(
                matches(&job)
                    .iter()
                    .map(|m| (m.line, m.column))
                    .collect::<Vec<_>>(),
                [(line, column)],
                "{text:?}"
            );
            assert_eq!(replace(&job, &[]).unwrap().completed, ["a"]);
            assert_eq!(
                std::fs::read(root.path().join("a")).unwrap(),
                expected.as_bytes()
            );
        }
    }
    #[test]
    fn searches_past_former_file_and_total_size_limits() {
        let root = tempfile::tempdir().unwrap();
        let mut file = File::create(root.path().join("large.txt")).unwrap();
        let line = format!("{}\n", "a".repeat(65535));
        for _ in 0..1700 {
            file.write_all(line.as_bytes()).unwrap();
        }
        file.write_all(b"needle needle").unwrap();
        drop(file);
        let found = matches(&run(request(root.path(), "needle")));
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].line, 1701);
    }
    #[test]
    fn huge_single_line_keeps_preview_bounded_and_utf16_highlight_correct() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("a"),
            format!("{}needle", "😀".repeat(2_000_000)),
        )
        .unwrap();
        let found = matches(&run(request(root.path(), "needle")));
        assert_eq!(found[0].column, 4_000_001);
        assert!(found[0].preview.chars().count() < 250);
        let utf16: Vec<_> = found[0].preview.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(&utf16[found[0].match_start as usize..found[0].match_end as usize])
                .unwrap(),
            "needle"
        );
    }
    #[tokio::test]
    async fn pages_preserve_all_matches_and_cancellation_releases_session() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a"), "hit ".repeat(1001)).unwrap();
        let job = run(request(root.path(), "hit"));
        sessions()
            .lock()
            .unwrap()
            .insert(job.req.session_id.clone(), job.clone());
        let mut all = vec![];
        for page in 0..6 {
            let p = fs_content_search_page(ContentSearchPageReq {
                session_id: job.req.session_id.clone(),
                generation: 1,
                page,
            })
            .await
            .unwrap();
            assert_eq!(p.total, 1001);
            assert!(p.matches.len() <= PAGE);
            all.extend(p.matches);
        }
        assert_eq!(all.len(), 1001);
        assert_eq!(all[1000].column, 4001);
        cancel_session(&job.req.session_id, 0);
        assert!(get(&job.req.session_id, 1).is_ok());
        cancel_session(&job.req.session_id, 1);
        assert!(get(&job.req.session_id, 1).is_err());
        assert!(job.cancel.is_cancelled());
    }
    #[test]
    fn includes_excludes_hidden_ignored_and_git_metadata() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".git")).unwrap();
        std::fs::create_dir(root.path().join("src")).unwrap();
        for path in [
            "src/a.rs",
            "src/b.rs",
            "a.txt",
            ".hidden",
            ".git/config",
            "ignored.log",
            "keep.log",
        ] {
            std::fs::write(root.path().join(path), "hit").unwrap();
        }
        std::fs::write(root.path().join(".gitignore"), "*.log\n!keep.log\n").unwrap();
        let mut req = request(root.path(), "hit");
        req.include = "src/**,*.log".into();
        req.exclude = "b.rs".into();
        let paths: HashSet<_> = matches(&run(req.clone()))
            .into_iter()
            .map(|m| m.path)
            .collect();
        assert_eq!(paths, HashSet::from(["src/a.rs".into(), "keep.log".into()]));
        req.include.clear();
        req.show_ignored = true;
        req.show_hidden = true;
        let paths: HashSet<_> = matches(&run(req)).into_iter().map(|m| m.path).collect();
        assert!(paths.contains(".hidden"));
        assert!(paths.contains("ignored.log"));
        assert!(!paths.contains(".git/config"));
    }
    #[test]
    fn late_binary_and_invalid_utf8_remove_provisional_results() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("binary"), b"hit\rhit\r\nhit\0").unwrap();
        std::fs::write(root.path().join("invalid"), b"hit\r\nhit\r\xff").unwrap();
        std::fs::write(root.path().join("text"), "hit").unwrap();
        let job = run(request(root.path(), "hit"));
        let found = matches(&job);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, "text");
        let p = job.progress.lock().unwrap();
        assert_eq!(p.skipped, 2);
        assert_eq!(p.hashes.len(), 1);
    }

    fn visited(req: &ContentSearchReq) -> Vec<String> {
        let root = Path::new(&req.folder_path);
        search_entries(
            root,
            req,
            globs(&req.exclude).unwrap(),
            CancellationToken::new(),
        )
        .map(|entry| {
            entry
                .unwrap()
                .path()
                .strip_prefix(root)
                .unwrap()
                .to_str()
                .unwrap()
                .replace('\\', "/")
        })
        .collect()
    }

    #[test]
    fn excluded_directory_names_are_pruned_before_visiting_their_children() {
        let root = tempfile::tempdir().unwrap();
        for path in [
            "node_modules/pkg/deep/a.ts",
            "nested/node_modules/pkg/b.ts",
            "src/a.ts",
            "nested/src/b.ts",
            "node_modules-extra/c.ts",
        ] {
            let path = root.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "hit").unwrap();
        }
        let mut req = request(root.path(), "hit");
        req.exclude = "node_modules".into();
        req.include = "*.ts".into();
        let entries = visited(&req);
        assert!(
            entries
                .iter()
                .all(|path| !path.split('/').any(|part| part == "node_modules")),
            "{entries:?}"
        );
        let paths: HashSet<_> = matches(&run(req)).into_iter().map(|m| m.path).collect();
        assert_eq!(
            paths,
            HashSet::from([
                "src/a.ts".into(),
                "nested/src/b.ts".into(),
                "node_modules-extra/c.ts".into(),
            ])
        );
    }

    #[test]
    fn excluded_directory_globs_prune_only_the_matching_scope() {
        let root = tempfile::tempdir().unwrap();
        for path in [
            "build/a/deep/a.txt",
            "nested/build/b.txt",
            "src/x/a.txt",
            "src/y/b.txt",
        ] {
            let path = root.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "hit").unwrap();
        }
        let mut req = request(root.path(), "hit");
        req.include = "**/*.txt".into();
        req.exclude = "build/**,src/{x}".into();
        let entries = visited(&req);
        assert!(
            !entries
                .iter()
                .any(|path| path.starts_with("build/a") || path.starts_with("src/x")),
            "{entries:?}"
        );
        let paths: HashSet<_> = matches(&run(req)).into_iter().map(|m| m.path).collect();
        assert_eq!(
            paths,
            HashSet::from(["nested/build/b.txt".into(), "src/y/b.txt".into()])
        );
    }

    #[test]
    fn include_patterns_keep_parent_traversal_and_exclusion_wins_over_inclusion() {
        let root = tempfile::tempdir().unwrap();
        for path in [
            "parent/child/keep.rs",
            "parent/cache/skip.rs",
            "parent/child/skip.log",
        ] {
            let path = root.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "hit").unwrap();
        }
        let mut req = request(root.path(), "hit");
        req.include = "**/*.rs".into();
        req.exclude = "cache".into();
        let paths: HashSet<_> = matches(&run(req.clone()))
            .into_iter()
            .map(|m| m.path)
            .collect();
        assert_eq!(paths, HashSet::from(["parent/child/keep.rs".into()]));
        req.exclude = "**".into();
        assert_eq!(visited(&req), vec![String::new()]);
        assert!(matches(&run(req)).is_empty());
    }

    #[test]
    fn explicit_directory_exclusions_still_apply_when_hidden_and_ignored_are_enabled() {
        let root = tempfile::tempdir().unwrap();
        for path in [
            ".git/config",
            ".gitx-copy-stage/a.txt",
            ".gitx-replace-stage/a.txt",
            ".cache/deep/a.txt",
            "ignored/deep/a.txt",
            "src/vendor/deep/a.txt",
            "src/keep.lock",
            "src/keep.txt",
        ] {
            let path = root.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "hit").unwrap();
        }
        std::fs::write(root.path().join(".gitignore"), "ignored/\n").unwrap();
        let mut req = request(root.path(), "hit");
        req.show_hidden = true;
        req.show_ignored = true;
        req.exclude = ".cache,ignored,src\\vendor/,*.lock".into();
        let entries = visited(&req);
        assert!(
            entries.iter().all(|path| !path.starts_with(".cache")
                && !path.starts_with("ignored/")
                && !path.starts_with("src/vendor/")
                && !path.starts_with(".git/")
                && !path.starts_with(".gitx-")),
            "{entries:?}"
        );
        let paths: HashSet<_> = matches(&run(req)).into_iter().map(|m| m.path).collect();
        assert_eq!(paths, HashSet::from(["src/keep.txt".into()]));
    }

    #[test]
    fn exclusion_matches_relative_paths_not_the_workspace_root_name() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("cache");
        std::fs::create_dir_all(root.join("cache")).unwrap();
        std::fs::write(root.join("keep.txt"), "hit").unwrap();
        std::fs::write(root.join("cache/skip.txt"), "hit").unwrap();
        let mut req = request(&root, "hit");
        req.exclude = "cache".into();
        let paths: HashSet<_> = matches(&run(req)).into_iter().map(|m| m.path).collect();
        assert_eq!(paths, HashSet::from(["keep.txt".into()]));
    }

    #[test]
    fn cancelled_traversal_reports_cancellation_before_reading_the_root() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("keep.txt"), "hit").unwrap();
        let req = request(root.path(), "hit");
        let cancel = CancellationToken::new();
        cancel.cancel();
        let mut entries = search_entries(root.path(), &req, globs("").unwrap(), cancel);
        assert_eq!(
            entries.next().unwrap().unwrap_err().code,
            ErrorCode::Cancelled
        );
        assert!(entries.next().is_none());
    }

    #[test]
    fn cancelling_after_the_root_prevents_regular_and_filtered_descendants() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("cache")).unwrap();
        std::fs::write(root.path().join("cache/keep.txt"), "hit").unwrap();
        for exclude in ["", "cache"] {
            let req = request(root.path(), "hit");
            let cancel = CancellationToken::new();
            let mut entries =
                search_entries(root.path(), &req, globs(exclude).unwrap(), cancel.clone());
            assert_eq!(entries.next().unwrap().unwrap().depth(), 0);
            cancel.cancel();
            assert_eq!(
                entries.next().unwrap().unwrap_err().code,
                ErrorCode::Cancelled
            );
            assert!(entries.next().is_none());
        }
    }

    #[test]
    fn directory_read_errors_remain_errors_and_finished_walks_stay_finished() {
        let root = tempfile::tempdir().unwrap();
        let missing = root.path().join("missing");
        let req = request(&missing, "hit");
        let cancel = CancellationToken::new();
        let mut entries = search_entries(&missing, &req, globs("").unwrap(), cancel.clone());
        assert_eq!(
            entries.next().unwrap().unwrap_err().code,
            ErrorCode::FsError
        );
        assert!(entries.next().is_none());
        cancel.cancel();
        assert!(entries.next().is_none());
    }
    #[test]
    fn regex_captures_replace_all_occurrences_and_preserve_crlf_and_bom() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a"), "\u{feff}foo1 foo2\r\nfoo3\n").unwrap();
        let mut req = request(root.path(), r"foo(?P<n>\d)");
        req.regex = true;
        req.replacement = "bar${n}$$".into();
        let job = run(req);
        assert!(matches(&job)[0].replacement_preview.contains("bar1$"));
        assert_eq!(replace(&job, &[]).unwrap().completed, ["a"]);
        assert_eq!(
            std::fs::read_to_string(root.path().join("a")).unwrap(),
            "\u{feff}bar1$ bar2$\r\nbar3$\n"
        );
        assert!(replace(&job, &[]).is_err());
    }
    #[test]
    fn bom_is_not_matched_by_anchors_or_removed_by_whole_line_replacement() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a"), "\u{feff}foo\r\n").unwrap();
        let mut req = request(root.path(), "^foo$");
        req.regex = true;
        let found = matches(&run(req.clone()));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].column, 2);
        req.query = "^.*$".into();
        let job = run(req);
        // The terminal separator creates an empty second editor line.
        assert_eq!(matches(&job).len(), 2);
        assert_eq!(replace(&job, &[]).unwrap().completed, ["a"]);
        assert_eq!(
            std::fs::read_to_string(root.path().join("a")).unwrap(),
            "\u{feff}new\r\nnew"
        );
    }
    #[test]
    fn literal_replacement_and_file_exclusions() {
        let root = tempfile::tempdir().unwrap();
        for path in ["a", "b"] {
            std::fs::write(root.path().join(path), "hit hit").unwrap();
        }
        let mut req = request(root.path(), "hit");
        req.replacement = "$1\\n".into();
        let job = run(req);
        assert_eq!(replace(&job, &["b".into()]).unwrap().completed, ["a"]);
        assert_eq!(
            std::fs::read_to_string(root.path().join("a")).unwrap(),
            "$1\\n $1\\n"
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join("b")).unwrap(),
            "hit hit"
        );
    }
    #[test]
    fn changed_file_preflight_writes_nothing_and_same_length_edits_are_detected() {
        let root = tempfile::tempdir().unwrap();
        for path in ["a", "b"] {
            std::fs::write(root.path().join(path), "hit").unwrap();
        }
        let job = run(request(root.path(), "hit"));
        std::fs::write(root.path().join("b"), "new").unwrap();
        assert!(replace(&job, &[]).unwrap_err().message.contains("changed"));
        assert_eq!(
            std::fs::read_to_string(root.path().join("a")).unwrap(),
            "hit"
        );
    }
    #[test]
    fn zero_width_and_empty_replacement_terminate_correctly() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a"), "abc\nxyz").unwrap();
        let mut req = request(root.path(), "^|$");
        req.regex = true;
        req.replacement = "!".into();
        let job = run(req);
        assert_eq!(matches(&job).len(), 4);
        replace(&job, &[]).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.path().join("a")).unwrap(),
            "!abc!\n!xyz!"
        );
        let mut req = request(root.path(), "!");
        req.replacement.clear();
        replace(&run(req), &[]).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.path().join("a")).unwrap(),
            "abc\nxyz"
        );
    }
    #[test]
    fn cancellation_and_invalid_regex_never_write() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a"), "hit").unwrap();
        let job = run(request(root.path(), "hit"));
        job.cancel.cancel();
        assert!(replace(&job, &[]).is_err());
        assert!(scan(&job).is_err());
        let mut req = request(root.path(), "[");
        req.regex = true;
        assert!(pattern(&req).is_err());
        assert!(globs("[").is_err());
        assert_eq!(
            std::fs::read_to_string(root.path().join("a")).unwrap(),
            "hit"
        );
    }
}
