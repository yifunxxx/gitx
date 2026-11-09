//! Refs listing and branch/tag CRUD (M2).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode, RefEntry, RefKind, RefsList};
use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

impl GitRunner {
    pub async fn refs_list(
        &self,
        cwd: &Path,
        favorites: &HashSet<String>,
        cancel: &CancellationToken,
    ) -> Result<RefsList, AppError> {
        // Field separator RS (\x1e); one ref per line. Avoid NUL ambiguity with -z+%00.
        let format = "%(refname)%1e%(objectname)%1e%(upstream)%1e%(upstream:track,nobracket)%1e%(HEAD)%1e%(committerdate:unix)%1e%(subject)%1e%(*objectname)";
        let inv = GitInvocation::new(
            cwd,
            [
                "for-each-ref",
                &format!("--format={format}"),
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let raw = String::from_utf8_lossy(&out.stdout);
        let mut local = Vec::new();
        let mut remote = Vec::new();
        let mut tags = Vec::new();
        let mut current = None;
        let mut detached = false;

        for line in raw.lines() {
            let flat: Vec<&str> = line.split('\u{001e}').collect();
            if flat.len() < 8 {
                continue;
            }
            let full = flat[0];
            let sha = flat[1];
            let upstream = flat[2];
            let track = flat[3];
            let head_mark = flat[4];
            let date = flat[5];
            let subject = flat[6];
            let peeled = flat[7];

            if full.is_empty() {
                continue;
            }

            let (kind, name) = if let Some(n) = full.strip_prefix("refs/heads/") {
                (RefKind::LocalBranch, n.to_string())
            } else if let Some(n) = full.strip_prefix("refs/remotes/") {
                if n.ends_with("/HEAD") {
                    continue;
                }
                (RefKind::RemoteBranch, n.to_string())
            } else if let Some(n) = full.strip_prefix("refs/tags/") {
                (RefKind::Tag, n.to_string())
            } else {
                continue;
            };

            let (ahead, behind) = parse_track(track);
            let is_head = head_mark == "*";
            if is_head {
                current = Some(name.clone());
            }

            let entry = RefEntry {
                name: name.clone(),
                full_name: full.to_string(),
                kind,
                sha: sha.to_string(),
                upstream: if upstream.is_empty() {
                    None
                } else {
                    Some(
                        upstream
                            .strip_prefix("refs/remotes/")
                            .unwrap_or(upstream)
                            .to_string(),
                    )
                },
                ahead,
                behind,
                is_head,
                subject: if subject.is_empty() {
                    None
                } else {
                    Some(subject.to_string())
                },
                committer_time: date.parse().ok(),
                peeled_sha: if peeled.is_empty() {
                    None
                } else {
                    Some(peeled.to_string())
                },
                is_favorite: favorites.contains(full) || favorites.contains(&name),
            };

            match kind {
                RefKind::LocalBranch => local.push(entry),
                RefKind::RemoteBranch => remote.push(entry),
                RefKind::Tag => tags.push(entry),
            }
        }

        // Detached HEAD detection via symbolic-ref.
        let head_inv = GitInvocation::new(cwd, ["symbolic-ref", "-q", "HEAD"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        if self.run(head_inv, cancel).await.is_err() {
            detached = true;
            current = None;
            let sha_inv = GitInvocation::new(cwd, ["rev-parse", "--short", "HEAD"])
                .kind(OpKind::Read)
                .git_bin(self.git_bin.clone());
            if let Ok(out) = self.run(sha_inv, cancel).await {
                current = Some(String::from_utf8_lossy(&out.stdout).trim().to_string());
            }
        }

        let recent = self
            .recent_branches(cwd, 5, cancel)
            .await
            .unwrap_or_default();

        // Favorites first within each list.
        let sort_fav = |a: &RefEntry, b: &RefEntry| match (a.is_favorite, b.is_favorite) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        };
        local.sort_by(sort_fav);
        remote.sort_by(sort_fav);
        tags.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(RefsList {
            local,
            remote,
            tags,
            recent,
            current,
            detached,
        })
    }

    async fn recent_branches(
        &self,
        cwd: &Path,
        limit: usize,
        cancel: &CancellationToken,
    ) -> Result<Vec<String>, AppError> {
        let inv = GitInvocation::new(cwd, ["reflog", "HEAD", "-n", "500", "--format=%gs"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = match self.run(inv, cancel).await {
            Ok(o) => o,
            Err(_) => return Ok(Vec::new()),
        };
        let text = String::from_utf8_lossy(&out.stdout);
        let mut seen = HashSet::new();
        let mut recent = Vec::new();
        for line in text.lines() {
            // checkout: moving from X to Y
            if let Some(rest) = line.strip_prefix("checkout: moving from ") {
                if let Some((_, to)) = rest.rsplit_once(" to ") {
                    let name = to.trim();
                    if name != "HEAD" && !name.is_empty() && seen.insert(name.to_string()) {
                        recent.push(name.to_string());
                        if recent.len() >= limit {
                            break;
                        }
                    }
                }
            }
        }
        Ok(recent)
    }

    pub async fn check_ref_format(
        &self,
        cwd: &Path,
        name: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let inv = GitInvocation::new(cwd, ["check-ref-format", "--branch", name])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await.map_err(|_| {
            AppError::new(
                ErrorCode::InvalidRefName,
                format!("invalid branch name: {name}"),
            )
        })?;
        Ok(())
    }

    pub async fn branch_create(
        &self,
        cwd: &Path,
        name: &str,
        start_point: Option<&str>,
        checkout: bool,
        force: bool,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        self.check_ref_format(cwd, name, cancel).await?;
        let start = start_point.unwrap_or("HEAD");
        if checkout {
            let mut args = vec!["checkout".to_string()];
            if force {
                args.push("-B".into());
            } else {
                args.push("-b".into());
            }
            args.push(name.into());
            args.push(start.into());
            // Track when creating from a remote-tracking branch.
            if start.contains('/') && !start.starts_with("refs/heads/") {
                args.push("--track".into());
            }
            let inv = GitInvocation::new(cwd, args)
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            self.run(inv, cancel).await?;
        } else {
            let mut args = vec!["branch".to_string()];
            if force {
                args.push("-f".into());
            }
            args.push(name.into());
            args.push(start.into());
            let inv = GitInvocation::new(cwd, args)
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            self.run(inv, cancel).await?;
        }
        Ok(())
    }

    pub async fn branch_checkout(
        &self,
        cwd: &Path,
        target: &str,
        mode: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if cancel.is_cancelled() {
            return Err(AppError::new(ErrorCode::Cancelled, "operation cancelled"));
        }
        if !matches!(mode, "local" | "remote" | "revision")
            || target.is_empty()
            || target.starts_with('-')
        {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "invalid checkout target or mode",
            ));
        }
        self.ensure_not_busy(cwd, cancel).await?;
        let inv = match mode {
            "revision" => {
                let revision = self
                    .rev_parse_public(cwd, &format!("{target}^{{commit}}"), cancel)
                    .await?;
                GitInvocation::new(cwd, ["checkout", "--detach", &revision, "--"])
            }
            "remote" => {
                let remote_name = target.strip_prefix("refs/remotes/").unwrap_or(target);
                let remote_ref = format!("refs/remotes/{remote_name}");
                if !self.checkout_ref_exists(cwd, &remote_ref, cancel).await? {
                    return Err(AppError::new(
                        ErrorCode::NotFound,
                        format!("remote branch does not exist: {target}"),
                    ));
                }
                // Remote names can contain '/'. Match the longest configured
                // prefix, preserving every directory in the branch name.
                let remotes = self
                    .run(GitInvocation::new(cwd, ["remote"]), cancel)
                    .await?;
                let remotes = String::from_utf8_lossy(&remotes.stdout);
                let remote = remotes
                    .lines()
                    .filter(|name| {
                        remote_name
                            .strip_prefix(name)
                            .is_some_and(|rest| rest.starts_with('/'))
                    })
                    .max_by_key(|name| name.len())
                    .ok_or_else(|| {
                        AppError::new(
                            ErrorCode::RemoteNotFound,
                            format!("no configured remote matches {target}"),
                        )
                    })?;
                let local = &remote_name[remote.len() + 1..];
                if local.is_empty() || local.starts_with('-') {
                    return Err(AppError::new(
                        ErrorCode::InvalidRefName,
                        "invalid local tracking branch name",
                    ));
                }
                let local_ref = format!("refs/heads/{local}");
                if self.checkout_ref_exists(cwd, &local_ref, cancel).await? {
                    let upstreams = self
                        .run(
                            GitInvocation::new(
                                cwd,
                                [
                                    "for-each-ref",
                                    "--format=%(refname)%1e%(upstream)",
                                    &local_ref,
                                ],
                            ),
                            cancel,
                        )
                        .await?;
                    let upstreams = String::from_utf8_lossy(&upstreams.stdout);
                    let upstream = upstreams
                        .lines()
                        .filter_map(|line| line.split_once('\u{001e}'))
                        .find(|(name, _)| *name == local_ref)
                        .map(|(_, upstream)| upstream);
                    if upstream != Some(remote_ref.as_str()) {
                        return Err(AppError::new(ErrorCode::RefAlreadyExists,
                            format!("local branch '{local}' already exists and does not track '{target}'; select it explicitly or create a branch with another name")));
                    }
                    GitInvocation::new(cwd, ["checkout", "--no-guess", local, "--"])
                } else {
                    GitInvocation::new(cwd, ["checkout", "-b", local, "--track", &remote_ref, "--"])
                }
            }
            _ => {
                let branch = target.strip_prefix("refs/heads/").unwrap_or(target);
                if branch.starts_with('-')
                    || !self
                        .checkout_ref_exists(cwd, &format!("refs/heads/{branch}"), cancel)
                        .await?
                {
                    return Err(AppError::new(
                        ErrorCode::NotFound,
                        format!("local branch does not exist: {target}"),
                    ));
                }
                GitInvocation::new(cwd, ["checkout", "--no-guess", branch, "--"])
            }
        };
        self.run(inv.kind(OpKind::Write), cancel)
            .await
            .map_err(|e| {
                let msg = e.message.to_lowercase();
                if msg.contains("already checked out")
                    || msg.contains("is already used by worktree")
                {
                    AppError::new(ErrorCode::BranchInUse, e.message)
                        .with_stderr(e.git_stderr.unwrap_or_default())
                } else {
                    e
                }
            })?;
        Ok(())
    }

    async fn checkout_ref_exists(
        &self,
        cwd: &Path,
        reference: &str,
        cancel: &CancellationToken,
    ) -> Result<bool, AppError> {
        match self
            .run(
                GitInvocation::new(cwd, ["show-ref", "--verify", "--quiet", reference]),
                cancel,
            )
            .await
        {
            Ok(_) => Ok(true),
            Err(error)
                if error.exit_code == Some(1)
                    && error.git_stderr.as_deref().unwrap_or("").trim().is_empty() =>
            {
                Ok(false)
            }
            Err(error) => Err(error),
        }
    }

    pub async fn branch_rename(
        &self,
        cwd: &Path,
        old: &str,
        new: &str,
        unset_upstream: bool,
        force: bool,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        self.check_ref_format(cwd, new, cancel).await?;
        let flag = if force { "-M" } else { "-m" };
        // Case-only rename on case-insensitive FS: two-step via temp.
        if old.to_lowercase() == new.to_lowercase() && old != new {
            let tmp = format!("gitx-rename-tmp-{old}");
            let inv = GitInvocation::new(cwd, ["branch", "-m", old, &tmp])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            self.run(inv, cancel).await?;
            let inv = GitInvocation::new(cwd, ["branch", "-m", &tmp, new])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            self.run(inv, cancel).await?;
        } else {
            let inv = GitInvocation::new(cwd, ["branch", flag, old, new])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            self.run(inv, cancel).await?;
        }
        if unset_upstream {
            let inv = GitInvocation::new(cwd, ["branch", "--unset-upstream", new])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            let _ = self.run(inv, cancel).await;
        }
        Ok(())
    }

    pub async fn branch_delete(
        &self,
        cwd: &Path,
        name: &str,
        force: bool,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        // Capture sha before delete for restore.
        let sha_inv = GitInvocation::new(cwd, ["rev-parse", name])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let sha_out = self.run(sha_inv, cancel).await?;
        let sha = String::from_utf8_lossy(&sha_out.stdout).trim().to_string();

        let flag = if force { "-D" } else { "-d" };
        let inv = GitInvocation::new(cwd, ["branch", flag, name])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(_) => {
                // Backup ref for restore.
                let backup = format!(
                    "refs/gitx/backup/branch-{}-{}",
                    name.replace('/', "-"),
                    chrono_like_ts()
                );
                let inv = GitInvocation::new(cwd, ["update-ref", &backup, &sha])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                let _ = self.run(inv, cancel).await;
                Ok(sha)
            }
            Err(e) => {
                let msg = e.message.to_lowercase();
                if msg.contains("not fully merged") {
                    Err(AppError::new(
                        ErrorCode::BranchNotFullyMerged,
                        format!("branch '{name}' is not fully merged"),
                    )
                    .with_stderr(e.git_stderr.unwrap_or_default()))
                } else {
                    Err(e)
                }
            }
        }
    }

    pub async fn branch_restore(
        &self,
        cwd: &Path,
        name: &str,
        sha: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let inv = GitInvocation::new(cwd, ["branch", name, sha])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn branch_update_ff(
        &self,
        cwd: &Path,
        local: &str,
        remote_ref: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        // Fast-forward local branch without checkout: fetch remote:local.
        // Caller should pass "origin/feature" style or full remote refspec.
        let inv = GitInvocation::new(cwd, ["fetch", ".", &format!("{remote_ref}:{local}")])
            .kind(OpKind::Write)
            .timeout(Some(Duration::from_secs(120)))
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await.map_err(|e| {
            let msg = e.message.to_lowercase();
            if msg.contains("non-fast-forward") || msg.contains("rejected") {
                AppError::new(
                    ErrorCode::NonFastForward,
                    format!("cannot fast-forward '{local}'"),
                )
                .with_stderr(e.git_stderr.unwrap_or_default())
            } else {
                e
            }
        })?;
        Ok(())
    }

    pub async fn tag_create(
        &self,
        cwd: &Path,
        name: &str,
        target: &str,
        message: Option<&str>,
        force: bool,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let check = GitInvocation::new(cwd, ["check-ref-format", &format!("refs/tags/{name}")])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        self.run(check, cancel).await.map_err(|_| {
            AppError::new(
                ErrorCode::InvalidRefName,
                format!("invalid tag name: {name}"),
            )
        })?;

        let mut args = vec!["tag".to_string()];
        if force {
            args.push("-f".into());
        }
        if let Some(msg) = message.filter(|m| !m.trim().is_empty()) {
            args.push("-a".into());
            args.push("-m".into());
            args.push(msg.to_string());
        }
        args.push(name.into());
        args.push(target.into());
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await.map_err(|e| {
            if e.message.to_lowercase().contains("already exists") {
                AppError::new(
                    ErrorCode::RefAlreadyExists,
                    format!("tag '{name}' already exists"),
                )
            } else {
                e
            }
        })?;
        Ok(())
    }

    pub async fn tag_delete(
        &self,
        cwd: &Path,
        name: &str,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let sha_inv = GitInvocation::new(cwd, ["rev-parse", &format!("refs/tags/{name}")])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let sha_out = self.run(sha_inv, cancel).await?;
        let sha = String::from_utf8_lossy(&sha_out.stdout).trim().to_string();
        let inv = GitInvocation::new(cwd, ["tag", "-d", name])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        let backup = format!(
            "refs/gitx/backup/tag-{}-{}",
            name.replace('/', "-"),
            chrono_like_ts()
        );
        let inv = GitInvocation::new(cwd, ["update-ref", &backup, &sha])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        let _ = self.run(inv, cancel).await;
        Ok(sha)
    }

    pub async fn compare_range(
        &self,
        cwd: &Path,
        left: &str,
        right: &str,
        cancel: &CancellationToken,
    ) -> Result<gitx_core::CompareRange, AppError> {
        let left_only = self
            .rev_list_range(cwd, &format!("{left}..{right}"), cancel)
            .await?;
        let right_only = self
            .rev_list_range(cwd, &format!("{right}..{left}"), cancel)
            .await?;
        Ok(gitx_core::CompareRange {
            left: left.to_string(),
            right: right.to_string(),
            left_only,
            right_only,
        })
    }

    async fn rev_list_range(
        &self,
        cwd: &Path,
        range: &str,
        cancel: &CancellationToken,
    ) -> Result<Vec<String>, AppError> {
        let inv = GitInvocation::new(cwd, ["rev-list", "--oneline", range])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let text = String::from_utf8_lossy(&out.stdout);
        Ok(text
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect())
    }
}

fn parse_track(track: &str) -> (Option<u32>, Option<u32>) {
    // Formats: "ahead 2", "behind 1", "ahead 2, behind 1", "gone"
    if track.is_empty() || track == "gone" {
        return (None, None);
    }
    let mut ahead = None;
    let mut behind = None;
    for part in track.split(',') {
        let p = part.trim();
        if let Some(n) = p.strip_prefix("ahead ") {
            ahead = n.trim().parse().ok();
        } else if let Some(n) = p.strip_prefix("behind ") {
            behind = n.trim().parse().ok();
        }
    }
    (ahead, behind)
}

fn chrono_like_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
