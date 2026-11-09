//! Fetch / pull / push / update project (M2).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{
    AppError, ChangedFile, ErrorCode, FetchSummary, FetchTagsPolicy, IncomingCheck, PullResult,
    PushOutcome, PushPreview, PushRefspec, PushResult, SubmoduleUpdatePolicy, SyncForkResult,
    UpdateInfo, UpdateMethod,
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

    #[allow(clippy::too_many_arguments)]
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
        // Squash and --no-commit can update the index without advancing HEAD.
        // Compare index trees so pre-existing staged files are not reported as
        // files downloaded by this pull.
        let old_index = if squash || no_commit {
            Some(self.index_tree(cwd, cancel).await?)
        } else {
            None
        };
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
        let head_changed = old != new;
        let new_index = if old_index.is_some() && !head_changed {
            Some(self.index_tree(cwd, cancel).await?)
        } else {
            None
        };
        let pending_merge =
            !head_changed && no_commit && self.rev_parse(cwd, "MERGE_HEAD", cancel).await.is_ok();
        let index_changed = new_index.is_some() && new_index != old_index;
        let updated = head_changed || index_changed || pending_merge;
        let updated_files = if head_changed {
            self.name_status(cwd, &old, &new, cancel)
                .await
                .unwrap_or_default()
        } else if let (Some(before), Some(after)) = (&old_index, &new_index) {
            self.name_status(cwd, before, after, cancel).await?
        } else {
            Vec::new()
        };
        let commits = if head_changed {
            self.rev_list_oneline(cwd, &format!("{old}..{new}"), cancel)
                .await
                .unwrap_or_default()
        } else {
            Vec::new()
        };
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
            updated_files,
            commits,
            message: if updated && !head_changed {
                "Changes applied; commit required".into()
            } else if updated {
                "Pulled successfully".into()
            } else {
                "Already up to date".into()
            },
        })
    }

    pub(crate) async fn index_tree(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let out = self
            .run(
                GitInvocation::new(cwd, ["write-tree"])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?;
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    pub async fn update_project_run(
        &self,
        cwd: &Path,
        strategy: UpdateMethod,
        cancel: &CancellationToken,
    ) -> Result<UpdateInfo, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        // Fetch upstream remote first.
        let upstream = self.upstream_ref(cwd, cancel).await.map_err(|e| {
            AppError::new(
                ErrorCode::GitCommandFailed,
                format!(
                    "No upstream branch for Update Project — set upstream then retry. ({})",
                    e.message
                ),
            )
        })?;
        let (remote, _) = upstream
            .split_once('/')
            .map(|(r, b)| (r.to_string(), b.to_string()))
            .unwrap_or_else(|| ("origin".into(), "main".into()));

        let old = self.rev_parse(cwd, "HEAD", cancel).await?;
        self.safety_backup(cwd, "update-project", &old, cancel)
            .await?;

        let _ = self
            .fetch_run(cwd, Some(&remote), true, FetchTagsPolicy::Auto, cancel)
            .await?;

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
                let inv = GitInvocation::new(cwd, ["reset", "--keep", "@{u}"])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                self.run(inv, cancel).await?;
            }
        }

        let new = self.rev_parse(cwd, "HEAD", cancel).await?;
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

        Ok(UpdateInfo {
            old_head: old,
            new_head: new,
            strategy: strategy_s.into(),
            updated_files,
            commits,
            message,
            submodules: None,
            submodule_error: None,
        })
    }

    pub async fn update_project_with_submodules(
        &self,
        cwd: &Path,
        strategy: UpdateMethod,
        policy: SubmoduleUpdatePolicy,
        cancel: &CancellationToken,
    ) -> Result<UpdateInfo, AppError> {
        let mut info = self.update_project_run(cwd, strategy, cancel).await?;
        if !matches!(policy, SubmoduleUpdatePolicy::Never) {
            let changed = info
                .updated_files
                .iter()
                .map(|file| file.path.clone())
                .collect::<Vec<_>>();
            match self
                .submodule_update(cwd, policy, Some(&changed), cancel)
                .await
            {
                Ok(result) => info.submodules = Some(result),
                Err(error) => info.submodule_error = Some(error.message),
            }
        }
        Ok(info)
    }

    /// Sync local default branch with fork parent remote (#17 host-agnostic).
    pub async fn sync_fork(
        &self,
        cwd: &Path,
        parent_remote: &str,
        strategy: UpdateMethod,
        push_origin: bool,
        cancel: &CancellationToken,
    ) -> Result<SyncForkResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        // Ensure parent remote exists.
        let remotes = self.remote_list(cwd, cancel).await?;
        if !remotes.iter().any(|r| r.name == parent_remote) {
            return Err(AppError::new(
                ErrorCode::RemoteNotFound,
                format!("fork parent remote '{parent_remote}' not found"),
            ));
        }

        let default_branch = self.default_branch_name(cwd, cancel).await?;
        let upstream_ref = format!("{parent_remote}/{default_branch}");
        // Save the branch being updated, before checkout can change the active
        // branch or index. The companion snapshot preserves the caller's local
        // index/worktree even when it starts on a different branch.
        let old = self
            .rev_parse(cwd, &format!("refs/heads/{default_branch}"), cancel)
            .await?;
        self.safety_backup(cwd, "sync-fork", &old, cancel).await?;

        let _ = self
            .fetch_run(
                cwd,
                Some(parent_remote),
                true,
                FetchTagsPolicy::Auto,
                cancel,
            )
            .await?;

        // Checkout default branch if needed.
        let current = self.rev_parse_abbrev(cwd, "HEAD", cancel).await?;
        if current != default_branch {
            self.branch_checkout(cwd, &default_branch, "local", cancel)
                .await?;
        }

        match strategy {
            UpdateMethod::Merge => {
                let inv = GitInvocation::new(cwd, ["merge", "--ff-only", &upstream_ref])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                if let Err(e) = self.run(inv, cancel).await {
                    // Fall back to merge (non-ff) when ff-only fails.
                    let msg = e.message.to_lowercase();
                    if msg.contains("not possible") || msg.contains("diverged") {
                        let inv = GitInvocation::new(cwd, ["merge", "--no-edit", &upstream_ref])
                            .kind(OpKind::Write)
                            .git_bin(self.git_bin.clone());
                        self.run(inv, cancel).await?;
                    } else {
                        return Err(e);
                    }
                }
            }
            UpdateMethod::Rebase => {
                let inv = GitInvocation::new(cwd, ["rebase", &upstream_ref])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                self.run(inv, cancel).await?;
            }
            UpdateMethod::Reset => {
                let inv = GitInvocation::new(cwd, ["reset", "--keep", &upstream_ref])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                self.run(inv, cancel).await?;
            }
        }

        let new = self.rev_parse(cwd, "HEAD", cancel).await?;

        let mut pushed = false;
        if push_origin {
            let inv = GitInvocation::new(
                cwd,
                [
                    "push",
                    "--porcelain",
                    "origin",
                    &format!("refs/heads/{default_branch}"),
                ],
            )
            .kind(OpKind::NetworkWrite)
            .timeout(Some(Duration::from_secs(180)))
            .git_bin(self.git_bin.clone());
            self.run(inv, cancel).await?;
            pushed = true;
        }

        let strategy_s = match strategy {
            UpdateMethod::Merge => "merge",
            UpdateMethod::Rebase => "rebase",
            UpdateMethod::Reset => "reset",
        };
        Ok(SyncForkResult {
            default_branch,
            upstream_ref,
            old_head: old.clone(),
            new_head: new.clone(),
            strategy: strategy_s.into(),
            pushed,
            message: if old == new {
                "Already in sync with upstream".into()
            } else if pushed {
                "Synced with upstream and pushed to origin".into()
            } else {
                "Synced with upstream".into()
            },
        })
    }

    async fn default_branch_name(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        // Prefer origin/HEAD symbolic ref.
        let inv = GitInvocation::new(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        if let Ok(out) = self.run(inv, cancel).await {
            let text = String::from_utf8_lossy(&out.stdout);
            if let Some(name) = text.trim().strip_prefix("refs/remotes/origin/") {
                return Ok(name.to_string());
            }
        }
        let inv = GitInvocation::new(cwd, ["config", "--get", "init.defaultBranch"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        if let Ok(out) = self.run(inv, cancel).await {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return Ok(name);
            }
        }
        for candidate in ["main", "master"] {
            let inv = GitInvocation::new(
                cwd,
                [
                    "show-ref",
                    "--verify",
                    "--quiet",
                    &format!("refs/heads/{candidate}"),
                ],
            )
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
            if self.run(inv, cancel).await.is_ok() {
                return Ok(candidate.to_string());
            }
        }
        Ok("main".into())
    }

    pub async fn push_preview(
        &self,
        cwd: &Path,
        remote: Option<&str>,
        branch: Option<&str>,
        remote_branch: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<PushPreview, AppError> {
        let remotes = self.remote_list(cwd, cancel).await?;
        let branch = match branch {
            Some(branch) => branch.to_string(),
            None => self.rev_parse_abbrev(cwd, "HEAD", cancel).await?,
        };
        self.validate_push_branch(cwd, &branch, cancel).await?;
        let source = format!("refs/heads/{branch}");
        // Verify the source even when it differs from the checked-out branch.
        self.rev_parse(cwd, &source, cancel).await?;
        let tracking = self
            .run(
                GitInvocation::new(
                    cwd,
                    [
                        "for-each-ref",
                        "--format=%(refname)%00%(upstream:remotename)%00%(upstream:remoteref)",
                        &source,
                    ],
                ),
                cancel,
            )
            .await?;
        let tracking_text = String::from_utf8_lossy(&tracking.stdout);
        let tracking_fields = tracking_text
            .lines()
            .find(|line| line.split('\0').next() == Some(source.as_str()))
            .unwrap_or("")
            .split('\0')
            .collect::<Vec<_>>();
        let upstream_remote = tracking_fields.get(1).copied().unwrap_or("");
        let upstream_branch = tracking_fields
            .get(2)
            .copied()
            .unwrap_or("")
            .strip_prefix("refs/heads/")
            .unwrap_or("");
        let remote_name = remote
            .map(|s| s.to_string())
            .or_else(|| {
                remotes
                    .iter()
                    .find(|r| r.name == upstream_remote)
                    .map(|r| r.name.clone())
            })
            .or_else(|| {
                remotes
                    .iter()
                    .find(|r| r.name == "origin")
                    .map(|r| r.name.clone())
            })
            .or_else(|| remotes.first().map(|r| r.name.clone()))
            .unwrap_or_else(|| "origin".into());
        let has_remote = remotes.iter().any(|r| r.name == remote_name);
        if !has_remote && !remotes.is_empty() {
            return Err(AppError::new(
                ErrorCode::RemoteNotFound,
                format!("remote '{remote_name}' not found"),
            ));
        }
        let target_branch = remote_branch.unwrap_or_else(|| {
            if upstream_remote == remote_name && !upstream_branch.is_empty() {
                upstream_branch
            } else {
                &branch
            }
        });
        self.validate_push_branch(cwd, target_branch, cancel)
            .await?;
        let set_upstream = upstream_remote != remote_name || upstream_branch != target_branch;
        let target_ref = format!("refs/remotes/{remote_name}/{target_branch}");
        let tips = self.remote_tips(cwd, cancel).await?;
        let mut args = vec![
            "log".to_string(),
            "--oneline".into(),
            "--max-count=201".into(),
        ];
        if let Some(target_sha) = tips.get(&target_ref) {
            args.push(format!("{target_sha}..{source}"));
        } else {
            // A new branch only needs history not already known on this remote.
            args.push(source);
            args.push("--not".into());
            args.push(format!("--remotes={remote_name}"));
        }
        args.push("--".into());
        let output = self.run(GitInvocation::new(cwd, args), cancel).await?;
        let mut commits: Vec<String> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect();
        let commits_truncated = commits.len() > 200;
        commits.truncate(200);

        Ok(PushPreview {
            remote: remote_name.clone(),
            refs: vec![PushRefspec {
                local: branch.clone(),
                remote: remote_name,
                remote_branch: target_branch.to_string(),
            }],
            commits,
            commits_truncated,
            set_upstream,
            has_remote,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn push_run(
        &self,
        cwd: &Path,
        remote: &str,
        branch: &str,
        remote_branch: Option<&str>,
        set_upstream: bool,
        force_with_lease: bool,
        push_tags: Option<&str>,
        protected: &[String],
        cancel: &CancellationToken,
    ) -> Result<PushResult, AppError> {
        let remote_branch = remote_branch.unwrap_or(branch);
        self.validate_push_branch(cwd, branch, cancel).await?;
        self.validate_push_branch(cwd, remote_branch, cancel)
            .await?;
        if !self
            .remote_list(cwd, cancel)
            .await?
            .iter()
            .any(|r| r.name == remote)
        {
            return Err(AppError::new(
                ErrorCode::RemoteNotFound,
                format!("remote '{remote}' not found"),
            ));
        }
        if force_with_lease && is_protected(remote_branch, protected) {
            return Err(AppError::new(
                ErrorCode::ProtectedBranch,
                format!("force push to protected branch '{remote_branch}' is not allowed"),
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
        args.push(format!("refs/heads/{branch}:refs/heads/{remote_branch}"));

        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::NetworkWrite)
            .timeout(Some(Duration::from_secs(600)))
            .git_bin(self.git_bin.clone());

        match self.run(inv, cancel).await {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout);
                let statuses: Vec<_> = text
                    .lines()
                    .filter_map(|line| {
                        let (flag, _) = line.split_once('\t')?;
                        (flag.len() == 1).then_some(flag)
                    })
                    .collect();
                let up_to_date = !statuses.is_empty() && statuses.iter().all(|flag| *flag == "=");
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
                        format!("Pushed to {remote}/{remote_branch}")
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
                } else {
                    Err(map_network_err(e))
                }
            }
        }
    }

    async fn validate_push_branch(
        &self,
        cwd: &Path,
        branch: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        if branch.is_empty()
            || branch == "HEAD"
            || branch.starts_with('-')
            || branch.starts_with("refs/")
        {
            return Err(AppError::new(
                ErrorCode::InvalidRefName,
                "Choose a named local and remote branch",
            ));
        }
        // Full names avoid interpreting a free-form refspec (including deletions).
        self.run(
            GitInvocation::new(cwd, ["check-ref-format", &format!("refs/heads/{branch}")]),
            cancel,
        )
        .await
        .map(|_| ())
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
            if (status.starts_with('R') || status.starts_with('C')) && i + 2 < parts.len() {
                files.push(ChangedFile {
                    path: parts[i + 2].to_string(),
                    status: status.to_string(),
                    orig_path: Some(parts[i + 1].to_string()),
                });
                i += 3;
                continue;
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
        || msg.contains("could not read password")
        || msg.contains("terminal prompts disabled")
        || msg.contains("authentication failed")
        || msg.contains("http basic access authentication failed")
        || msg.contains("invalid username or password")
        || msg.contains("permission denied (publickey)")
        || (msg.contains("permission denied")
            && (msg.contains("publickey") || msg.contains("password")))
    {
        AppError::new(ErrorCode::AuthRequired, e.message)
            .with_stderr(e.git_stderr.unwrap_or_default())
            .with_recover(vec![
                gitx_core::RecoverAction::Retry,
                gitx_core::RecoverAction::ShowDetails,
            ])
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
