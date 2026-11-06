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
        let out = self.run(inv, cancel).await?;
        let text = String::from_utf8_lossy(&out.stdout);
        let mut entries = parse_worktree_porcelain(&text);
        if entries.is_empty() {
            // Fallback without -z for older parsers / quirks.
            let inv = GitInvocation::new(cwd, ["worktree", "list", "--porcelain"])
                .kind(OpKind::Read)
                .git_bin(self.git_bin.clone());
            let out = self.run(inv, cancel).await?;
            let text = String::from_utf8_lossy(&out.stdout);
            entries = parse_worktree_porcelain_lf(&text);
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
            if path.starts_with(wt_path) || wt_path.starts_with(path) {
                if path != wt_path {
                    return Err(AppError::new(
                        ErrorCode::WorktreeNested,
                        format!(
                            "worktree path '{}' nests with existing worktree '{}'",
                            path_str, wt.path
                        ),
                    ));
                }
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
                // Best-effort cleanup if git left a partial directory.
                if path.exists() {
                    let _ = std::fs::remove_dir_all(path);
                }
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
        // Safety snapshot before force-remove of dirty trees.
        if force {
            let inv = GitInvocation::new(path, ["stash", "create"])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            if let Ok(out) = self.run(inv, cancel).await {
                let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !sha.is_empty() {
                    let backup = format!(
                        "refs/gitx/backup/worktree-remove-{}",
                        &sha[..7.min(sha.len())]
                    );
                    let inv = GitInvocation::new(path, ["update-ref", &backup, &sha])
                        .kind(OpKind::Write)
                        .git_bin(self.git_bin.clone());
                    let _ = self.run(inv, cancel).await;
                }
            }
        }
        let mut args = vec!["worktree".into(), "remove".into()];
        if force {
            args.push("--force".into());
        }
        args.push(path.to_string_lossy().into_owned());
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
        let record = record.trim_matches('\0').trim();
        if record.is_empty() {
            continue;
        }
        if let Some(info) = parse_worktree_record(record.split('\0')) {
            out.push(info);
        }
    }
    out
}

fn parse_worktree_porcelain_lf(text: &str) -> Vec<WorktreeInfo> {
    let mut out = Vec::new();
    for record in text.split("\n\n") {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }
        if let Some(info) = parse_worktree_record(record.lines()) {
            out.push(info);
        }
    }
    out
}

fn parse_worktree_record<'a, I>(lines: I) -> Option<WorktreeInfo>
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
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("worktree ") {
            path = Some(rest.to_string());
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
            lock_reason = Some(rest.to_string());
        } else if line == "prunable" {
            prunable = true;
        } else if let Some(rest) = line.strip_prefix("prunable ") {
            prunable = true;
            prune_reason = Some(rest.to_string());
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

fn canonicalize_lossy(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

fn paths_equal(a: &str, b: &str) -> bool {
    let a = a.trim_end_matches(['/', '\\']);
    let b = b.trim_end_matches(['/', '\\']);
    a == b
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
}
