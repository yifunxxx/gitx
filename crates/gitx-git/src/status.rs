//! Parse `git status --porcelain=v2 -z --branch`.

use gitx_core::{BranchInfo, FileChange, FileChangeKind, StatusSnapshot};

pub fn parse_status_porcelain_v2(stdout: &[u8], repo_id: &str, version: u64) -> StatusSnapshot {
    let text = String::from_utf8_lossy(stdout);
    let mut branch = BranchInfo {
        head: "HEAD".into(),
        upstream: None,
        ahead: None,
        behind: None,
        detached: false,
    };
    let mut files = Vec::new();

    let mut entries = text.split('\0');
    while let Some(entry) = entries.next() {
        if entry.is_empty() {
            continue;
        }
        if let Some(rest) = entry.strip_prefix("# branch.head ") {
            let head = rest.trim();
            if head == "(detached)" {
                branch.detached = true;
                branch.head = "HEAD".into();
            } else {
                branch.head = head.to_string();
            }
            continue;
        }
        if let Some(rest) = entry.strip_prefix("# branch.upstream ") {
            branch.upstream = Some(rest.trim().to_string());
            continue;
        }
        if let Some(rest) = entry.strip_prefix("# branch.ab ") {
            // +ahead -behind
            let mut ahead = None;
            let mut behind = None;
            for token in rest.split_whitespace() {
                if let Some(v) = token.strip_prefix('+') {
                    ahead = v.parse().ok();
                } else if let Some(v) = token.strip_prefix('-') {
                    behind = v.parse().ok();
                }
            }
            branch.ahead = ahead;
            branch.behind = behind;
            continue;
        }
        if entry.starts_with('#') {
            continue;
        }

        // A type-2 record owns the next NUL-delimited field, even when the
        // source filename starts with text resembling another status record.
        let change = if entry.starts_with("2 ") {
            let original = entries.next();
            parse_rename(entry, original)
        } else {
            parse_entry(entry)
        };
        if let Some(change) = change {
            files.push(change);
        }
    }

    StatusSnapshot {
        repo_id: repo_id.to_string(),
        version,
        branch,
        files,
    }
}

fn parse_entry(entry: &str) -> Option<FileChange> {
    let bytes = entry.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    match bytes[0] {
        b'1' => parse_ordinary(entry),
        b'u' => parse_unmerged(entry),
        b'?' => Some(FileChange {
            path: entry[2..].to_string(),
            orig_path: None,
            index_status: "?".into(),
            worktree_status: "?".into(),
            kind: FileChangeKind::Untracked,
        }),
        b'!' => Some(FileChange {
            path: entry[2..].to_string(),
            orig_path: None,
            index_status: "!".into(),
            worktree_status: "!".into(),
            kind: FileChangeKind::Ignored,
        }),
        _ => None,
    }
}

fn parse_ordinary(entry: &str) -> Option<FileChange> {
    // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
    let mut parts = entry.splitn(9, ' ');
    let _ = parts.next()?; // "1"
    let xy = parts.next()?;
    let _sub = parts.next()?;
    let _mh = parts.next()?;
    let _mi = parts.next()?;
    let _mw = parts.next()?;
    let _hh = parts.next()?;
    let _hi = parts.next()?;
    let path = parts.next()?.to_string();
    let (index_status, worktree_status) = xy_chars(xy);
    let kind = kind_from_xy(&index_status, &worktree_status, None);
    Some(FileChange {
        path,
        orig_path: None,
        index_status,
        worktree_status,
        kind,
    })
}

fn parse_rename(entry: &str, original: Option<&str>) -> Option<FileChange> {
    // With -z: 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path> NUL <origPath> NUL.
    // Spaces and tabs in either path are literal filename characters.
    let mut parts = entry.splitn(10, ' ');
    let _ = parts.next()?; // "2"
    let xy = parts.next()?;
    let _sub = parts.next()?;
    let _mh = parts.next()?;
    let _mi = parts.next()?;
    let _mw = parts.next()?;
    let _hh = parts.next()?;
    let _hi = parts.next()?;
    let _score = parts.next()?;
    let path = parts.next()?.to_string();
    let orig = original.filter(|path| !path.is_empty()).map(str::to_string);
    let (index_status, worktree_status) = xy_chars(xy);
    let kind = if index_status == "C" || worktree_status == "C" {
        FileChangeKind::Copied
    } else {
        FileChangeKind::Renamed
    };
    Some(FileChange {
        path,
        orig_path: orig,
        index_status,
        worktree_status,
        kind,
    })
}

fn parse_unmerged(entry: &str) -> Option<FileChange> {
    // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
    let mut parts = entry.splitn(11, ' ');
    let _ = parts.next()?;
    let xy = parts.next()?;
    for _ in 0..8 {
        let _ = parts.next()?;
    }
    let path = parts.next()?.to_string();
    let (index_status, worktree_status) = xy_chars(xy);
    Some(FileChange {
        path,
        orig_path: None,
        index_status,
        worktree_status,
        kind: FileChangeKind::Unmerged,
    })
}

fn xy_chars(xy: &str) -> (String, String) {
    let mut chars = xy.chars();
    let x = chars.next().unwrap_or('.').to_string();
    let y = chars.next().unwrap_or('.').to_string();
    (x, y)
}

fn kind_from_xy(index: &str, worktree: &str, orig: Option<&str>) -> FileChangeKind {
    if orig.is_some() {
        return FileChangeKind::Renamed;
    }
    let letter = if index != "." { index } else { worktree };
    match letter {
        "A" => FileChangeKind::Added,
        "D" => FileChangeKind::Deleted,
        "R" => FileChangeKind::Renamed,
        "C" => FileChangeKind::Copied,
        "T" => FileChangeKind::Typechange,
        "U" => FileChangeKind::Unmerged,
        _ => FileChangeKind::Modified,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modified_and_untracked() {
        let raw = b"# branch.head main\0# branch.ab +1 -0\x001 .M N... 100644 100644 100644 abc abc README.md\0? new.txt\0";
        let snap = parse_status_porcelain_v2(raw, "/tmp/repo", 1);
        assert_eq!(snap.branch.head, "main");
        assert_eq!(snap.branch.ahead, Some(1));
        assert_eq!(snap.files.len(), 2);
        assert_eq!(snap.files[0].path, "README.md");
        assert_eq!(snap.files[0].worktree_status, "M");
        assert_eq!(snap.files[1].kind, FileChangeKind::Untracked);
    }
}
