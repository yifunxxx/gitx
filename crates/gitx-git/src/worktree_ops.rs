//! Git worktree list / add / remove / prune / lock / unlock (#43–#46).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode, WorktreeInfo, WorktreePrunePreview};
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

impl GitRunner {
    pub async fn worktree_list(
        &self,
        cwd: &Path,
        current_path: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<Vec<WorktreeInfo>, AppError> {
        let inv = GitInvocation::new(cwd, ["worktree", "list", "--porcelain", "-z"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let mut entries = match self.run(inv, cancel).await {
            Ok(out) => parse_worktree_porcelain(&String::from_utf8_lossy(&out.stdout)),
            Err(error) if error.exit_code == Some(129) => Vec::new(),
            Err(error) => return Err(error),
        };
        if entries.is_empty() {
            // Fallback without -z for older parsers / quirks.
            let inv = GitInvocation::new(cwd, ["worktree", "list", "--porcelain"])
                .kind(OpKind::Read)
                .git_bin(self.git_bin.clone());
            let out = self.run(inv, cancel).await?;
            let text = String::from_utf8_lossy(&out.stdout);
            entries = parse_worktree_porcelain_lf(&text);
        }
        for entry in &mut entries {
            entry.path = crate::resolve_git_path(cwd, &entry.path)
                .to_string_lossy()
                .into_owned();
        }
        if let Some(first) = entries.first_mut() {
            first.is_main = true;
        }
        if let Some(cur) = current_path {
            let cur_canon = canonicalize_lossy(Path::new(cur));
            for e in &mut entries {
                e.is_current = paths_equal(&e.path, &cur_canon) || paths_equal(&e.path, cur);
            }
        }
        Ok(entries)
    }

    pub async fn worktree_add(
        &self,
        cwd: &Path,
        path: &Path,
        start_ref: &str,
        new_branch: Option<&str>,
        track: bool,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        // Refuse nesting inside an existing worktree.
        let existing = self.worktree_list(cwd, None, cancel).await?;
        let path_str = path.to_string_lossy();
        for wt in &existing {
            let wt_path = Path::new(&wt.path);
            if (path.starts_with(wt_path) || wt_path.starts_with(path)) && path != wt_path {
                return Err(AppError::new(
                    ErrorCode::WorktreeNested,
                    format!(
                        "worktree path '{}' nests with existing worktree '{}'",
                        path_str, wt.path
                    ),
                ));
            }
        }
        if path.exists() {
            return Err(AppError::new(
                ErrorCode::FsError,
                format!("path already exists: {path_str}"),
            ));
        }

        let mut args: Vec<String> = vec!["worktree".into(), "add".into()];
        if let Some(nb) = new_branch {
            args.push("-b".into());
            args.push(nb.into());
            if track {
                args.push("--track".into());
            }
        }
        args.push(path_str.to_string());
        args.push(start_ref.into());

        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .timeout(Some(std::time::Duration::from_secs(120)))
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(_) => Ok(()),
            Err(e) => {
                let msg = e.message.to_lowercase();
                // Git owns its rollback. The destination can have been created
                // by another process after our check, so never delete it here.
                if msg.contains("already checked out")
                    || msg.contains("is already used by worktree")
                {
                    Err(AppError::new(ErrorCode::WorktreeBranchInUse, e.message)
                        .with_stderr(e.git_stderr.unwrap_or_default()))
                } else {
                    Err(e)
                }
            }
        }
    }

    /// Fetch a ref into `refs/gitx/review/<name>` then add a worktree (#46 host-agnostic).
    pub async fn worktree_open_ref(
        &self,
        cwd: &Path,
        path: &Path,
        remote: &str,
        refspec: &str,
        review_name: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let local_ref = format!("refs/gitx/review/{review_name}");
        let fetch_spec = format!("{refspec}:{local_ref}");
        let inv = GitInvocation::new(cwd, ["fetch", remote, &fetch_spec])
            .kind(OpKind::Network)
            .timeout(Some(std::time::Duration::from_secs(180)))
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        let branch = format!("review/{review_name}");
        self.worktree_add(cwd, path, &local_ref, Some(&branch), false, cancel)
            .await
    }

    pub async fn worktree_remove(
        &self,
        cwd: &Path,
        path: &Path,
        force: bool,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        // A stash-create snapshot omits untracked/ignored files and submodule
        // worktrees. Do not expose a force-delete until every file is protected.
        if force {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "Save local changes and use normal worktree removal; forced removal is unavailable",
            ));
        }
        let args = vec![
            "worktree".into(),
            "remove".into(),
            "--".into(),
            path.to_string_lossy().into_owned(),
        ];
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(_) => Ok(()),
            Err(e) => {
                let msg = e.message.to_lowercase();
                if msg.contains("locked") {
                    Err(AppError::new(ErrorCode::WorktreeLocked, e.message))
                } else {
                    Err(e)
                }
            }
        }
    }

    pub async fn worktree_lock(
        &self,
        cwd: &Path,
        path: &Path,
        reason: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let mut args = vec![
            "worktree".into(),
            "lock".into(),
            path.to_string_lossy().into_owned(),
        ];
        if let Some(r) = reason {
            if !r.is_empty() {
                args.push("--reason".into());
                args.push(r.into());
            }
        }
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn worktree_unlock(
        &self,
        cwd: &Path,
        path: &Path,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let inv = GitInvocation::new(cwd, ["worktree", "unlock", &path.to_string_lossy()])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn worktree_prune_preview(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<WorktreePrunePreview, AppError> {
        let inv = GitInvocation::new(cwd, ["worktree", "prune", "--dry-run", "-v"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let text = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        let combined = if text.is_empty() {
            stderr.to_string()
        } else {
            text.to_string()
        };
        let paths: Vec<String> = combined
            .lines()
            .filter_map(|l| {
                let l = l.trim();
                // "Removing worktrees/foo: gitdir file points to non-existent location"
                l.strip_prefix("Removing ")
                    .map(|rest| rest.split(':').next().unwrap_or(rest).trim().to_string())
            })
            .filter(|s| !s.is_empty())
            .collect();
        Ok(WorktreePrunePreview {
            paths,
            dry_run_output: combined,
        })
    }

    pub async fn worktree_prune(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<WorktreePrunePreview, AppError> {
        let preview = self.worktree_prune_preview(cwd, cancel).await?;
        let inv = GitInvocation::new(cwd, ["worktree", "prune", "-v"])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(preview)
    }

    /// Default location suggestion: `<repo-parent>/<repo>-<branch>`.
    pub fn worktree_default_path(repo_root: &Path, branch: &str) -> PathBuf {
        let parent = repo_root.parent().unwrap_or(repo_root);
        let name = repo_root
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "repo".into());
        let safe: String = branch
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        parent.join(format!("{name}-{safe}"))
    }
}

fn parse_worktree_porcelain(text: &str) -> Vec<WorktreeInfo> {
    // -z: attributes NUL-terminated; records separated by double NUL.
    let mut out = Vec::new();
    for record in text.split("\0\0") {
        let record = record.trim_matches('\0');
        if record.is_empty() {
            continue;
        }
        if let Some(info) = parse_worktree_record(record.split('\0'), false) {
            out.push(info);
        }
    }
    out
}

fn parse_worktree_porcelain_lf(text: &str) -> Vec<WorktreeInfo> {
    let text = text.replace("\r\n", "\n");
    let mut out = Vec::new();
    for record in text.split("\n\n") {
        let record = record.trim_matches('\n');
        if record.is_empty() {
            continue;
        }
        if let Some(info) = parse_worktree_record(record.lines(), true) {
            out.push(info);
        }
    }
    out
}

fn parse_worktree_record<'a, I>(lines: I, quoted: bool) -> Option<WorktreeInfo>
where
    I: Iterator<Item = &'a str>,
{
    let mut path = None;
    let mut head = String::new();
    let mut branch = None;
    let mut bare = false;
    let mut detached = false;
    let mut locked = false;
    let mut lock_reason = None;
    let mut prunable = false;
    let mut prune_reason = None;

    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("worktree ") {
            path = Some(decode_porcelain_value(rest, quoted));
        } else if let Some(rest) = line.strip_prefix("HEAD ") {
            head = rest.to_string();
        } else if let Some(rest) = line.strip_prefix("branch ") {
            branch = Some(rest.strip_prefix("refs/heads/").unwrap_or(rest).to_string());
        } else if line == "bare" {
            bare = true;
        } else if line == "detached" {
            detached = true;
        } else if line == "locked" {
            locked = true;
        } else if let Some(rest) = line.strip_prefix("locked ") {
            locked = true;
            lock_reason = Some(decode_porcelain_value(rest, quoted));
        } else if line == "prunable" {
            prunable = true;
        } else if let Some(rest) = line.strip_prefix("prunable ") {
            prunable = true;
            prune_reason = Some(decode_porcelain_value(rest, quoted));
        }
    }

    let path = path?;
    Some(WorktreeInfo {
        path,
        head,
        branch,
        bare,
        detached,
        locked,
        lock_reason,
        prunable,
        prune_reason,
        is_main: false,
        is_current: false,
    })
}

/// LF porcelain C-quotes special characters and (by default) non-ASCII bytes.
/// NUL porcelain values are literal, including surrounding quotes/whitespace.
fn decode_porcelain_value(value: &str, quoted: bool) -> String {
    if !quoted || !value.starts_with('"') || !value.ends_with('"') || value.len() < 2 {
        return value.to_owned();
    }
    let mut input = value.as_bytes()[1..value.len() - 1].iter().copied();
    let mut output = Vec::new();
    while let Some(byte) = input.next() {
        if byte != b'\\' {
            output.push(byte);
            continue;
        }
        let escaped = match input.next() {
            Some(b'a') => 7,
            Some(b'b') => 8,
            Some(b't') => b'\t',
            Some(b'n') => b'\n',
            Some(b'v') => 11,
            Some(b'f') => 12,
            Some(b'r') => b'\r',
            Some(b'"') => b'"',
            Some(b'\\') => b'\\',
            Some(first @ b'0'..=b'3') => {
                let (Some(second @ b'0'..=b'7'), Some(third @ b'0'..=b'7')) =
                    (input.next(), input.next())
                else {
                    return value.to_owned();
                };
                (first - b'0') * 64 + (second - b'0') * 8 + (third - b'0')
            }
            _ => return value.to_owned(),
        };
        output.push(escaped);
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn canonicalize_lossy(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

fn paths_equal(a: &str, b: &str) -> bool {
    // Git emits forward slashes; Windows canonicalize returns a verbatim path.
    // Canonicalize both sides, including symlinks, before comparing them.
    let a = canonicalize_lossy(Path::new(a));
    let b = canonicalize_lossy(Path::new(b));
    gitx_core::host_path_key(&a) == gitx_core::host_path_key(&b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_lf() {
        let text = "\
worktree /tmp/main
HEAD abcdef0123456789abcdef0123456789abcdef01
branch refs/heads/main

worktree /tmp/feature
HEAD 1111111111111111111111111111111111111111
detached
locked on another machine

worktree /tmp/gone
HEAD 2222222222222222222222222222222222222222
branch refs/heads/gone
prunable gitdir file points to non-existent location
";
        let list = parse_worktree_porcelain_lf(text);
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        assert!(list[1].detached);
        assert!(list[1].locked);
        assert_eq!(list[1].lock_reason.as_deref(), Some("on another machine"));
        assert!(list[2].prunable);
    }

    #[test]
    fn default_path_sanitizes_branch() {
        let p = GitRunner::worktree_default_path(Path::new("/repos/demo"), "feature/x");
        assert_eq!(p, PathBuf::from("/repos/demo-feature-x"));
    }

    #[test]
    fn lf_decodes_git_quoted_paths_and_reasons() {
        let text = concat!(
            "worktree \"/tmp/\\344\\270\\255\\346\\226\\207\\tpath\"\n",
            "HEAD abc\n",
            "detached\n",
            "locked \"keep\\n\\\"quotes\\\"\\tand\\\\slashes  \"\n\n",
            "worktree /tmp/gone\n",
            "HEAD def\n",
            "prunable \"missing\\npath\"\n"
        );
        let list = parse_worktree_porcelain_lf(text);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].path, "/tmp/中文\tpath");
        assert_eq!(
            list[0].lock_reason.as_deref(),
            Some("keep\n\"quotes\"\tand\\slashes  ")
        );
        assert_eq!(list[1].prune_reason.as_deref(), Some("missing\npath"));
    }

    #[test]
    fn nul_preserves_literal_quotes_control_characters_and_trailing_spaces() {
        let text =
            "worktree /tmp/quoted \"dir\"\n  \0HEAD abc\0detached\0locked \"literal\\n\"  \0\0";
        let list = parse_worktree_porcelain(text);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].path, "/tmp/quoted \"dir\"\n  ");
        assert_eq!(list[0].lock_reason.as_deref(), Some("\"literal\\n\"  "));
    }

    #[test]
    fn lf_supports_crlf_records_and_bare_repositories() {
        let list = parse_worktree_porcelain_lf(
            "worktree /tmp/repo.git\r\nbare\r\n\r\nworktree /tmp/linked\r\nHEAD abc\r\nbranch refs/heads/main\r\n\r\n",
        );
        assert_eq!(list.len(), 2);
        assert!(list[0].bare);
        assert_eq!(list[1].branch.as_deref(), Some("main"));
    }
}
