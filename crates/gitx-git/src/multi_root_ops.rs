//! Multi-root workspace discovery and synchronized branch ops (#33, 1.6).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode, RepoRoot};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    ".next",
    "vendor",
];

const ROOT_COLORS: &[&str] = &[
    "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#ec4899",
];

impl GitRunner {
    /// Resolve a single root at `path` (must be inside a work tree).
    pub async fn resolve_repo_root(
        &self,
        path: &Path,
        color_index: usize,
        cancel: &CancellationToken,
    ) -> Result<RepoRoot, AppError> {
        let inv = GitInvocation::new(
            path,
            [
                "rev-parse",
                "--is-inside-work-tree",
                "--show-toplevel",
                "--git-dir",
                "--git-common-dir",
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let text = String::from_utf8_lossy(&out.stdout);
        let mut lines = text.lines();
        let inside = lines.next().unwrap_or("false").trim() == "true";
        if !inside {
            return Err(AppError::new(
                ErrorCode::NotARepository,
                format!("not a git repository: {}", path.display()),
            ));
        }
        let toplevel = crate::resolve_git_path(path, lines.next().unwrap_or("").trim())
            .to_string_lossy()
            .into_owned();
        let git_dir_raw = lines.next().unwrap_or("").trim().to_string();
        let common_raw = lines.next().unwrap_or("").trim().to_string();
        let git_dir = absolutize(path, &git_dir_raw);
        let common_dir = absolutize(path, &common_raw);
        let is_worktree = git_dir != common_dir;
        let display_name = Path::new(&toplevel)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| toplevel.clone());
        Ok(RepoRoot {
            id: toplevel.clone(),
            worktree_root: toplevel,
            git_dir,
            common_dir,
            is_worktree,
            display_name,
            color: ROOT_COLORS[color_index % ROOT_COLORS.len()].to_string(),
            is_submodule: false,
        })
    }

    /// Discover nested repos under `root` (depth ≤ 4). Includes the primary root first.
    pub async fn discover_repo_roots(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<RepoRoot>, AppError> {
        let mut roots = Vec::new();
        let primary = self.resolve_repo_root(root, 0, cancel).await?;
        let primary_common = primary.common_dir.clone();
        roots.push(primary);

        let mut seen: HashSet<String> = roots.iter().map(|r| r.worktree_root.clone()).collect();
        let mut stack: Vec<(PathBuf, u32)> = vec![(root.to_path_buf(), 0)];
        while let Some((dir, depth)) = stack.pop() {
            if depth >= 4 {
                continue;
            }
            let entries = match std::fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                if SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                // Nested .git directory (or file for worktrees/submodules).
                let git_marker = path.join(".git");
                if git_marker.exists() {
                    let key = path
                        .canonicalize()
                        .unwrap_or_else(|_| path.clone())
                        .to_string_lossy()
                        .into_owned();
                    if !seen.contains(&key) && !seen.contains(&path.to_string_lossy().into_owned())
                    {
                        if let Ok(mut r) = self.resolve_repo_root(&path, roots.len(), cancel).await
                        {
                            // Skip linked worktrees of the same common-dir (shown in Worktrees tab).
                            if r.common_dir == primary_common && r.is_worktree {
                                continue;
                            }
                            // Mark submodule roots from .gitmodules presence of parent.
                            if root.join(".gitmodules").exists() {
                                r.is_submodule = true;
                            }
                            seen.insert(r.worktree_root.clone());
                            roots.push(r);
                        }
                    }
                }
                stack.push((path, depth + 1));
            }
        }
        Ok(roots)
    }
}

fn absolutize(cwd: &Path, raw: &str) -> String {
    let path = crate::resolve_git_path(cwd, raw);
    path.canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}
