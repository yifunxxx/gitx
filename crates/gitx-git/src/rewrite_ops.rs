//! Merge / rebase / cherry-pick + RepoOpState (M4).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{
    AppError, ErrorCode, RepoOpKind, RepoOpPhase, RepoOpState, RewriteOutcome, RewriteResult,
};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio_util::sync::CancellationToken;

impl GitRunner {
    /// Derive ongoing operation state from disk markers + unmerged index entries.
    pub async fn repo_op_state(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RepoOpState, AppError> {
        // Drop Update Project stashes that already applied once conflicts clear.
        let _ = self.finish_update_project_stash(cwd, cancel).await;
        let mut state = self.repo_op_state_raw(cwd, cancel).await?;
        state.smart_recovery = self.smart_recovery_status(cwd, &state, cancel).await?;
        Ok(state)
    }

    pub(crate) async fn repo_op_state_raw(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RepoOpState, AppError> {
        let git_dir = self.git_dir(cwd, cancel).await?;
        let conflict_count = self.unmerged_paths(cwd, cancel).await?.len() as u32;
        let head_branch = self
            .rev_parse_abbrev_public(cwd, "HEAD", cancel)
            .await
            .ok()
            .filter(|b| b != "HEAD");

        if git_dir.join("MERGE_HEAD").exists() {
            let subject =
                read_first_line(&git_dir.join("MERGE_HEAD")).and_then(|sha| short_sha(&sha));
            let subject_name = self.merge_msg_subject(&git_dir).or_else(|| subject.clone());
            let phase = if conflict_count > 0 {
                RepoOpPhase::Conflicted
            } else {
                RepoOpPhase::ReadyToContinue
            };
            let summary = format!(
                "Merging '{}' into '{}'",
                subject_name.as_deref().unwrap_or("…"),
                head_branch.as_deref().unwrap_or("HEAD")
            );
            return Ok(RepoOpState {
                smart_recovery: None,
                kind: RepoOpKind::Merge,
                phase,
                step: None,
                total: None,
                conflict_count,
                yours_label: head_branch.clone().unwrap_or_else(|| "Yours (HEAD)".into()),
                theirs_label: subject_name.clone().unwrap_or_else(|| "Theirs".into()),
                summary,
                head_branch,
                subject: subject_name,
            });
        }

        // Single-commit conflicted reverts often leave only REVERT_HEAD (no
        // sequencer/ dir). Cherry-picks leave CHERRY_PICK_HEAD and/or sequencer.
        if git_dir.join("CHERRY_PICK_HEAD").exists()
            || git_dir.join("REVERT_HEAD").exists()
            || git_dir.join("sequencer").exists()
        {
            let (kind, label) = if git_dir.join("REVERT_HEAD").exists() {
                (RepoOpKind::Revert, "Revert")
            } else {
                (RepoOpKind::CherryPick, "Cherry-pick")
            };
            let (step, total) = read_sequencer_progress(&git_dir);
            let subject = read_first_line(&git_dir.join("CHERRY_PICK_HEAD"))
                .or_else(|| read_first_line(&git_dir.join("REVERT_HEAD")))
                .and_then(|s| short_sha(&s));
            let phase = if conflict_count > 0 {
                RepoOpPhase::Conflicted
            } else {
                RepoOpPhase::ReadyToContinue
            };
            let progress = match (step, total) {
                (Some(s), Some(t)) => format!(" ({s}/{t})"),
                _ => String::new(),
            };
            let summary = format!(
                "{label}{}{}",
                subject
                    .as_ref()
                    .map(|s| format!(" {s}"))
                    .unwrap_or_default(),
                progress
            );
            return Ok(RepoOpState {
                smart_recovery: None,
                kind,
                phase,
                step,
                total,
                conflict_count,
                // Cherry-pick/rebase: ours = upstream/onto, theirs = commit being applied.
                yours_label: head_branch.clone().unwrap_or_else(|| "Yours".into()),
                theirs_label: subject.clone().unwrap_or_else(|| "Theirs".into()),
                summary,
                head_branch,
                subject,
            });
        }

        let rebase_dir = if git_dir.join("rebase-merge").is_dir() {
            Some(git_dir.join("rebase-merge"))
        } else if git_dir.join("rebase-apply").is_dir() {
            Some(git_dir.join("rebase-apply"))
        } else {
            None
        };

        if let Some(dir) = rebase_dir {
            let step =
                read_u32_file(&dir.join("msgnum")).or_else(|| read_u32_file(&dir.join("next")));
            let total =
                read_u32_file(&dir.join("end")).or_else(|| read_u32_file(&dir.join("last")));
            let onto = read_first_line(&dir.join("onto"))
                .and_then(|s| short_sha(&s))
                .or_else(|| read_first_line(&dir.join("onto")));
            // `done` accumulates finished todo lines; the edit stop is the last one.
            let stopped_for_edit = dir.join("stop-for-edit").exists()
                || (read_last_line(&dir.join("done"))
                    .map(|d| d.starts_with("edit "))
                    .unwrap_or(false)
                    && conflict_count == 0
                    && dir.join("amend").exists());
            let phase = if stopped_for_edit {
                RepoOpPhase::StoppedForEdit
            } else if conflict_count > 0 {
                RepoOpPhase::Conflicted
            } else {
                RepoOpPhase::ReadyToContinue
            };
            // Rebase: Yours = upstream/onto, Theirs = commit being replayed.
            let head_name = read_first_line(&dir.join("head-name"))
                .map(|h| h.trim_start_matches("refs/heads/").to_string())
                .or_else(|| head_branch.clone());
            let summary = match (step, total) {
                (Some(s), Some(t)) => format!(
                    "Rebasing '{}' onto '{}' ({s}/{t})",
                    head_name.as_deref().unwrap_or("HEAD"),
                    onto.as_deref().unwrap_or("…")
                ),
                _ => format!("Rebasing onto '{}'", onto.as_deref().unwrap_or("…")),
            };
            return Ok(RepoOpState {
                smart_recovery: None,
                kind: RepoOpKind::Rebase,
                phase,
                step,
                total,
                conflict_count,
                yours_label: onto.clone().unwrap_or_else(|| "Yours (onto)".into()),
                theirs_label: "Theirs (commit)".into(),
                summary,
                head_branch: head_name,
                subject: onto,
            });
        }

        Ok(RepoOpState {
            smart_recovery: None,
            kind: RepoOpKind::Normal,
            phase: if conflict_count > 0 {
                RepoOpPhase::Conflicted
            } else {
                RepoOpPhase::Normal
            },
            step: None,
            total: None,
            conflict_count,
            yours_label: "Yours".into(),
            theirs_label: "Theirs".into(),
            summary: String::new(),
            head_branch,
            subject: None,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn merge_run(
        &self,
        cwd: &Path,
        branches: &[String],
        no_ff: bool,
        ff_only: bool,
        squash: bool,
        message: Option<&str>,
        no_commit: bool,
        no_verify: bool,
        allow_unrelated: bool,
        smart: bool,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        let old = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let backup = if old.is_empty() {
            None
        } else {
            Some(self.safety_backup(cwd, "merge", &old, cancel).await?)
        };

        let run_merge = |allow_unrelated: bool| {
            let mut args = vec!["merge".to_string()];
            if no_ff {
                args.push("--no-ff".into());
            }
            if ff_only {
                args.push("--ff-only".into());
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
            if allow_unrelated {
                args.push("--allow-unrelated-histories".into());
            }
            if let Some(msg) = message {
                args.push("-m".into());
                args.push(msg.to_string());
            } else {
                args.push("--no-edit".into());
            }
            args.extend(branches.iter().cloned());
            args
        };

        let result = self
            .run_rewrite(
                cwd,
                run_merge(allow_unrelated),
                OpKind::Write,
                "merge",
                smart,
                cancel,
            )
            .await;

        match result {
            Ok(squash_staged) => {
                let new = self
                    .rev_parse_public(cwd, "HEAD", cancel)
                    .await
                    .unwrap_or_default();
                let state = self.repo_op_state(cwd, cancel).await?;
                if state.conflict_count > 0 || state.kind == RepoOpKind::Merge || squash_staged {
                    let files = self.unmerged_paths(cwd, cancel).await.unwrap_or_default();
                    if !files.is_empty() {
                        return Ok(RewriteResult {
                            old_head: old,
                            new_head: new,
                            outcome: RewriteOutcome::Conflicts,
                            message: format!("Conflicts in {} file(s)", files.len()),
                            conflict_files: files,
                            backup_ref: backup,
                            undo_head: None,
                        });
                    }
                    if squash || no_commit {
                        return Ok(RewriteResult {
                            old_head: old,
                            new_head: new,
                            outcome: RewriteOutcome::NothingToCommit,
                            message: "Merge staged — commit to finish".into(),
                            conflict_files: vec![],
                            backup_ref: backup,
                            undo_head: None,
                        });
                    }
                }
                // A true fast-forward lands HEAD on an already-existing tip
                // (the merged branch / upstream). `old` is also an ancestor of a
                // newly created merge commit, so ancestry alone is not enough.
                let mut merged_tips = Vec::new();
                if branches.is_empty() {
                    if let Ok(upstream) = self.rev_parse_public(cwd, "@{u}", cancel).await {
                        merged_tips.push(upstream);
                    }
                } else {
                    for branch in branches {
                        if let Ok(tip) = self.rev_parse_public(cwd, branch, cancel).await {
                            merged_tips.push(tip);
                        }
                    }
                }
                let landed_on_merged_tip = merged_tips.iter().any(|tip| tip == &new);
                let outcome = if old == new {
                    RewriteOutcome::AlreadyUpToDate
                } else if !no_ff
                    && landed_on_merged_tip
                    && is_ancestor(self, cwd, &old, &new, cancel).await
                {
                    RewriteOutcome::FastForward
                } else {
                    RewriteOutcome::Success
                };
                let message = match outcome {
                    RewriteOutcome::AlreadyUpToDate => "Already up to date".into(),
                    RewriteOutcome::FastForward => format!(
                        "Fast-forwarded to {}",
                        branches.first().map(|s| s.as_str()).unwrap_or("…")
                    ),
                    _ => format!(
                        "Merged {} into {}",
                        branches.join(", "),
                        state.head_branch.as_deref().unwrap_or("HEAD")
                    ),
                };
                Ok(RewriteResult {
                    old_head: old,
                    new_head: new,
                    outcome,
                    message,
                    conflict_files: vec![],
                    backup_ref: backup,
                    undo_head: None,
                })
            }
            Err(e) => {
                self.map_rewrite_err(cwd, e, &old, backup, "merge", cancel)
                    .await
            }
        }
    }

    pub async fn merge_abort(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        let old = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let backup = self
            .safety_backup(cwd, "merge-abort", &old, cancel)
            .await
            .ok();
        let inv = GitInvocation::new(cwd, ["merge", "--abort"])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        self.finish_smart_stash(cwd, "merge", cancel).await?;
        let new = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        Ok(RewriteResult {
            old_head: old,
            new_head: new,
            outcome: RewriteOutcome::Success,
            message: "Merge aborted".into(),
            conflict_files: vec![],
            backup_ref: backup,
            undo_head: None,
        })
    }

    pub async fn merge_commit(
        &self,
        cwd: &Path,
        message: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        let old = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let mut args = vec!["commit".to_string()];
        if let Some(msg) = message {
            args.push("-m".into());
            args.push(msg.to_string());
        } else {
            args.push("--no-edit".into());
        }
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        self.finish_smart_stash(cwd, "merge", cancel).await?;
        let new = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        Ok(RewriteResult {
            old_head: old,
            new_head: new,
            outcome: RewriteOutcome::Success,
            message: "Merge committed".into(),
            conflict_files: vec![],
            backup_ref: None,
            undo_head: None,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn rebase_run(
        &self,
        cwd: &Path,
        upstream: &str,
        onto: Option<&str>,
        branch: Option<&str>,
        rebase_merges: bool,
        keep_empty: bool,
        root: bool,
        update_refs: bool,
        autosquash: bool,
        interactive: bool,
        smart: bool,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        if interactive {
            // Prefer loading a plan from HEAD~N is not enough — callers should use
            // rebase_interactive_plan + rebase_interactive_start. Keep a safe default:
            // treat as "rebase -i" with all picks from upstream..HEAD.
            let plan = self
                .rebase_interactive_plan_from_upstream(cwd, upstream, cancel)
                .await?;
            return self
                .rebase_interactive_start(cwd, &plan, smart, cancel)
                .await;
        }
        self.ensure_not_busy(cwd, cancel).await?;
        // When rebasing another branch (`git rebase upstream topic`), HEAD may
        // still be elsewhere — backup/compare the branch tip being rewritten.
        let old = self.rebase_target_head(cwd, branch, cancel).await?;
        let backup = if old.is_empty() {
            None
        } else {
            Some(self.safety_backup(cwd, "rebase", &old, cancel).await?)
        };

        let mut args = vec!["rebase".to_string()];
        if rebase_merges {
            args.push("--rebase-merges".into());
        }
        if keep_empty {
            args.push("--keep-empty".into());
        }
        if root {
            args.push("--root".into());
        }
        if update_refs {
            args.push("--update-refs".into());
        }
        if autosquash {
            args.push("--autosquash".into());
        }
        if let Some(onto) = onto {
            args.push("--onto".into());
            args.push(onto.to_string());
        }
        if !root {
            args.push(upstream.to_string());
        }
        if let Some(b) = branch {
            args.push(b.to_string());
        }

        match self
            .run_rewrite(cwd, args, OpKind::Write, "rebase", smart, cancel)
            .await
        {
            Ok(_) => {
                let new = self.rebase_target_head(cwd, branch, cancel).await?;
                let state = self.repo_op_state(cwd, cancel).await?;
                if state.kind == RepoOpKind::Rebase {
                    let files = self.unmerged_paths(cwd, cancel).await.unwrap_or_default();
                    return Ok(RewriteResult {
                        old_head: old,
                        new_head: new,
                        outcome: RewriteOutcome::Conflicts,
                        message: if files.is_empty() {
                            format!("Rebase paused{}", self.smart_stash_note(cwd, cancel).await?)
                        } else {
                            format!("Conflicts in {} file(s)", files.len())
                        },
                        conflict_files: files,
                        backup_ref: backup,
                        undo_head: None,
                    });
                }
                let outcome = if old == new {
                    RewriteOutcome::AlreadyUpToDate
                } else {
                    RewriteOutcome::Success
                };
                Ok(RewriteResult {
                    old_head: old,
                    new_head: new,
                    outcome,
                    message: if outcome == RewriteOutcome::AlreadyUpToDate {
                        "Already up to date".into()
                    } else {
                        format!("Rebased onto {upstream}")
                    },
                    conflict_files: vec![],
                    backup_ref: backup,
                    undo_head: None,
                })
            }
            Err(e) => {
                self.map_rewrite_err(cwd, e, &old, backup, "rebase", cancel)
                    .await
            }
        }
    }

    pub async fn rebase_continue(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.sequencer_action(cwd, "rebase", "--continue", cancel)
            .await
    }

    pub async fn rebase_skip(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.sequencer_action(cwd, "rebase", "--skip", cancel).await
    }

    pub async fn rebase_abort(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.sequencer_action(cwd, "rebase", "--abort", cancel)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn cherry_pick_run(
        &self,
        cwd: &Path,
        shas: &[String],
        mainline: Option<u32>,
        add_suffix: bool,
        allow_empty: bool,
        smart: bool,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        if shas.is_empty() {
            return Err(AppError::new(
                ErrorCode::GitCommandFailed,
                "no commits to cherry-pick",
            ));
        }
        let old = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let backup = if old.is_empty() {
            None
        } else {
            Some(self.safety_backup(cwd, "cherry-pick", &old, cancel).await?)
        };

        let mut args = vec!["cherry-pick".to_string()];
        if add_suffix {
            args.push("-x".into());
        }
        if allow_empty {
            args.push("--allow-empty".into());
        }
        if let Some(m) = mainline {
            args.push("-m".into());
            args.push(m.to_string());
        }
        args.extend(shas.iter().cloned());

        match self
            .run_rewrite(cwd, args, OpKind::Write, "cherry-pick", smart, cancel)
            .await
        {
            Ok(_) => {
                let new = self
                    .rev_parse_public(cwd, "HEAD", cancel)
                    .await
                    .unwrap_or_default();
                let state = self.repo_op_state(cwd, cancel).await?;
                if matches!(state.kind, RepoOpKind::CherryPick | RepoOpKind::Revert) {
                    let files = self.unmerged_paths(cwd, cancel).await.unwrap_or_default();
                    return Ok(RewriteResult {
                        old_head: old,
                        new_head: new,
                        outcome: RewriteOutcome::Conflicts,
                        message: format!("Conflicts in {} file(s)", files.len().max(1)),
                        conflict_files: files,
                        backup_ref: backup,
                        undo_head: None,
                    });
                }
                Ok(RewriteResult {
                    old_head: old,
                    new_head: new,
                    outcome: RewriteOutcome::Success,
                    message: format!("Cherry-picked {} commit(s)", shas.len()),
                    conflict_files: vec![],
                    backup_ref: backup,
                    undo_head: None,
                })
            }
            Err(e) => {
                self.map_rewrite_err(cwd, e, &old, backup, "cherry-pick", cancel)
                    .await
            }
        }
    }

    pub async fn cherry_pick_continue(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.sequencer_action(cwd, "cherry-pick", "--continue", cancel)
            .await
    }

    pub async fn cherry_pick_skip(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.sequencer_action(cwd, "cherry-pick", "--skip", cancel)
            .await
    }

    pub async fn cherry_pick_abort(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.sequencer_action(cwd, "cherry-pick", "--abort", cancel)
            .await
    }

    /// Whether a commit is contained in any protected remote-tracking branch.
    pub async fn cherry_pick_needs_suffix(
        &self,
        cwd: &Path,
        sha: &str,
        protected: &[String],
        cancel: &CancellationToken,
    ) -> Result<bool, AppError> {
        let inv = GitInvocation::new(cwd, ["branch", "-r", "--contains", sha])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = match self.run(inv, cancel).await {
            Ok(o) => o,
            Err(_) => return Ok(false),
        };
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let name = line.trim().trim_start_matches("origin/");
            let short = name.rsplit('/').next().unwrap_or(name);
            if is_protected_name(short, protected) || is_protected_name(name, protected) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    // --- helpers ---

    pub(crate) async fn sequencer_action(
        &self,
        cwd: &Path,
        cmd: &str,
        flag: &str,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        let old = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let backup = if flag == "--abort" {
            self.safety_backup(cwd, &format!("{cmd}-abort"), &old, cancel)
                .await
                .ok()
        } else {
            None
        };
        // `--continue` / `--skip` may still hit reword/squash editors for later
        // todo items (e.g. after Edit or after skipping a conflicted commit).
        // Use gitx-helper so gitx-plan.json overrides apply; without a plan the
        // helper leaves Git's prepared message alone. Plain `true` would drop
        // those overrides in dumb-terminal / GUI hosts.
        let inv = if matches!(flag, "--continue" | "--skip") {
            let editor = crate::history_rewrite_ops::helper_command("editor");
            GitInvocation::new(cwd, [cmd, flag])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone())
                .env("GIT_EDITOR", editor.clone())
                .env("EDITOR", editor)
        } else {
            GitInvocation::new(cwd, [cmd, flag])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone())
        };
        match self.run(inv, cancel).await {
            Ok(_) => {
                let new = self
                    .rev_parse_public(cwd, "HEAD", cancel)
                    .await
                    .unwrap_or_default();
                let state = self.repo_op_state(cwd, cancel).await?;
                if state.conflict_count > 0
                    || matches!(
                        state.phase,
                        RepoOpPhase::Conflicted
                            | RepoOpPhase::ReadyToContinue
                            | RepoOpPhase::StoppedForEdit
                    )
                {
                    let files = self.unmerged_paths(cwd, cancel).await.unwrap_or_default();
                    return Ok(RewriteResult {
                        old_head: old,
                        new_head: new,
                        outcome: RewriteOutcome::Conflicts,
                        message: if files.is_empty() {
                            format!(
                                "{cmd} {flag} — still in progress{}",
                                self.smart_stash_note(cwd, cancel).await?
                            )
                        } else {
                            format!("Conflicts in {} file(s)", files.len())
                        },
                        conflict_files: files,
                        backup_ref: backup,
                        undo_head: None,
                    });
                }
                self.finish_smart_stash(cwd, cmd, cancel).await?;
                Ok(RewriteResult {
                    old_head: old,
                    new_head: new,
                    outcome: RewriteOutcome::Success,
                    message: format!("{cmd} {flag}"),
                    conflict_files: vec![],
                    backup_ref: backup,
                    undo_head: None,
                })
            }
            Err(e) => {
                self.map_rewrite_err(cwd, e, &old, backup, cmd, cancel)
                    .await
            }
        }
    }

    pub(crate) async fn run_rewrite(
        &self,
        cwd: &Path,
        args: Vec<String>,
        kind: OpKind,
        op_name: &str,
        smart: bool,
        cancel: &CancellationToken,
    ) -> Result<bool, AppError> {
        let inv = GitInvocation::new(cwd, args)
            .kind(kind)
            .git_bin(self.git_bin.clone());
        if smart {
            return self.with_clean_tree_inv(cwd, op_name, inv, cancel).await;
        }
        self.run_rewrite_inv(cwd, inv, cancel).await
    }

    pub(crate) async fn map_rewrite_err(
        &self,
        cwd: &Path,
        e: AppError,
        old: &str,
        backup: Option<String>,
        op: &str,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        if matches!(
            e.code,
            ErrorCode::OperationInProgress
                | ErrorCode::Cancelled
                | ErrorCode::FsError
                | ErrorCode::StashFailed
        ) {
            return Err(e);
        }
        let stderr = e.git_stderr.clone().unwrap_or_else(|| e.message.clone());
        let lower = stderr.to_lowercase();

        // Rebase also refuses unrelated staged/unstaged edits, without the
        // "would be overwritten" wording used by merge and cherry-pick.
        let rebase_needs_clean_tree = op == "rebase"
            && lower.contains("cannot rebase:")
            && (lower.contains("unstaged changes")
                || lower.contains("index contains uncommitted changes"));
        if e.code != ErrorCode::MergeConflict
            && (lower.contains("would be overwritten")
                || lower.contains("your local changes to the following files")
                || lower.contains("untracked working tree files would be overwritten")
                || rebase_needs_clean_tree)
        {
            let files = if rebase_needs_clean_tree {
                self.status_get(cwd, "", 0, cancel)
                    .await?
                    .files
                    .into_iter()
                    .map(|file| file.path)
                    .collect()
            } else {
                extract_overwritten_files(&stderr)
            };
            return Err(AppError::new(
                if lower.contains("untracked") {
                    ErrorCode::UntrackedWouldBeOverwritten
                } else {
                    ErrorCode::DirtyWorktreeWouldBeOverwritten
                },
                e.message,
            )
            .with_stderr(stderr)
            .with_args(serde_json::json!({
                "files": files,
                "operation": op,
            })));
        }

        if lower.contains("unrelated histories") {
            return Err(AppError::new(ErrorCode::UnrelatedHistories, e.message).with_stderr(stderr));
        }

        // Conflict exit (git merge/rebase/cherry-pick often exit 1).
        let files = self.unmerged_paths(cwd, cancel).await.unwrap_or_default();
        if !files.is_empty()
            || lower.contains("conflict")
            || lower.contains("fix you to resolve")
            || lower.contains("could not apply")
        {
            let new = self
                .rev_parse_public(cwd, "HEAD", cancel)
                .await
                .unwrap_or_default();
            return Ok(RewriteResult {
                old_head: old.to_string(),
                new_head: new,
                outcome: RewriteOutcome::Conflicts,
                message: format!(
                    "Conflicts in {} file(s){}",
                    files.len().max(1),
                    self.smart_stash_note(cwd, cancel).await?
                ),
                conflict_files: files,
                backup_ref: backup,
                undo_head: None,
            });
        }

        let _ = op;
        Err(e)
    }

    pub(crate) async fn ensure_not_busy(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let state = self.repo_op_state(cwd, cancel).await?;
        if state.kind != RepoOpKind::Normal {
            return Err(AppError::new(
                ErrorCode::OperationInProgress,
                format!("operation in progress: {}", state.summary),
            ));
        }
        Ok(())
    }

    pub(crate) async fn safety_backup(
        &self,
        cwd: &Path,
        op: &str,
        sha: &str,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        if sha.is_empty() {
            return Err(AppError::new(ErrorCode::Internal, "empty sha for backup"));
        }
        // Nanoseconds avoid same-second collisions when two backups are taken
        // back-to-back (sync_safety expects the first restore point to remain).
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let backup = format!("refs/gitx/backup/{op}-{ts}");
        let inv = GitInvocation::new(cwd, ["update-ref", &backup, sha])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        // Also stash-create snapshot of worktree when dirty (best-effort).
        let create = GitInvocation::new(cwd, ["stash", "create"])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        if let Ok(out) = self.run(create, cancel).await {
            let stash_sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !stash_sha.is_empty() {
                let snap = format!("refs/gitx/backup/{op}-wt-{ts}");
                let inv = GitInvocation::new(cwd, ["update-ref", &snap, &stash_sha])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                // Worktree snapshot is part of the safety contract — a rejected
                // snapshot must stop the rewrite (see rewrite_backups tests).
                self.run(inv, cancel).await?;
            }
        }
        Ok(backup)
    }

    pub async fn git_dir(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<PathBuf, AppError> {
        let inv = GitInvocation::new(cwd, ["rev-parse", "--git-dir"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let path = PathBuf::from(&p);
        if path.is_absolute() {
            Ok(path)
        } else {
            Ok(cwd.join(path))
        }
    }

    pub(crate) async fn unmerged_paths(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<String>, AppError> {
        let inv = GitInvocation::new(cwd, ["ls-files", "-u", "-z"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let raw = String::from_utf8_lossy(&out.stdout);
        let mut set = std::collections::BTreeSet::new();
        for chunk in raw.split('\0') {
            if chunk.is_empty() {
                continue;
            }
            // format: <mode> <object> <stage>\t<path>
            if let Some((_, path)) = chunk.split_once('\t') {
                set.insert(path.to_string());
            }
        }
        Ok(set.into_iter().collect())
    }

    pub async fn rev_parse_public(
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

    pub(crate) async fn rev_parse_abbrev_public(
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

    fn merge_msg_subject(&self, git_dir: &Path) -> Option<String> {
        let text = std::fs::read_to_string(git_dir.join("MERGE_MSG")).ok()?;
        // "Merge branch 'feature' into main"
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some(rest) = line.strip_prefix("Merge branch '") {
                return rest.split('\'').next().map(|s| s.to_string());
            }
            if let Some(rest) = line.strip_prefix("Merge remote-tracking branch '") {
                return rest.split('\'').next().map(|s| s.to_string());
            }
            return Some(line.to_string());
        }
        None
    }
}

async fn is_ancestor(
    runner: &GitRunner,
    cwd: &Path,
    old: &str,
    new: &str,
    cancel: &CancellationToken,
) -> bool {
    let inv = GitInvocation::new(cwd, ["merge-base", "--is-ancestor", old, new])
        .kind(OpKind::Read)
        .git_bin(runner.git_bin.clone());
    runner.run(inv, cancel).await.is_ok()
}

fn read_first_line(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    text.lines().next().map(|s| s.trim().to_string())
}

fn read_last_line(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    text.lines()
        .rev()
        .map(str::trim)
        .find(|s| !s.is_empty())
        .map(str::to_string)
}

fn read_u32_file(path: &Path) -> Option<u32> {
    read_first_line(path)?.parse().ok()
}

fn short_sha(sha: &str) -> Option<String> {
    if sha.len() >= 7 {
        Some(sha[..7].to_string())
    } else if sha.is_empty() {
        None
    } else {
        Some(sha.to_string())
    }
}

fn read_sequencer_progress(git_dir: &Path) -> (Option<u32>, Option<u32>) {
    let todo = git_dir.join("sequencer/todo");
    let done = git_dir.join("sequencer/done");
    let todo_n = std::fs::read_to_string(&todo).ok().map(|t| {
        t.lines()
            .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
            .count() as u32
    });
    let done_n = std::fs::read_to_string(&done).ok().map(|t| {
        t.lines()
            .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
            .count() as u32
    });
    match (done_n, todo_n) {
        (Some(d), Some(t)) => (Some(d), Some(d + t)),
        _ => (None, None),
    }
}

fn extract_overwritten_files(stderr: &str) -> Vec<String> {
    let mut files = Vec::new();
    let mut capture = false;
    for line in stderr.lines() {
        let t = line.trim();
        if t.contains("would be overwritten") || t.contains("the following files") {
            capture = true;
            continue;
        }
        if capture {
            if t.is_empty()
                || t.starts_with("Please")
                || t.starts_with("error:")
                || t.starts_with("Aborting")
            {
                break;
            }
            files.push(t.to_string());
        }
    }
    files
}

fn is_protected_name(name: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|p| {
        if p.contains('*') {
            let prefix = p.trim_end_matches('*');
            name.starts_with(prefix)
        } else {
            name == p
        }
    })
}
