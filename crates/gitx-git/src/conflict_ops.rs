//! Conflicts list / accept side / versions / save (M4).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{
    AppError, ConflictEntry, ConflictKind, ConflictSide, ConflictSideStatus, ConflictVersions,
    ConflictsList, ErrorCode, Merge3Result, RepoOpKind,
};
use std::collections::BTreeMap;
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitRunner {
    pub async fn conflicts_list(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<ConflictsList, AppError> {
        let state = self.repo_op_state(cwd, cancel).await?;
        let inv = GitInvocation::new(cwd, ["ls-files", "-u", "-z"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let raw = String::from_utf8_lossy(&out.stdout);

        // path -> stages present (1=base, 2=ours, 3=theirs) + mode hints
        let mut stages: BTreeMap<String, (bool, bool, bool, bool)> = BTreeMap::new();
        // (has1, has2, has3, is_gitlink_or_binary_hint)
        for chunk in raw.split('\0') {
            if chunk.is_empty() {
                continue;
            }
            let (meta, path) = match chunk.split_once('\t') {
                Some(p) => p,
                None => continue,
            };
            let parts: Vec<&str> = meta.split_whitespace().collect();
            if parts.len() < 3 {
                continue;
            }
            let mode = parts[0];
            let stage: u8 = parts[2].parse().unwrap_or(0);
            let e = stages
                .entry(path.to_string())
                .or_insert((false, false, false, false));
            match stage {
                1 => e.0 = true,
                2 => e.1 = true,
                3 => e.2 = true,
                _ => {}
            }
            if mode.starts_with("160000") || mode.starts_with("120000") {
                e.3 = true;
            }
        }

        let mut entries = Vec::new();
        for (path, (b, o, t, special)) in stages {
            let (kind, yours, theirs) = classify_conflict(b, o, t, special);
            // Binary heuristic: try show :2: and check null bytes (best-effort).
            let kind = if kind == ConflictKind::Content {
                if self.is_binary_stage(cwd, &path, 2, cancel).await
                    || self.is_binary_stage(cwd, &path, 3, cancel).await
                {
                    ConflictKind::Binary
                } else {
                    kind
                }
            } else {
                kind
            };
            entries.push(ConflictEntry {
                path,
                kind,
                yours,
                theirs,
            });
        }

        Ok(ConflictsList {
            entries,
            yours_label: state.yours_label,
            theirs_label: state.theirs_label,
            title: if state.summary.is_empty() {
                "Conflicts".into()
            } else {
                state.summary
            },
        })
    }

    pub async fn conflict_accept_side(
        &self,
        cwd: &Path,
        paths: &[String],
        side: ConflictSide,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let list = self.conflicts_list(cwd, cancel).await?;
        let by_path: BTreeMap<_, _> = list
            .entries
            .into_iter()
            .map(|e| (e.path.clone(), e))
            .collect();

        for path in paths {
            let entry = by_path.get(path);
            let side_status = entry.map(|e| match side {
                ConflictSide::Ours => e.yours,
                ConflictSide::Theirs => e.theirs,
            });

            if side_status == Some(ConflictSideStatus::Deleted)
                || (side_status == Some(ConflictSideStatus::None)
                    && entry
                        .map(|e| e.kind == ConflictKind::DeleteModify)
                        .unwrap_or(false))
            {
                // Accept deletion.
                let inv = GitInvocation::new(cwd, ["rm", "-f", "--", path])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                self.run(inv, cancel).await?;
                continue;
            }

            let flag = match side {
                ConflictSide::Ours => "--ours",
                ConflictSide::Theirs => "--theirs",
            };
            let inv = GitInvocation::new(cwd, ["checkout", flag, "--", path])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            match self.run(inv, cancel).await {
                Ok(_) => {}
                Err(e) => {
                    // delete-modify where accepted side is the surviving file may need checkout -f
                    let inv2 = GitInvocation::new(cwd, ["checkout", flag, "-f", "--", path])
                        .kind(OpKind::Write)
                        .git_bin(self.git_bin.clone());
                    self.run(inv2, cancel).await.map_err(|_| e)?;
                }
            }
            let inv = GitInvocation::new(cwd, ["add", "--", path])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            self.run(inv, cancel).await?;
        }
        Ok(())
    }

    pub async fn conflict_versions(
        &self,
        cwd: &Path,
        path: &str,
        cancel: &CancellationToken,
    ) -> Result<ConflictVersions, AppError> {
        let base = self.show_stage(cwd, path, 1, cancel).await?;
        let ours = self.show_stage(cwd, path, 2, cancel).await?;
        let theirs = self.show_stage(cwd, path, 3, cancel).await?;
        let is_binary = looks_binary(&base) || looks_binary(&ours) || looks_binary(&theirs);

        Ok(ConflictVersions {
            path: path.to_string(),
            base: base.map(|b| String::from_utf8_lossy(&b).into_owned()),
            ours: ours.map(|b| String::from_utf8_lossy(&b).into_owned()),
            theirs: theirs.map(|b| String::from_utf8_lossy(&b).into_owned()),
            is_binary,
        })
    }

    pub async fn conflict_merge3(
        &self,
        cwd: &Path,
        path: &str,
        cancel: &CancellationToken,
    ) -> Result<Merge3Result, AppError> {
        let versions = self.conflict_versions(cwd, path, cancel).await?;
        if versions.is_binary {
            return Err(AppError::new(
                ErrorCode::Internal,
                "binary conflicts must Accept Yours/Theirs",
            ));
        }
        Ok(gitx_diff::merge3(
            versions.base.as_deref(),
            versions.ours.as_deref(),
            versions.theirs.as_deref(),
        ))
    }

    pub async fn conflict_save_result(
        &self,
        cwd: &Path,
        path: &str,
        content: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let full = cwd.join(path);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::new(ErrorCode::FsError, format!("mkdir: {e}")))?;
        }
        std::fs::write(&full, content.as_bytes())
            .map_err(|e| AppError::new(ErrorCode::FsError, format!("write {path}: {e}")))?;
        let inv = GitInvocation::new(cwd, ["add", "--", path])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn conflict_mark_resolved(
        &self,
        cwd: &Path,
        paths: &[String],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let mut args = vec!["add".to_string(), "--".into()];
        args.extend(paths.iter().cloned());
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    /// Resolve all non-overlapping / simple content conflicts via merge3 auto-merge.
    pub async fn conflict_resolve_simple(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<u32, AppError> {
        let list = self.conflicts_list(cwd, cancel).await?;
        let mut resolved = 0u32;
        for entry in list.entries {
            if entry.kind != ConflictKind::Content {
                continue;
            }
            let merge = match self.conflict_merge3(cwd, &entry.path, cancel).await {
                Ok(m) => m,
                Err(_) => continue,
            };
            if merge.conflict_count > 0 {
                // Apply non-conflicting blocks only into a candidate; skip file if still conflicted.
                continue;
            }
            let content = merge
                .blocks
                .iter()
                .flat_map(|b| b.result_lines.iter().cloned())
                .collect::<Vec<_>>()
                .concat();
            self.conflict_save_result(cwd, &entry.path, &content, cancel)
                .await?;
            resolved += 1;
        }
        let _ = RepoOpKind::Normal;
        Ok(resolved)
    }

    async fn show_stage(
        &self,
        cwd: &Path,
        path: &str,
        stage: u8,
        cancel: &CancellationToken,
    ) -> Result<Option<Vec<u8>>, AppError> {
        let spec = format!(":{stage}:{path}");
        let inv = GitInvocation::new(cwd, ["show", &spec])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(out) => Ok(Some(out.stdout)),
            Err(_) => Ok(None),
        }
    }

    async fn is_binary_stage(
        &self,
        cwd: &Path,
        path: &str,
        stage: u8,
        cancel: &CancellationToken,
    ) -> bool {
        match self.show_stage(cwd, path, stage, cancel).await {
            Ok(Some(bytes)) => bytes.iter().take(8000).any(|&b| b == 0),
            _ => false,
        }
    }
}

fn looks_binary(bytes: &Option<Vec<u8>>) -> bool {
    bytes
        .as_ref()
        .map(|x| x.iter().take(8000).any(|&c| c == 0))
        .unwrap_or(false)
}

fn classify_conflict(
    has_base: bool,
    has_ours: bool,
    has_theirs: bool,
    special: bool,
) -> (ConflictKind, ConflictSideStatus, ConflictSideStatus) {
    if special {
        return (
            ConflictKind::Submodule,
            if has_ours {
                ConflictSideStatus::Modified
            } else {
                ConflictSideStatus::Deleted
            },
            if has_theirs {
                ConflictSideStatus::Modified
            } else {
                ConflictSideStatus::Deleted
            },
        );
    }
    match (has_base, has_ours, has_theirs) {
        (true, true, true) => (
            ConflictKind::Content,
            ConflictSideStatus::Modified,
            ConflictSideStatus::Modified,
        ),
        (true, true, false) => (
            ConflictKind::DeleteModify,
            ConflictSideStatus::Modified,
            ConflictSideStatus::Deleted,
        ),
        (true, false, true) => (
            ConflictKind::DeleteModify,
            ConflictSideStatus::Deleted,
            ConflictSideStatus::Modified,
        ),
        (false, true, true) => (
            ConflictKind::AddAdd,
            ConflictSideStatus::Added,
            ConflictSideStatus::Added,
        ),
        (false, true, false) => (
            ConflictKind::Content,
            ConflictSideStatus::Added,
            ConflictSideStatus::None,
        ),
        (false, false, true) => (
            ConflictKind::Content,
            ConflictSideStatus::None,
            ConflictSideStatus::Added,
        ),
        _ => (
            ConflictKind::Content,
            ConflictSideStatus::Modified,
            ConflictSideStatus::Modified,
        ),
    }
}
