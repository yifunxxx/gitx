//! Multi-root workspace discovery and synchronized branch ops (#33, 1.6).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode, MultiRootOpResult, MultiRootOpStep, RepoRoot};
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
        let toplevel = lines.next().unwrap_or("").trim().to_string();
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
                        match self.resolve_repo_root(&path, roots.len(), cancel).await {
                            Ok(mut r) => {
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
                            Err(_) => {}
                        }
                    }
                }
                stack.push((path, depth + 1));
            }
        }
        Ok(roots)
    }

    /// Checkout `target` on every root that has the branch; rollback on failure when requested.
    pub async fn multi_root_checkout(
        &self,
        roots: &[String],
        target: &str,
        mode: &str,
        rollback_on_fail: bool,
        cancel: &CancellationToken,
    ) -> Result<MultiRootOpResult, AppError> {
        let mut steps = Vec::new();
        let mut previous: Vec<(String, String)> = Vec::new(); // (path, previous ref)

        for path in roots {
            let cwd = PathBuf::from(path);
            let prev = self
                .rev_parse_abbrev_public(&cwd, "HEAD", cancel)
                .await
                .unwrap_or_else(|_| "HEAD".into());
            // Skip roots that lack the local branch (unless revision/remote mode).
            if mode == "local" {
                let check = GitInvocation::new(
                    &cwd,
                    [
                        "show-ref",
                        "--verify",
                        "--quiet",
                        &format!("refs/heads/{target}"),
                    ],
                )
                .kind(OpKind::Read)
                .git_bin(self.git_bin.clone());
                if self.run(check, cancel).await.is_err() {
                    steps.push(MultiRootOpStep {
                        repo_id: path.clone(),
                        path: path.clone(),
                        ok: true,
                        previous_ref: Some(prev),
                        error: Some(format!("skipped — branch '{target}' not present")),
                    });
                    continue;
                }
            }

            previous.push((path.clone(), prev.clone()));
            match self.branch_checkout(&cwd, target, mode, cancel).await {
                Ok(()) => steps.push(MultiRootOpStep {
                    repo_id: path.clone(),
                    path: path.clone(),
                    ok: true,
                    previous_ref: Some(prev),
                    error: None,
                }),
                Err(e) => {
                    steps.push(MultiRootOpStep {
                        repo_id: path.clone(),
                        path: path.clone(),
                        ok: false,
                        previous_ref: Some(prev),
                        error: Some(e.message.clone()),
                    });
                    if rollback_on_fail {
                        for (p, old) in previous.iter().rev() {
                            let _ = self
                                .branch_checkout(Path::new(p), old, "local", cancel)
                                .await;
                        }
                        return Ok(MultiRootOpResult {
                            ok: false,
                            steps,
                            rolled_back: true,
                        });
                    }
                    return Ok(MultiRootOpResult {
                        ok: false,
                        steps,
                        rolled_back: false,
                    });
                }
            }
        }

        Ok(MultiRootOpResult {
            ok: steps.iter().all(|s| s.ok),
            steps,
            rolled_back: false,
        })
    }

    /// Explicit rollback helper: restore each root to `previous_ref`.
    pub async fn multi_root_rollback(
        &self,
        steps: &[MultiRootOpStep],
        cancel: &CancellationToken,
    ) -> Result<MultiRootOpResult, AppError> {
        let mut out = Vec::new();
        for step in steps.iter().rev() {
            let Some(prev) = step.previous_ref.as_deref() else {
                continue;
            };
            if !step.ok
                && step
                    .error
                    .as_deref()
                    .is_some_and(|e| e.starts_with("skipped"))
            {
                continue;
            }
            match self
                .branch_checkout(Path::new(&step.path), prev, "local", cancel)
                .await
            {
                Ok(()) => out.push(MultiRootOpStep {
                    repo_id: step.repo_id.clone(),
                    path: step.path.clone(),
                    ok: true,
                    previous_ref: Some(prev.to_string()),
                    error: None,
                }),
                Err(e) => out.push(MultiRootOpStep {
                    repo_id: step.repo_id.clone(),
                    path: step.path.clone(),
                    ok: false,
                    previous_ref: Some(prev.to_string()),
                    error: Some(e.message),
                }),
            }
        }
        Ok(MultiRootOpResult {
            ok: out.iter().all(|s| s.ok),
            steps: out,
            rolled_back: true,
        })
    }
}

fn absolutize(cwd: &Path, raw: &str) -> String {
    let p = PathBuf::from(raw);
    if p.is_absolute() {
        p.to_string_lossy().into_owned()
    } else {
        cwd.join(p).to_string_lossy().into_owned()
    }
}
