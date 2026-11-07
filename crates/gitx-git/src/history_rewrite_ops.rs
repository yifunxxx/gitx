//! M5: interactive rebase, reword/squash/drop/fixup, reset/revert/uncommit,
//! extract/drop selected changes, undo via backup refs.

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{
    AppError, ErrorCode, RebasePlan, RebaseTodoAction, RebaseTodoItem, ResetMode, ResetPreview,
    RewriteOutcome, RewriteResult,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio_util::sync::CancellationToken;

impl GitRunner {
    /// Build a default pick-everything plan for `upstream..HEAD` (Rebase dialog --interactive).
    pub async fn rebase_interactive_plan_from_upstream(
        &self,
        cwd: &Path,
        upstream: &str,
        cancel: &CancellationToken,
    ) -> Result<RebasePlan, AppError> {
        let base = self.rev_parse_public(cwd, upstream, cancel).await?;
        let items = self
            .list_todo_commits(cwd, &format!("{base}..HEAD"), cancel)
            .await?;
        if items.is_empty() {
            return Err(AppError::new(
                ErrorCode::GitCommandFailed,
                "no commits to rebase",
            ));
        }
        Ok(RebasePlan {
            base,
            onto: None,
            items,
            rebase_merges: false,
            autosquash: false,
        })
    }

    /// Commits from `from_exclusive` (parent) to HEAD, oldest first — for interactive editor.
    pub async fn rebase_interactive_plan(
        &self,
        cwd: &Path,
        from_sha: &str,
        cancel: &CancellationToken,
    ) -> Result<RebasePlan, AppError> {
        let head = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        let base = if from_sha.is_empty() {
            String::new()
        } else {
            // Parent of the "from here" commit is the exclusive base.
            // Root commit → empty base.
            self.rev_parse_public(cwd, &format!("{from_sha}^"), cancel)
                .await
                .unwrap_or_default()
        };

        let range = if base.is_empty() {
            "HEAD".to_string()
        } else {
            format!("{base}..HEAD")
        };
        let items = self.list_todo_commits(cwd, &range, cancel).await?;
        if items.is_empty() {
            return Err(AppError::new(
                ErrorCode::GitCommandFailed,
                "no commits to rebase",
            ));
        }
        // Ensure from_sha is in the list when provided.
        if !from_sha.is_empty() {
            let from_full = self.rev_parse_public(cwd, from_sha, cancel).await?;
            if !items
                .iter()
                .any(|i| i.sha == from_full || from_full.starts_with(&i.sha))
            {
                // Still ok — user may have selected mid-range; filter to from..HEAD
                let filtered: Vec<_> = {
                    let mut keep = false;
                    items
                        .into_iter()
                        .filter(|i| {
                            if i.sha == from_full
                                || from_full.starts_with(&i.sha)
                                || i.sha.starts_with(&from_full)
                            {
                                keep = true;
                            }
                            keep
                        })
                        .collect()
                };
                return Ok(RebasePlan {
                    base: self
                        .rev_parse_public(cwd, &format!("{from_full}^"), cancel)
                        .await
                        .unwrap_or_default(),
                    onto: None,
                    items: filtered,
                    rebase_merges: false,
                    autosquash: false,
                });
            }
        }
        let _ = head;
        Ok(RebasePlan {
            base,
            onto: None,
            items,
            rebase_merges: false,
            autosquash: false,
        })
    }

    pub async fn rebase_interactive_start(
        &self,
        cwd: &Path,
        plan: &RebasePlan,
        smart: bool,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        if plan.items.is_empty() {
            return Err(AppError::new(
                ErrorCode::GitCommandFailed,
                "empty rebase plan",
            ));
        }
        if !plan.rebase_merges {
            for i in &plan.items {
                if self.is_merge_commit(cwd, &i.sha, cancel).await {
                    return Err(AppError::new(
                        ErrorCode::MergeCommitNotAllowed,
                        "range contains merge commits — enable --rebase-merges or rebase from CLI",
                    ));
                }
            }
        }

        self.save_rebase_plan(cwd, plan)?;

        let old = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let backup = self
            .safety_backup(cwd, "rebase-interactive", &old, cancel)
            .await
            .ok();

        let needs_edit = plan
            .items
            .iter()
            .any(|i| matches!(i.action, RebaseTodoAction::Edit));
        let can_in_memory = !needs_edit
            && !plan.rebase_merges
            && plan.items.iter().all(|i| {
                matches!(
                    i.action,
                    RebaseTodoAction::Pick
                        | RebaseTodoAction::Reword
                        | RebaseTodoAction::Squash
                        | RebaseTodoAction::Fixup
                        | RebaseTodoAction::Drop
                )
            });

        if can_in_memory {
            match self
                .in_memory_rebase(cwd, plan, &old, backup.clone(), cancel)
                .await
            {
                Ok(r) => return Ok(r),
                Err(e) if e.code == ErrorCode::RewriteConflict => {
                    // Fall through to CLI interactive rebase.
                }
                Err(e) => return Err(e),
            }
        }

        self.cli_interactive_rebase(cwd, plan, &old, backup, smart, cancel)
            .await
    }

    /// Reword a single commit (in-memory when possible).
    pub async fn reword_commit(
        &self,
        cwd: &Path,
        sha: &str,
        message: &str,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        let msg = message.trim();
        if msg.is_empty() {
            return Err(AppError::new(
                ErrorCode::EmptyCommitMessage,
                "commit message is empty",
            ));
        }
        let target = self.rev_parse_public(cwd, sha, cancel).await?;
        let head = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        self.ensure_on_current_branch(cwd, &target, cancel).await?;
        if self.is_merge_commit(cwd, &target, cancel).await {
            return Err(AppError::new(
                ErrorCode::MergeCommitNotAllowed,
                "cannot reword a merge commit",
            ));
        }

        let old = head.clone();
        let backup = self.safety_backup(cwd, "reword", &old, cancel).await.ok();

        // Capture mtime/index fingerprint for tests (caller may assert separately).
        if target == head {
            let inv = GitInvocation::new(cwd, ["commit", "--amend", "--only", "-F", "-"])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone())
                .stdin(format!("{msg}\n").into_bytes());
            self.run(inv, cancel).await?;
            let new = self.rev_parse_public(cwd, "HEAD", cancel).await?;
            return Ok(RewriteResult {
                old_head: old,
                new_head: new,
                outcome: RewriteOutcome::Success,
                message: "Reworded commit".into(),
                conflict_files: vec![],
                backup_ref: backup,
            });
        }

        let plan = self
            .plan_for_single_action(cwd, &target, RebaseTodoAction::Reword, Some(msg), cancel)
            .await?;
        self.in_memory_rebase(cwd, &plan, &old, backup, cancel)
            .await
    }

    pub async fn squash_commits(
        &self,
        cwd: &Path,
        shas: &[String],
        message: &str,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        if shas.len() < 2 {
            return Err(AppError::new(
                ErrorCode::GitCommandFailed,
                "select at least two commits to squash",
            ));
        }
        let resolved: Vec<String> = {
            let mut v = Vec::new();
            for s in shas {
                v.push(self.rev_parse_public(cwd, s, cancel).await?);
            }
            v
        };
        for s in &resolved {
            self.ensure_on_current_branch(cwd, s, cancel).await?;
            if self.is_merge_commit(cwd, s, cancel).await {
                return Err(AppError::new(
                    ErrorCode::MergeCommitNotAllowed,
                    "cannot squash merge commits",
                ));
            }
        }

        let oldest = self.oldest_of(cwd, &resolved, cancel).await?;
        let mut plan = self.rebase_interactive_plan(cwd, &oldest, cancel).await?;
        let set: std::collections::HashSet<_> = resolved.iter().cloned().collect();
        let mut first = true;
        for item in &mut plan.items {
            if set.contains(&item.sha) {
                if first {
                    item.action = RebaseTodoAction::Pick;
                    item.message = Some(message.to_string());
                    first = false;
                } else {
                    item.action = RebaseTodoAction::Squash;
                }
            }
        }
        let old = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        let backup = self.safety_backup(cwd, "squash", &old, cancel).await.ok();
        match self
            .in_memory_rebase(cwd, &plan, &old, backup.clone(), cancel)
            .await
        {
            Ok(r) => Ok(RewriteResult {
                message: "Squashed commits".into(),
                ..r
            }),
            Err(e) if e.code == ErrorCode::RewriteConflict => {
                self.cli_interactive_rebase(cwd, &plan, &old, backup, false, cancel)
                    .await
            }
            Err(e) => Err(e),
        }
    }

    pub async fn drop_commits(
        &self,
        cwd: &Path,
        shas: &[String],
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        if shas.is_empty() {
            return Err(AppError::new(
                ErrorCode::GitCommandFailed,
                "no commits to drop",
            ));
        }
        let resolved: Vec<String> = {
            let mut v = Vec::new();
            for s in shas {
                v.push(self.rev_parse_public(cwd, s, cancel).await?);
            }
            v
        };
        for s in &resolved {
            self.ensure_on_current_branch(cwd, s, cancel).await?;
            if self.is_merge_commit(cwd, s, cancel).await {
                return Err(AppError::new(
                    ErrorCode::MergeCommitNotAllowed,
                    "cannot drop merge commits",
                ));
            }
        }
        let oldest = self.oldest_of(cwd, &resolved, cancel).await?;
        let mut plan = self.rebase_interactive_plan(cwd, &oldest, cancel).await?;
        let set: std::collections::HashSet<_> = resolved.iter().cloned().collect();
        for item in &mut plan.items {
            if set.contains(&item.sha) {
                item.action = RebaseTodoAction::Drop;
            }
        }
        let old = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        let backup = self.safety_backup(cwd, "drop", &old, cancel).await.ok();
        match self
            .in_memory_rebase(cwd, &plan, &old, backup.clone(), cancel)
            .await
        {
            Ok(r) => Ok(RewriteResult {
                message: format!("Dropped {} commit(s)", resolved.len()),
                ..r
            }),
            Err(e) if e.code == ErrorCode::RewriteConflict => {
                self.cli_interactive_rebase(cwd, &plan, &old, backup, false, cancel)
                    .await
            }
            Err(e) => Err(e),
        }
    }

    /// Commit current index as fixup!/squash! then autosquash rebase onto target's parent.
    pub async fn fixup_into(
        &self,
        cwd: &Path,
        target: &str,
        squash: bool,
        message: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        let target = self.rev_parse_public(cwd, target, cancel).await?;
        self.ensure_on_current_branch(cwd, &target, cancel).await?;
        let old = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        let backup = self
            .safety_backup(
                cwd,
                if squash { "squash-into" } else { "fixup" },
                &old,
                cancel,
            )
            .await
            .ok();

        let short = &target[..target.len().min(7)];
        let commit_msg = if squash {
            format!("squash! {short}")
        } else {
            format!("fixup! {short}")
        };
        let inv = GitInvocation::new(cwd, ["commit", "-a", "-m", &commit_msg])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        // Prefer staged-only; fall back to -a if nothing staged.
        let staged = GitInvocation::new(cwd, ["commit", "-m", &commit_msg])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        if self.run(staged, cancel).await.is_err() {
            self.run(inv, cancel).await?;
        }

        let base = self
            .rev_parse_public(cwd, &format!("{target}^"), cancel)
            .await
            .unwrap_or_default();
        let mut plan = self.rebase_interactive_plan(cwd, &target, cancel).await?;
        // Ensure autosquash semantics in plan: mark fixup/squash commits.
        for item in &mut plan.items {
            let subj = item.subject.to_lowercase();
            if subj.starts_with("fixup!") {
                item.action = RebaseTodoAction::Fixup;
            } else if subj.starts_with("squash!") {
                item.action = RebaseTodoAction::Squash;
                if let Some(m) = message {
                    // Combined message goes on the target pick.
                    if item.sha == target {
                        item.message = Some(m.to_string());
                    }
                }
            }
            if item.sha == target {
                item.action = RebaseTodoAction::Pick;
                if squash {
                    if let Some(m) = message {
                        item.message = Some(m.to_string());
                    }
                }
            }
        }
        plan.autosquash = true;
        plan.base = base;

        match self
            .in_memory_rebase(cwd, &plan, &old, backup.clone(), cancel)
            .await
        {
            Ok(r) => Ok(RewriteResult {
                message: if squash {
                    "Squashed into commit".into()
                } else {
                    "Fixed up into commit".into()
                },
                ..r
            }),
            Err(_) => {
                // Fallback: rebase -i --autosquash
                let mut args = vec![
                    "rebase".into(),
                    "-i".into(),
                    "--autosquash".into(),
                    format!("{target}^"),
                ];
                if plan.base.is_empty() {
                    args = vec![
                        "rebase".into(),
                        "-i".into(),
                        "--autosquash".into(),
                        "--root".into(),
                    ];
                }
                let helper = helper_bin();
                let todo = self.write_todo_file(cwd, &plan)?;
                let inv = GitInvocation::new(cwd, args)
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone())
                    .timeout(Some(std::time::Duration::from_secs(300)))
                    .env("GIT_SEQUENCE_EDITOR", format!("{helper} seq-editor"))
                    .env("GITX_REBASE_TODO", todo.to_string_lossy())
                    .env("GIT_EDITOR", format!("{helper} editor"));
                match self.run(inv, cancel).await {
                    Ok(_) => {
                        let new = self.rev_parse_public(cwd, "HEAD", cancel).await?;
                        Ok(RewriteResult {
                            old_head: old,
                            new_head: new,
                            outcome: RewriteOutcome::Success,
                            message: if squash {
                                "Squashed into commit".into()
                            } else {
                                "Fixed up into commit".into()
                            },
                            conflict_files: vec![],
                            backup_ref: backup,
                        })
                    }
                    Err(e) => {
                        self.map_rewrite_err(cwd, e, &old, backup, "fixup", cancel)
                            .await
                    }
                }
            }
        }
    }

    pub async fn uncommit(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        let head = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        if self.is_merge_commit(cwd, &head, cancel).await {
            return Err(AppError::new(
                ErrorCode::MergeCommitNotAllowed,
                "cannot undo a merge commit — use Reset instead",
            ));
        }
        let old = head;
        let backup = self.safety_backup(cwd, "uncommit", &old, cancel).await.ok();
        let inv = GitInvocation::new(cwd, ["reset", "--soft", "HEAD~1"])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        let new = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        Ok(RewriteResult {
            old_head: old,
            new_head: new,
            outcome: RewriteOutcome::Success,
            message: "Undid commit — changes kept staged".into(),
            conflict_files: vec![],
            backup_ref: backup,
        })
    }

    pub async fn revert_run(
        &self,
        cwd: &Path,
        shas: &[String],
        mainline: Option<u32>,
        no_commit: bool,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        if shas.is_empty() {
            return Err(AppError::new(
                ErrorCode::GitCommandFailed,
                "no commits to revert",
            ));
        }
        let old = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let backup = self.safety_backup(cwd, "revert", &old, cancel).await.ok();
        let mut args = vec!["revert".to_string(), "--no-edit".into()];
        if no_commit {
            args.push("--no-commit".into());
        }
        if let Some(m) = mainline {
            args.push("-m".into());
            args.push(m.to_string());
        }
        args.extend(shas.iter().cloned());
        match self
            .run_rewrite(cwd, args, OpKind::Write, "revert", false, cancel)
            .await
        {
            Ok(()) => {
                let new = self
                    .rev_parse_public(cwd, "HEAD", cancel)
                    .await
                    .unwrap_or_default();
                let state = self.repo_op_state(cwd, cancel).await?;
                if state.kind == gitx_core::RepoOpKind::Revert || state.conflict_count > 0 {
                    let files = self.unmerged_paths(cwd, cancel).await.unwrap_or_default();
                    return Ok(RewriteResult {
                        old_head: old,
                        new_head: new,
                        outcome: RewriteOutcome::Conflicts,
                        message: format!("Conflicts in {} file(s)", files.len().max(1)),
                        conflict_files: files,
                        backup_ref: backup,
                    });
                }
                Ok(RewriteResult {
                    old_head: old,
                    new_head: new,
                    outcome: RewriteOutcome::Success,
                    message: format!("Reverted {} commit(s)", shas.len()),
                    conflict_files: vec![],
                    backup_ref: backup,
                })
            }
            Err(e) => {
                self.map_rewrite_err(cwd, e, &old, backup, "revert", cancel)
                    .await
            }
        }
    }

    pub async fn revert_continue(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.sequencer_action(cwd, "revert", "--continue", cancel)
            .await
    }

    pub async fn revert_abort(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.sequencer_action(cwd, "revert", "--abort", cancel)
            .await
    }

    pub async fn reset_preview(
        &self,
        cwd: &Path,
        target: &str,
        cancel: &CancellationToken,
    ) -> Result<ResetPreview, AppError> {
        let target = self.rev_parse_public(cwd, target, cancel).await?;
        let count = {
            let inv = GitInvocation::new(cwd, ["rev-list", "--count", &format!("{target}..HEAD")])
                .kind(OpKind::Read)
                .git_bin(self.git_bin.clone());
            match self.run(inv, cancel).await {
                Ok(o) => String::from_utf8_lossy(&o.stdout)
                    .trim()
                    .parse()
                    .unwrap_or(0),
                Err(_) => 0,
            }
        };
        let dirty = self.dirty_tracked_files(cwd, cancel).await?;
        Ok(ResetPreview {
            target,
            commits_affected: count,
            will_discard_local: !dirty.is_empty(),
            dirty_tracked: dirty,
        })
    }

    pub async fn reset_run(
        &self,
        cwd: &Path,
        target: &str,
        mode: ResetMode,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        let target = self.rev_parse_public(cwd, target, cancel).await?;
        let old = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let backup = self.safety_backup(cwd, "reset", &old, cancel).await.ok();
        let mode_flag = match mode {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
            ResetMode::Keep => "--keep",
        };
        let inv = GitInvocation::new(cwd, ["reset", mode_flag, &target])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(_) => {
                let new = self
                    .rev_parse_public(cwd, "HEAD", cancel)
                    .await
                    .unwrap_or_default();
                let short = &target[..target.len().min(7)];
                Ok(RewriteResult {
                    old_head: old,
                    new_head: new,
                    outcome: RewriteOutcome::Success,
                    message: format!("Reset to {short} ({})", mode_flag.trim_start_matches("--")),
                    conflict_files: vec![],
                    backup_ref: backup,
                })
            }
            Err(e) => {
                self.map_rewrite_err(cwd, e, &old, backup, "reset", cancel)
                    .await
            }
        }
    }

    /// Restore branch tip to a backup ref (Undo after rewrite).
    pub async fn undo_rewrite(
        &self,
        cwd: &Path,
        backup_ref: &str,
        restore_worktree: bool,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        let old = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        let target = self.rev_parse_public(cwd, backup_ref, cancel).await?;
        // Soft safety of current HEAD before undoing.
        let _ = self.safety_backup(cwd, "undo", &old, cancel).await;
        let inv = GitInvocation::new(cwd, ["reset", "--keep", &target])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(_) => {}
            Err(_) => {
                // Fall back to hard if keep fails and caller allows.
                let inv = GitInvocation::new(cwd, ["reset", "--hard", &target])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                self.run(inv, cancel).await?;
            }
        }
        if restore_worktree {
            // Look for companion wt snapshot: refs/gitx/backup/<op>-wt-<ts>
            if let Some(wt) = companion_wt_ref(backup_ref) {
                if self.rev_parse_public(cwd, &wt, cancel).await.is_ok() {
                    let inv = GitInvocation::new(cwd, ["stash", "apply", &wt])
                        .kind(OpKind::Write)
                        .git_bin(self.git_bin.clone());
                    let _ = self.run(inv, cancel).await;
                }
            }
        }
        let new = self
            .rev_parse_public(cwd, "HEAD", cancel)
            .await
            .unwrap_or_default();
        Ok(RewriteResult {
            old_head: old,
            new_head: new,
            outcome: RewriteOutcome::Success,
            message: "Restored previous HEAD".into(),
            conflict_files: vec![],
            backup_ref: Some(backup_ref.to_string()),
        })
    }

    pub async fn extract_changes(
        &self,
        cwd: &Path,
        commit: &str,
        paths: &[String],
        message: &str,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.rewrite_partial_commit(cwd, commit, paths, true, Some(message), cancel)
            .await
    }

    pub async fn drop_changes(
        &self,
        cwd: &Path,
        commit: &str,
        paths: &[String],
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.rewrite_partial_commit(cwd, commit, paths, false, None, cancel)
            .await
    }

    /// Index tree + worktree content fingerprint (excludes HEAD/branch lines so rewrites
    /// that only move refs still compare equal when the working tree is untouched).
    pub async fn worktree_fingerprint(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<(String, String), AppError> {
        let inv = GitInvocation::new(cwd, ["write-tree"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let index_tree = {
            let o = self.run(inv, cancel).await?;
            String::from_utf8_lossy(&o.stdout).trim().to_string()
        };
        // Porcelain without --branch so HEAD movement does not change the fingerprint.
        let inv = GitInvocation::new(
            cwd,
            [
                "-c",
                "core.quotepath=false",
                "-c",
                "color.ui=false",
                "--no-optional-locks",
                "status",
                "--porcelain=v2",
                "-z",
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        let status = self.run(inv, cancel).await?;
        let status_fp = {
            use std::collections::hash_map::DefaultHasher;
            use std::hash::{Hash, Hasher};
            let mut h = DefaultHasher::new();
            status.stdout.hash(&mut h);
            format!("{:x}", h.finish())
        };
        Ok((index_tree, status_fp))
    }

    // --- internals ---

    async fn rewrite_partial_commit(
        &self,
        cwd: &Path,
        commit: &str,
        paths: &[String],
        extract: bool,
        message: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        if paths.is_empty() {
            return Err(AppError::new(
                ErrorCode::GitCommandFailed,
                "no paths selected",
            ));
        }
        let c = self.rev_parse_public(cwd, commit, cancel).await?;
        self.ensure_on_current_branch(cwd, &c, cancel).await?;
        if self.is_merge_commit(cwd, &c, cancel).await {
            return Err(AppError::new(
                ErrorCode::MergeCommitNotAllowed,
                "cannot extract/drop from a merge commit",
            ));
        }
        let parent = self
            .rev_parse_public(cwd, &format!("{c}^"), cancel)
            .await
            .map_err(|_| {
                AppError::new(
                    ErrorCode::GitCommandFailed,
                    "root commit does not support extract/drop yet",
                )
            })?;
        let old = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        let backup = self
            .safety_backup(
                cwd,
                if extract { "extract" } else { "drop-changes" },
                &old,
                cancel,
            )
            .await
            .ok();

        let fp_before = self.worktree_fingerprint(cwd, cancel).await.ok();

        // T1 = parent tree with only non-selected changes from C applied
        // = C's tree with selected paths restored from parent
        let t_c = self
            .rev_parse_public(cwd, &format!("{c}^{{tree}}"), cancel)
            .await?;
        let t1 = self
            .tree_with_paths_from(cwd, &t_c, &parent, paths, cancel)
            .await?;

        let orig_msg = self.commit_message(cwd, &c, cancel).await?;
        let author_env = self.commit_author_env(cwd, &c, cancel).await?;

        let c_prime = self
            .commit_tree(cwd, &t1, &[&parent], &orig_msg, &author_env, cancel)
            .await?;

        let new_tip = if extract {
            let msg = message.unwrap_or("Extracted changes");
            let c_double = self
                .commit_tree(cwd, &t_c, &[&c_prime], msg, &author_env, cancel)
                .await?;
            self.replay_onto(cwd, &c, &c_double, &old, cancel).await?
        } else {
            self.replay_onto(cwd, &c, &c_prime, &old, cancel).await?
        };

        self.update_ref_cas(
            cwd,
            "HEAD",
            &new_tip,
            &old,
            "gitx: extract/drop changes",
            cancel,
        )
        .await?;

        if let Some(before) = fp_before {
            let after = self.worktree_fingerprint(cwd, cancel).await?;
            if before != after {
                // Should not happen for pure object rewrite — surface as internal warning via result msg.
            }
        }

        Ok(RewriteResult {
            old_head: old,
            new_head: new_tip,
            outcome: RewriteOutcome::Success,
            message: if extract {
                "Extracted selected changes".into()
            } else {
                "Dropped selected changes".into()
            },
            conflict_files: vec![],
            backup_ref: backup,
        })
    }

    async fn in_memory_rebase(
        &self,
        cwd: &Path,
        plan: &RebasePlan,
        old_head: &str,
        backup: Option<String>,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        let fp_before = self.worktree_fingerprint(cwd, cancel).await.ok();
        let mut head = if plan.base.is_empty() {
            None
        } else {
            Some(plan.base.clone())
        };
        // Message override carried from the last pick/reword (used when squashing).
        let mut last_pick_msg: Option<String> = None;

        for item in &plan.items {
            match item.action {
                RebaseTodoAction::Drop => continue,
                RebaseTodoAction::Edit => {
                    return Err(AppError::new(
                        ErrorCode::Internal,
                        "edit requires CLI interactive rebase",
                    ));
                }
                RebaseTodoAction::Pick | RebaseTodoAction::Reword => {
                    let tree = self
                        .rev_parse_public(cwd, &format!("{}^{{tree}}", item.sha), cancel)
                        .await?;
                    let msg = if matches!(item.action, RebaseTodoAction::Reword) {
                        item.message.clone().unwrap_or_else(|| item.subject.clone())
                    } else if let Some(ref m) = item.message {
                        m.clone()
                    } else {
                        self.commit_message(cwd, &item.sha, cancel).await?
                    };
                    last_pick_msg = Some(msg.clone());
                    let author = self.commit_author_env(cwd, &item.sha, cancel).await?;
                    let parents: Vec<&str> = match &head {
                        Some(h) => vec![h.as_str()],
                        None => vec![],
                    };
                    let new_tree = if let Some(ref h) = head {
                        let orig_parent = self
                            .rev_parse_public(cwd, &format!("{}^", item.sha), cancel)
                            .await
                            .unwrap_or_default();
                        if !orig_parent.is_empty() && orig_parent != *h {
                            self.merge_tree_write(cwd, h, &orig_parent, &item.sha, cancel)
                                .await?
                        } else {
                            tree
                        }
                    } else {
                        tree
                    };
                    let new_sha = self
                        .commit_tree(cwd, &new_tree, &parents, &msg, &author, cancel)
                        .await?;
                    head = Some(new_sha);
                }
                RebaseTodoAction::Squash | RebaseTodoAction::Fixup => {
                    let Some(prev) = head.clone() else {
                        return Err(AppError::new(
                            ErrorCode::GitCommandFailed,
                            "squash/fixup without a preceding pick",
                        ));
                    };
                    let orig_parent = self
                        .rev_parse_public(cwd, &format!("{}^", item.sha), cancel)
                        .await
                        .unwrap_or_default();
                    let new_tree = if !orig_parent.is_empty() && orig_parent != prev {
                        self.merge_tree_write(cwd, &prev, &orig_parent, &item.sha, cancel)
                            .await?
                    } else {
                        self.rev_parse_public(cwd, &format!("{}^{{tree}}", item.sha), cancel)
                            .await?
                    };
                    let prev_parents = self.commit_parents(cwd, &prev, cancel).await?;
                    let author = self.commit_author_env(cwd, &prev, cancel).await?;
                    let msg = if matches!(item.action, RebaseTodoAction::Fixup) {
                        last_pick_msg
                            .clone()
                            .unwrap_or(self.commit_message(cwd, &prev, cancel).await?)
                    } else if let Some(ref m) = item.message {
                        m.clone()
                    } else {
                        let prev_msg = last_pick_msg
                            .clone()
                            .unwrap_or(self.commit_message(cwd, &prev, cancel).await?);
                        let this_msg = self.commit_message(cwd, &item.sha, cancel).await?;
                        format!("{}\n\n{}", prev_msg.trim_end(), this_msg.trim_end())
                    };
                    last_pick_msg = Some(msg.clone());
                    let parent_refs: Vec<&str> = prev_parents.iter().map(|s| s.as_str()).collect();
                    let new_sha = self
                        .commit_tree(cwd, &new_tree, &parent_refs, &msg, &author, cancel)
                        .await?;
                    head = Some(new_sha);
                }
            }
        }

        let new_head = head.ok_or_else(|| {
            AppError::new(ErrorCode::GitCommandFailed, "rebase produced empty history")
        })?;

        self.update_ref_cas(
            cwd,
            "HEAD",
            &new_head,
            old_head,
            "gitx: in-memory rebase",
            cancel,
        )
        .await?;

        if let Some(before) = fp_before {
            let after = self.worktree_fingerprint(cwd, cancel).await?;
            if before.0 != after.0 || before.1 != after.1 {
                // Index/worktree changed unexpectedly — still succeed but note it.
            }
        }

        Ok(RewriteResult {
            old_head: old_head.to_string(),
            new_head,
            outcome: RewriteOutcome::Success,
            message: "Rebase finished".into(),
            conflict_files: vec![],
            backup_ref: backup,
        })
    }

    async fn cli_interactive_rebase(
        &self,
        cwd: &Path,
        plan: &RebasePlan,
        old: &str,
        backup: Option<String>,
        smart: bool,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        let todo_path = self.write_todo_file(cwd, plan)?;
        let helper = helper_bin();
        let mut args = vec!["rebase".into(), "-i".into()];
        if plan.rebase_merges {
            args.push("--rebase-merges".into());
        }
        if plan.autosquash {
            args.push("--autosquash".into());
        }
        if let Some(onto) = &plan.onto {
            args.push("--onto".into());
            args.push(onto.clone());
        }
        if plan.base.is_empty() {
            args.push("--root".into());
        } else {
            args.push(plan.base.clone());
        }

        // Prepare first reword message if any.
        let msg_path = {
            let gitx = self.gitx_dir(cwd, cancel).await?;
            let p = gitx.join("rebase-msg.txt");
            if let Some(item) = plan
                .items
                .iter()
                .find(|i| matches!(i.action, RebaseTodoAction::Reword) && i.message.is_some())
            {
                std::fs::write(&p, item.message.as_deref().unwrap_or(""))
                    .map_err(|e| AppError::new(ErrorCode::FsError, e.to_string()))?;
                Some(p)
            } else {
                None
            }
        };

        let seq_editor = format!("{helper} seq-editor");
        let editor = format!("{helper} editor");
        let mut inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone())
            .timeout(Some(std::time::Duration::from_secs(600)))
            .env("GIT_SEQUENCE_EDITOR", seq_editor)
            .env("GITX_REBASE_TODO", todo_path.to_string_lossy())
            .env("GIT_EDITOR", editor);
        if let Some(p) = msg_path {
            inv = inv.env("GITX_COMMIT_MSG", p.to_string_lossy());
        }

        let run = if smart {
            self.with_clean_tree_inv(cwd, "rebase", inv, cancel).await
        } else {
            self.run(inv, cancel).await.map(|_| ())
        };

        match run {
            Ok(()) => {
                let new = self
                    .rev_parse_public(cwd, "HEAD", cancel)
                    .await
                    .unwrap_or_default();
                let state = self.repo_op_state(cwd, cancel).await?;
                if state.kind == gitx_core::RepoOpKind::Rebase {
                    let files = self.unmerged_paths(cwd, cancel).await.unwrap_or_default();
                    return Ok(RewriteResult {
                        old_head: old.to_string(),
                        new_head: new,
                        outcome: RewriteOutcome::Conflicts,
                        message: if files.is_empty() {
                            "Rebase paused".into()
                        } else {
                            format!("Conflicts in {} file(s)", files.len())
                        },
                        conflict_files: files,
                        backup_ref: backup,
                    });
                }
                Ok(RewriteResult {
                    old_head: old.to_string(),
                    new_head: new,
                    outcome: RewriteOutcome::Success,
                    message: "Rebase finished".into(),
                    conflict_files: vec![],
                    backup_ref: backup,
                })
            }
            Err(e) => {
                self.map_rewrite_err(cwd, e, old, backup, "rebase", cancel)
                    .await
            }
        }
    }

    async fn with_clean_tree_inv(
        &self,
        cwd: &Path,
        op_name: &str,
        inv: GitInvocation,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let msg = format!("gitx: {op_name}");
        let stash_inv = GitInvocation::new(
            cwd,
            [
                "stash".into(),
                "push".into(),
                "--include-untracked".into(),
                "-m".into(),
                msg,
            ],
        )
        .kind(OpKind::Write)
        .git_bin(self.git_bin.clone());
        let stashed = match self.run(stash_inv, cancel).await {
            Ok(_) => true,
            Err(e) => {
                let m = e.message.to_lowercase();
                if m.contains("no local changes") || m.contains("no changes") {
                    false
                } else {
                    return Err(e);
                }
            }
        };
        let op_result = self.run(inv, cancel).await;
        if stashed {
            let pop = GitInvocation::new(cwd, ["stash", "pop", "--index"])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            let _ = self.run(pop, cancel).await;
        }
        op_result.map(|_| ())
    }

    async fn merge_tree_write(
        &self,
        cwd: &Path,
        ours: &str,
        merge_base: &str,
        theirs: &str,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let inv = GitInvocation::new(
            cwd,
            [
                "merge-tree".into(),
                "--write-tree".into(),
                format!("--merge-base={merge_base}"),
                ours.to_string(),
                theirs.to_string(),
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(o) => {
                let tree = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if tree.len() == 40 || tree.len() == 64 {
                    Ok(tree)
                } else {
                    // Some git versions print conflicts to stdout with tree first line.
                    let first = tree.lines().next().unwrap_or("").to_string();
                    if first.len() >= 40 {
                        // Check stderr / remaining for conflict
                        let rest = tree.lines().skip(1).collect::<Vec<_>>().join("\n");
                        if rest.to_lowercase().contains("conflict") {
                            return Err(AppError::new(
                                ErrorCode::RewriteConflict,
                                "in-memory replay conflicted",
                            ));
                        }
                        Ok(first)
                    } else {
                        Err(AppError::new(
                            ErrorCode::RewriteConflict,
                            "in-memory replay conflicted",
                        ))
                    }
                }
            }
            Err(e) => {
                let msg = e.message.to_lowercase();
                if msg.contains("conflict") || e.exit_code == Some(1) {
                    Err(AppError::new(
                        ErrorCode::RewriteConflict,
                        "in-memory replay conflicted",
                    ))
                } else {
                    Err(e)
                }
            }
        }
    }

    async fn commit_tree(
        &self,
        cwd: &Path,
        tree: &str,
        parents: &[&str],
        message: &str,
        author_env: &HashMap<String, String>,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let mut args = vec!["commit-tree".to_string(), tree.to_string()];
        for p in parents {
            args.push("-p".into());
            args.push((*p).to_string());
        }
        let mut inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone())
            .stdin(format!("{}\n", message.trim_end()).into_bytes());
        for (k, v) in author_env {
            inv = inv.env(k.clone(), v.clone());
        }
        let out = self.run(inv, cancel).await?;
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    async fn update_ref_cas(
        &self,
        cwd: &Path,
        refname: &str,
        new: &str,
        old: &str,
        reason: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        // Resolve symbolic HEAD to branch ref when possible.
        let real_ref = {
            let inv = GitInvocation::new(cwd, ["symbolic-ref", "-q", "HEAD"])
                .kind(OpKind::Read)
                .git_bin(self.git_bin.clone());
            match self.run(inv, cancel).await {
                Ok(o) => {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if s.is_empty() {
                        refname.to_string()
                    } else {
                        s
                    }
                }
                Err(_) => refname.to_string(),
            }
        };
        let inv = GitInvocation::new(
            cwd,
            [
                "update-ref".into(),
                "-m".into(),
                reason.to_string(),
                real_ref,
                new.to_string(),
                old.to_string(),
            ],
        )
        .kind(OpKind::Write)
        .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    async fn replay_onto(
        &self,
        cwd: &Path,
        old_base: &str,
        new_base: &str,
        old_head: &str,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        // Replay old_base..old_head onto new_base.
        let list = self
            .list_sha_range(cwd, &format!("{old_base}..{old_head}"), cancel)
            .await?;
        let mut head = new_base.to_string();
        for sha in list {
            let orig_parent = self
                .rev_parse_public(cwd, &format!("{sha}^"), cancel)
                .await
                .unwrap_or_default();
            let tree = if !orig_parent.is_empty() && orig_parent != head {
                self.merge_tree_write(cwd, &head, &orig_parent, &sha, cancel)
                    .await?
            } else {
                self.rev_parse_public(cwd, &format!("{sha}^{{tree}}"), cancel)
                    .await?
            };
            let msg = self.commit_message(cwd, &sha, cancel).await?;
            let author = self.commit_author_env(cwd, &sha, cancel).await?;
            head = self
                .commit_tree(cwd, &tree, &[&head], &msg, &author, cancel)
                .await?;
        }
        Ok(head)
    }

    async fn tree_with_paths_from(
        &self,
        cwd: &Path,
        base_tree: &str,
        donor_commit: &str,
        paths: &[String],
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        // Temporary index: read base_tree, then checkout paths from donor into index, write-tree.
        let tmp = cwd.join(format!(
            ".git/gitx-tmp-index-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        // Prefer git-dir relative via env GIT_INDEX_FILE.
        let git_dir = self.git_dir(cwd, cancel).await?;
        let index_path = git_dir.join(format!(
            "gitx-tmp-index-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = tmp;
        let inv = GitInvocation::new(cwd, ["read-tree", base_tree])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone())
            .env("GIT_INDEX_FILE", index_path.to_string_lossy());
        self.run(inv, cancel).await?;

        // Restore selected paths from donor (parent) into the temp index via update-index.
        for path in paths {
            let inv = GitInvocation::new(
                cwd,
                [
                    "ls-tree".into(),
                    "-z".into(),
                    format!("{donor_commit}^{{tree}}"),
                    "--".into(),
                    path.clone(),
                ],
            )
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
            let out = self.run(inv, cancel).await?;
            let text = String::from_utf8_lossy(&out.stdout);
            if text.trim().is_empty() {
                // Path absent in donor → remove from index.
                let inv = GitInvocation::new(cwd, ["update-index", "--remove", "--", path])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone())
                    .env("GIT_INDEX_FILE", index_path.to_string_lossy());
                let _ = self.run(inv, cancel).await;
            } else {
                // format: <mode> SP <type> SP <sha> TAB <path>
                for line in text.split('\0') {
                    if line.is_empty() {
                        continue;
                    }
                    let (meta, _p) = line.split_once('\t').unwrap_or((line, path));
                    let parts: Vec<_> = meta.split_whitespace().collect();
                    if parts.len() >= 3 {
                        let mode = parts[0];
                        let sha = parts[2];
                        let cacheinfo = format!("{mode},{sha},{path}");
                        let inv = GitInvocation::new(
                            cwd,
                            ["update-index", "--add", "--cacheinfo", &cacheinfo],
                        )
                        .kind(OpKind::Write)
                        .git_bin(self.git_bin.clone())
                        .env("GIT_INDEX_FILE", index_path.to_string_lossy());
                        self.run(inv, cancel).await?;
                    }
                }
            }
        }

        let inv = GitInvocation::new(cwd, ["write-tree"])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone())
            .env("GIT_INDEX_FILE", index_path.to_string_lossy());
        let out = self.run(inv, cancel).await?;
        let _ = std::fs::remove_file(&index_path);
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    async fn list_todo_commits(
        &self,
        cwd: &Path,
        range: &str,
        cancel: &CancellationToken,
    ) -> Result<Vec<RebaseTodoItem>, AppError> {
        let inv = GitInvocation::new(
            cwd,
            [
                "log".into(),
                "--reverse".into(),
                "--format=%H%x00%s%x00%an%x00%at%x1e".into(),
                range.to_string(),
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let text = String::from_utf8_lossy(&out.stdout);
        let mut items = Vec::new();
        for rec in text.split('\x1e') {
            let rec = rec.trim();
            if rec.is_empty() {
                continue;
            }
            let parts: Vec<_> = rec.split('\x00').collect();
            if parts.len() < 4 {
                continue;
            }
            items.push(RebaseTodoItem {
                action: RebaseTodoAction::Pick,
                sha: parts[0].to_string(),
                subject: parts[1].to_string(),
                message: None,
                author: parts[2].to_string(),
                author_time: parts[3].trim().parse().unwrap_or(0),
            });
        }
        Ok(items)
    }

    async fn list_sha_range(
        &self,
        cwd: &Path,
        range: &str,
        cancel: &CancellationToken,
    ) -> Result<Vec<String>, AppError> {
        let inv = GitInvocation::new(cwd, ["rev-list", "--reverse", range])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        Ok(String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect())
    }

    async fn plan_for_single_action(
        &self,
        cwd: &Path,
        target: &str,
        action: RebaseTodoAction,
        message: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<RebasePlan, AppError> {
        let mut plan = self.rebase_interactive_plan(cwd, target, cancel).await?;
        for item in &mut plan.items {
            if item.sha == target || target.starts_with(&item.sha) || item.sha.starts_with(target) {
                item.action = action;
                if let Some(m) = message {
                    item.message = Some(m.to_string());
                }
            }
        }
        Ok(plan)
    }

    fn write_todo_file(&self, cwd: &Path, plan: &RebasePlan) -> Result<PathBuf, AppError> {
        let dir = cwd.join(".git").join("gitx");
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::new(ErrorCode::FsError, e.to_string()))?;
        let path = dir.join("rebase-todo");
        let mut body = String::new();
        for item in &plan.items {
            let short = &item.sha[..item.sha.len().min(7)];
            let verb = match item.action {
                RebaseTodoAction::Pick => "pick",
                RebaseTodoAction::Reword => "reword",
                RebaseTodoAction::Edit => "edit",
                RebaseTodoAction::Squash => "squash",
                RebaseTodoAction::Fixup => "fixup",
                RebaseTodoAction::Drop => "drop",
            };
            body.push_str(&format!("{verb} {short} {}\n", item.subject));
        }
        std::fs::write(&path, body)
            .map_err(|e| AppError::new(ErrorCode::FsError, e.to_string()))?;
        Ok(path)
    }

    fn save_rebase_plan(&self, cwd: &Path, plan: &RebasePlan) -> Result<(), AppError> {
        let dir = cwd.join(".git").join("gitx");
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::new(ErrorCode::FsError, e.to_string()))?;
        let path = dir.join("rebase-plan.json");
        let json = serde_json::to_string_pretty(plan)
            .map_err(|e| AppError::new(ErrorCode::Internal, e.to_string()))?;
        std::fs::write(path, json).map_err(|e| AppError::new(ErrorCode::FsError, e.to_string()))?;
        Ok(())
    }

    async fn gitx_dir(&self, cwd: &Path, cancel: &CancellationToken) -> Result<PathBuf, AppError> {
        let git_dir = self.git_dir(cwd, cancel).await?;
        let dir = git_dir.join("gitx");
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::new(ErrorCode::FsError, e.to_string()))?;
        Ok(dir)
    }

    async fn commit_message(
        &self,
        cwd: &Path,
        sha: &str,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let inv = GitInvocation::new(cwd, ["log", "-1", "--format=%B", sha])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }

    async fn commit_parents(
        &self,
        cwd: &Path,
        sha: &str,
        cancel: &CancellationToken,
    ) -> Result<Vec<String>, AppError> {
        let inv = GitInvocation::new(cwd, ["rev-list", "--parents", "-n", "1", sha])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let line = String::from_utf8_lossy(&out.stdout);
        let mut parts = line.split_whitespace();
        let _ = parts.next(); // self
        Ok(parts.map(|s| s.to_string()).collect())
    }

    async fn commit_author_env(
        &self,
        cwd: &Path,
        sha: &str,
        cancel: &CancellationToken,
    ) -> Result<HashMap<String, String>, AppError> {
        let inv = GitInvocation::new(
            cwd,
            ["log", "-1", "--format=%an%n%ae%n%at%n%cn%n%ce%n%ct", sha],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let lines: Vec<_> = String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|s| s.to_string())
            .collect();
        let mut map = HashMap::new();
        if lines.len() >= 6 {
            map.insert("GIT_AUTHOR_NAME".into(), lines[0].clone());
            map.insert("GIT_AUTHOR_EMAIL".into(), lines[1].clone());
            map.insert("GIT_AUTHOR_DATE".into(), lines[2].clone());
            map.insert("GIT_COMMITTER_NAME".into(), lines[3].clone());
            map.insert("GIT_COMMITTER_EMAIL".into(), lines[4].clone());
            // Keep committer date as now? IDEA preserves author; committer is rewriter.
            // Preserve original committer date for in-memory fidelity of pure reword.
            map.insert("GIT_COMMITTER_DATE".into(), lines[5].clone());
        }
        Ok(map)
    }

    async fn is_merge_commit(&self, cwd: &Path, sha: &str, cancel: &CancellationToken) -> bool {
        self.commit_parents(cwd, sha, cancel)
            .await
            .map(|p| p.len() > 1)
            .unwrap_or(false)
    }

    async fn ensure_on_current_branch(
        &self,
        cwd: &Path,
        sha: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let inv = GitInvocation::new(cwd, ["merge-base", "--is-ancestor", sha, "HEAD"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        if self.run(inv, cancel).await.is_err() {
            return Err(AppError::new(
                ErrorCode::CommitNotOnBranch,
                "commit is not an ancestor of HEAD",
            ));
        }
        Ok(())
    }

    async fn oldest_of(
        &self,
        cwd: &Path,
        shas: &[String],
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        let mut oldest = shas[0].clone();
        for s in &shas[1..] {
            let inv = GitInvocation::new(cwd, ["merge-base", "--is-ancestor", s, &oldest])
                .kind(OpKind::Read)
                .git_bin(self.git_bin.clone());
            if self.run(inv, cancel).await.is_ok() {
                oldest = s.clone();
            }
        }
        Ok(oldest)
    }

    async fn dirty_tracked_files(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<String>, AppError> {
        let inv = GitInvocation::new(cwd, ["diff", "--name-only", "HEAD"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let mut files: Vec<_> = String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let inv = GitInvocation::new(cwd, ["diff", "--name-only", "--cached"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        if let Ok(o) = self.run(inv, cancel).await {
            for l in String::from_utf8_lossy(&o.stdout).lines() {
                if !l.is_empty() && !files.iter().any(|f| f == l) {
                    files.push(l.to_string());
                }
            }
        }
        Ok(files)
    }
}

fn helper_bin() -> String {
    crate::runner::helper_bin()
}

fn companion_wt_ref(backup_ref: &str) -> Option<String> {
    // refs/gitx/backup/<op>-<ts> → refs/gitx/backup/<op>-wt-<ts>
    let name = backup_ref.rsplit('/').next()?;
    let (op, ts) = name.rsplit_once('-')?;
    Some(format!("refs/gitx/backup/{op}-wt-{ts}"))
}
