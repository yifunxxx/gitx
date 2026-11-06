//! Fetch / pull / push / update project (M2).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{
    AppError, ChangedFile, ErrorCode, FetchSummary, FetchTagsPolicy, IncomingCheck, PullResult,
    PushOutcome, PushPreview, PushRefspec, PushResult, UpdateInfo, UpdateMethod,
};
use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

impl GitRunner {
    pub async fn fetch_run(
        &self,
        cwd: &Path,
        remote: Option<&str>,
        prune: bool,
        tags: FetchTagsPolicy,
        cancel: &CancellationToken,
    ) -> Result<FetchSummary, AppError> {
        let before = self.remote_tips(cwd, cancel).await.unwrap_or_default();

        let mut args = vec!["fetch".to_string(), "--progress".into()];
        match remote {
            Some(r) if r != "all" => args.push(r.to_string()),
            _ => args.push("--all".into()),
        }
        if prune {
            args.push("--prune".into());
        }
        match tags {
            FetchTagsPolicy::Auto => {}
            FetchTagsPolicy::Always => args.push("--tags".into()),
            FetchTagsPolicy::Never => args.push("--no-tags".into()),
            FetchTagsPolicy::SyncAndPrune => {
                args.push("--tags".into());
                args.push("--prune".into());
                args.push("--prune-tags".into());
            }
        }

        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Network)
            .timeout(Some(Duration::from_secs(600)))
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await.map_err(map_network_err)?;

        let after = self.remote_tips(cwd, cancel).await.unwrap_or_default();
        let mut new_branches = 0u32;
        let mut updated_branches = 0u32;
        for (k, sha) in &after {
            match before.get(k) {
                None => new_branches += 1,
                Some(old) if old != sha => updated_branches += 1,
                _ => {}
            }
        }
        let pruned = before.keys().filter(|k| !after.contains_key(*k)).count() as u32;

        let message = if new_branches == 0 && updated_branches == 0 && pruned == 0 {
            "Everything is up to date".into()
        } else {
            format!(
                "Fetched: {new_branches} new branches, {updated_branches} updated, {pruned} pruned"
            )
        };

        Ok(FetchSummary {
            remote: remote.unwrap_or("all").to_string(),
            new_branches,
            updated_branches,
            new_tags: 0,
            pruned,
            message,
        })
    }

    async fn remote_tips(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<std::collections::BTreeMap<String, String>, AppError> {
        let inv = GitInvocation::new(
            cwd,
            [
                "for-each-ref",
                "--format=%(refname)%09%(objectname)",
                "refs/remotes",
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let mut map = std::collections::BTreeMap::new();
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Some((k, v)) = line.split_once('\t') {
                map.insert(k.to_string(), v.to_string());
            }
        }
        Ok(map)
    }

    pub async fn pull_run(
        &self,
        cwd: &Path,
        remote: &str,
        branch: &str,
        rebase: bool,
        ff_only: bool,
        no_ff: bool,
        squash: bool,
        no_commit: bool,
        no_verify: bool,
        cancel: &CancellationToken,
    ) -> Result<PullResult, AppError> {
        let old = self
            .rev_parse(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let mut args = vec!["pull".to_string(), "--progress".into(), "--no-edit".into()];
        if rebase {
            args.push("--rebase".into());
        }
        if ff_only {
            args.push("--ff-only".into());
        }
        if no_ff {
            args.push("--no-ff".into());
        }
        if squash {
            args.push("--squash".into());
        }
        if no_commit {
            args.push("--no-commit".into());
        }
        if no_verify {
            args.push("--no-verify".into());
        }
        args.push(remote.into());
        args.push(branch.into());

        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::NetworkWrite)
            .timeout(Some(Duration::from_secs(600)))
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await.map_err(map_network_err)?;

        let new = self
            .rev_parse(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let updated = old != new;
        Ok(PullResult {
            old_head: old,
            new_head: new,
            strategy: if rebase {
                "rebase".into()
            } else if squash {
                "squash".into()
            } else {
                "merge".into()
            },
            updated,
            message: if updated {
                "Pulled successfully".into()
            } else {
                "Already up to date".into()
            },
        })
    }

    pub async fn update_project_run(
        &self,
        cwd: &Path,
        strategy: UpdateMethod,
        cancel: &CancellationToken,
    ) -> Result<UpdateInfo, AppError> {
        // Fetch upstream remote first.
        let upstream = self.upstream_ref(cwd, cancel).await?;
        let (remote, _) = upstream
            .split_once('/')
            .map(|(r, b)| (r.to_string(), b.to_string()))
            .unwrap_or_else(|| ("origin".into(), "main".into()));

        let _ = self
            .fetch_run(cwd, Some(&remote), true, FetchTagsPolicy::Auto, cancel)
            .await?;

        let old = self
            .rev_parse(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let upstream_now = self
            .upstream_ref(cwd, cancel)
            .await
            .unwrap_or_else(|_| format!("{remote}/HEAD"));

        match strategy {
            UpdateMethod::Merge => {
                let inv = GitInvocation::new(cwd, ["merge", "--no-edit", "@{u}"])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                self.run(inv, cancel).await?;
            }
            UpdateMethod::Rebase => {
                let inv = GitInvocation::new(cwd, ["rebase", "@{u}"])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                self.run(inv, cancel).await?;
            }
            UpdateMethod::Reset => {
                // Safety backup of HEAD.
                let backup = format!("refs/gitx/backup/update-reset-{}", now_ts());
                let inv = GitInvocation::new(cwd, ["update-ref", &backup, "HEAD"])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                let _ = self.run(inv, cancel).await;
                let inv = GitInvocation::new(cwd, ["reset", "--keep", "@{u}"])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                self.run(inv, cancel).await?;
            }
        }

        let new = self
            .rev_parse(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let updated_files = if old != new {
            self.name_status(cwd, &old, &new, cancel)
                .await
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let commits = if old != new {
            self.rev_list_oneline(cwd, &format!("{old}..{new}"), cancel)
                .await
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        let strategy_s = match strategy {
            UpdateMethod::Merge => "merge",
            UpdateMethod::Rebase => "rebase",
            UpdateMethod::Reset => "reset",
        };
        let message = if old == new {
            "All files are up-to-date".into()
        } else {
            format!(
                "{} files updated in {} commits",
                updated_files.len(),
                commits.len()
            )
        };

        let _ = upstream_now;
        Ok(UpdateInfo {
            old_head: old,
            new_head: new,
            strategy: strategy_s.into(),
            updated_files,
            commits,
            message,
        })
    }

    pub async fn push_preview(
        &self,
        cwd: &Path,
        remote: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<PushPreview, AppError> {
        let remotes = self.remote_list(cwd, cancel).await?;
        let has_remote = !remotes.is_empty();
        let remote_name = remote
            .map(|s| s.to_string())
            .or_else(|| remotes.first().map(|r| r.name.clone()))
            .unwrap_or_else(|| "origin".into());

        let branch = self
            .rev_parse_abbrev(cwd, "HEAD", cancel)
            .await
            .unwrap_or_else(|_| "HEAD".into());
        let upstream = self.upstream_ref(cwd, cancel).await.ok();
        let set_upstream = upstream.is_none();

        let commits = if let Some(up) = &upstream {
            self.rev_list_oneline(cwd, &format!("{up}..HEAD"), cancel)
                .await
                .unwrap_or_default()
        } else {
            self.rev_list_oneline(cwd, "HEAD", cancel)
                .await
                .unwrap_or_default()
                .into_iter()
                .take(20)
                .collect()
        };

        Ok(PushPreview {
            remote: remote_name.clone(),
            refs: vec![PushRefspec {
                local: branch.clone(),
                remote: remote_name,
                remote_branch: branch,
            }],
            commits,
            set_upstream,
            has_remote,
        })
    }

    pub async fn push_run(
        &self,
        cwd: &Path,
        remote: &str,
        branch: &str,
        set_upstream: bool,
        force_with_lease: bool,
        push_tags: Option<&str>,
        protected: &[String],
        cancel: &CancellationToken,
    ) -> Result<PushResult, AppError> {
        if force_with_lease && is_protected(branch, protected) {
            return Err(AppError::new(
                ErrorCode::ProtectedBranch,
                format!("force push to protected branch '{branch}' is not allowed"),
            ));
        }

        let mut args = vec![
            "push".to_string(),
            "--porcelain".into(),
            "--progress".into(),
        ];
        if set_upstream {
            args.push("-u".into());
        }
        if force_with_lease {
            args.push("--force-with-lease".into());
        }
        match push_tags {
            Some("all") => args.push("--tags".into()),
            Some("current") => {
                // Push tags pointing at commits reachable from branch tip — approximate with --follow-tags.
                args.push("--follow-tags".into());
            }
            _ => {}
        }
        args.push(remote.into());
        args.push(branch.into());

        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::NetworkWrite)
            .timeout(Some(Duration::from_secs(600)))
            .git_bin(self.git_bin.clone());

        match self.run(inv, cancel).await {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout);
                let up_to_date = text
                    .lines()
                    .any(|l| l.contains("up to date") || l.contains("="));
                Ok(PushResult {
                    outcome: if up_to_date {
                        PushOutcome::UpToDate
                    } else {
                        PushOutcome::Success
                    },
                    remote: remote.into(),
                    message: if up_to_date {
                        "Everything up-to-date".into()
                    } else {
                        format!("Pushed to {remote}/{branch}")
                    },
                    rejected: false,
                    set_upstream,
                })
            }
            Err(e) => {
                let msg = e.message.to_lowercase();
                if msg.contains("non-fast-forward") || msg.contains("[rejected]") {
                    Ok(PushResult {
                        outcome: PushOutcome::Rejected,
                        remote: remote.into(),
                        message: e.message,
                        rejected: true,
                        set_upstream: false,
                    })
                } else if msg.contains("authentication")
                    || msg.contains("could not read username")
                    || msg.contains("permission denied")
                {
                    Err(AppError::new(ErrorCode::AuthRequired, e.message)
                        .with_stderr(e.git_stderr.unwrap_or_default()))
                } else {
                    Err(map_network_err(e))
                }
            }
        }
    }

    pub async fn tag_push(
        &self,
        cwd: &Path,
        name: &str,
        remote: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let inv = GitInvocation::new(
            cwd,
            ["push", "--porcelain", remote, &format!("refs/tags/{name}")],
        )
        .kind(OpKind::NetworkWrite)
        .timeout(Some(Duration::from_secs(300)))
        .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await.map_err(map_network_err)?;
        Ok(())
    }

    pub async fn remote_delete_branch(
        &self,
        cwd: &Path,
        remote: &str,
        branch: &str,
        protected: &[String],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if is_protected(branch, protected) {
            return Err(AppError::new(
                ErrorCode::ProtectedBranch,
                format!("cannot delete protected remote branch '{branch}'"),
            ));
        }
        let inv = GitInvocation::new(cwd, ["push", remote, "--delete", branch])
            .kind(OpKind::NetworkWrite)
            .timeout(Some(Duration::from_secs(300)))
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await.map_err(map_network_err)?;
        Ok(())
    }

    pub async fn ls_remote_check(
        &self,
        cwd: &Path,
        remote: &str,
        cancel: &CancellationToken,
    ) -> Result<IncomingCheck, AppError> {
        // Compare ls-remote heads with local remote-tracking tips for tracked branches only.
        let inv = GitInvocation::new(cwd, ["ls-remote", "--heads", remote])
            .kind(OpKind::Network)
            .timeout(Some(Duration::from_secs(60)))
            .git_bin(self.git_bin.clone());
        let out = match self.run(inv, cancel).await {
            Ok(o) => o,
            Err(e) => {
                // Auto mode: auth-required → treat as no check.
                if e.message.to_lowercase().contains("authentication")
                    || e.message.to_lowercase().contains("could not read")
                {
                    return Ok(IncomingCheck {
                        has_unfetched: false,
                        remotes: vec![],
                    });
                }
                return Err(map_network_err(e));
            }
        };
        let remote_map: std::collections::BTreeMap<String, String> =
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter_map(|l| {
                    let mut p = l.split_whitespace();
                    let sha = p.next()?.to_string();
                    let refname = p.next()?.to_string();
                    Some((refname, sha))
                })
                .collect();

        let local = self.remote_tips(cwd, cancel).await.unwrap_or_default();
        let mut has = false;
        for (refname, sha) in &remote_map {
            // refs/heads/foo → refs/remotes/<remote>/foo
            if let Some(short) = refname.strip_prefix("refs/heads/") {
                let local_key = format!("refs/remotes/{remote}/{short}");
                match local.get(&local_key) {
                    Some(local_sha) if local_sha != sha => {
                        has = true;
                        break;
                    }
                    None => {
                        // New remote branch — only mark if we track something on this remote.
                        // Keep signal for known tracking tips only.
                    }
                    _ => {}
                }
            }
        }
        // Also: local tracking tip behind remote tip.
        if !has {
            for (k, local_sha) in &local {
                let prefix = format!("refs/remotes/{remote}/");
                if let Some(short) = k.strip_prefix(&prefix) {
                    let remote_key = format!("refs/heads/{short}");
                    if let Some(rsha) = remote_map.get(&remote_key) {
                        if rsha != local_sha {
                            has = true;
                            break;
                        }
                    }
                }
            }
        }

        Ok(IncomingCheck {
            has_unfetched: has,
            remotes: if has {
                vec![remote.to_string()]
            } else {
                vec![]
            },
        })
    }

    async fn rev_parse(
        &self,
        cwd: &Path,
        rev: &str,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let inv = GitInvocation::new(cwd, ["rev-parse", rev])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    async fn rev_parse_abbrev(
        &self,
        cwd: &Path,
        rev: &str,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let inv = GitInvocation::new(cwd, ["rev-parse", "--abbrev-ref", rev])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    async fn upstream_ref(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let inv = GitInvocation::new(cwd, ["rev-parse", "--abbrev-ref", "@{u}"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    async fn rev_list_oneline(
        &self,
        cwd: &Path,
        range: &str,
        cancel: &CancellationToken,
    ) -> Result<Vec<String>, AppError> {
        let inv = GitInvocation::new(cwd, ["log", "--oneline", range])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        Ok(String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect())
    }

    async fn name_status(
        &self,
        cwd: &Path,
        old: &str,
        new: &str,
        cancel: &CancellationToken,
    ) -> Result<Vec<ChangedFile>, AppError> {
        let inv = GitInvocation::new(cwd, ["diff", "--name-status", "-z", "-M", old, new])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let raw = String::from_utf8_lossy(&out.stdout);
        let mut files = Vec::new();
        let parts: Vec<&str> = raw.split('\0').filter(|s| !s.is_empty()).collect();
        let mut i = 0;
        while i < parts.len() {
            let status = parts[i];
            if status.starts_with('R') || status.starts_with('C') {
                if i + 2 < parts.len() {
                    files.push(ChangedFile {
                        path: parts[i + 2].to_string(),
                        status: status.to_string(),
                        orig_path: Some(parts[i + 1].to_string()),
                    });
                    i += 3;
                    continue;
                }
            }
            if i + 1 < parts.len() {
                files.push(ChangedFile {
                    path: parts[i + 1].to_string(),
                    status: status.chars().next().unwrap_or('M').to_string(),
                    orig_path: None,
                });
                i += 2;
            } else {
                break;
            }
        }
        let _ = HashSet::<String>::new();
        Ok(files)
    }
}

fn map_network_err(e: AppError) -> AppError {
    let msg = e.message.to_lowercase();
    if msg.contains("could not resolve")
        || msg.contains("unable to access")
        || msg.contains("failed to connect")
        || msg.contains("network is unreachable")
    {
        AppError::new(ErrorCode::NetworkError, e.message)
            .with_stderr(e.git_stderr.unwrap_or_default())
            .with_command(e.command.unwrap_or_default())
    } else if msg.contains("authentication")
        || msg.contains("could not read username")
        || msg.contains("permission denied (publickey)")
    {
        AppError::new(ErrorCode::AuthRequired, e.message)
            .with_stderr(e.git_stderr.unwrap_or_default())
    } else if msg.contains("divergent branches") || msg.contains("need to specify how to reconcile")
    {
        AppError::new(ErrorCode::DivergentBranches, e.message)
            .with_stderr(e.git_stderr.unwrap_or_default())
    } else {
        e
    }
}

fn is_protected(branch: &str, patterns: &[String]) -> bool {
    let short = branch.rsplit('/').next().unwrap_or(branch);
    patterns.iter().any(|p| {
        if p.contains('*') {
            // Simple glob: prefix* / *suffix / exact-with-stars
            let parts: Vec<&str> = p.split('*').collect();
            if parts.len() == 2 {
                short.starts_with(parts[0]) && short.ends_with(parts[1])
            } else {
                short == p.as_str()
            }
        } else {
            short == p || branch == p
        }
    })
}

fn now_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
