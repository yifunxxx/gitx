//! M5: interactive rebase, reword/squash/drop/fixup, reset/revert/uncommit,
//! extract/drop selected changes, undo via backup refs.

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{
    AppError, ErrorCode, RebasePlan, RebaseTodoAction, RebaseTodoItem, ResetMode, ResetPreview,
    RewriteHead, RewriteOutcome, RewriteResult,
};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
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
        if plan.items.iter().any(|item| {
            !matches!(item.sha.len(), 40 | 64)
                || !item.sha.bytes().all(|byte| byte.is_ascii_hexdigit())
        }) {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "rebase plan requires full commit IDs",
            ));
        }
        if plan
            .items
            .iter()
            .find(|item| item.action != RebaseTodoAction::Drop)
            .is_some_and(|item| {
                matches!(
                    item.action,
                    RebaseTodoAction::Squash | RebaseTodoAction::Fixup
                )
            })
        {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "squash/fixup requires a preceding commit in the plan",
            ));
        }
        if plan.rebase_merges || plan.autosquash {
            let range = if plan.base.is_empty() {
                "HEAD".to_string()
            } else {
                format!("{}..HEAD", plan.base)
            };
            let original = self.list_todo_commits(cwd, &range, cancel).await?;
            if !original
                .iter()
                .map(|item| &item.sha)
                .eq(plan.items.iter().map(|item| &item.sha))
            {
                return Err(AppError::new(ErrorCode::InvalidArgument,
                    "manual reordering is unavailable with rebase-merges or autosquash; use Drop to remove commits"));
            }
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

        let old = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        let backup = Some(
            self.safety_backup(cwd, "rebase-interactive", &old, cancel)
                .await?,
        );
        self.save_rebase_plan(cwd, plan, cancel).await?;

        let needs_edit = plan
            .items
            .iter()
            .any(|i| matches!(i.action, RebaseTodoAction::Edit));
        let can_in_memory = !needs_edit
            && plan.onto.is_none()
            && !plan.rebase_merges
            && !plan.autosquash
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
        let backup = Some(self.safety_backup(cwd, "reword", &old, cancel).await?);

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
                undo_head: None,
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
        let backup = Some(self.safety_backup(cwd, "squash", &old, cancel).await?);
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
        let backup = Some(self.safety_backup(cwd, "drop", &old, cancel).await?);
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

    /// Commit the selected local changes and let Git's autosquash sequence
    /// place them next to the selected historical commit.
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
        if self.is_merge_commit(cwd, &target, cancel).await {
            return Err(AppError::new(
                ErrorCode::MergeCommitNotAllowed,
                "cannot fixup or squash into a merge commit",
            ));
        }
        if squash && message.is_some_and(|message| message.trim().is_empty()) {
            return Err(AppError::new(
                ErrorCode::EmptyCommitMessage,
                "commit message is empty",
            ));
        }
        let squash_message = if squash {
            Some(match message {
                Some(message) => message.to_string(),
                None => self.commit_message(cwd, &target, cancel).await?,
            })
        } else {
            None
        };
        let old = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        let backup = Some(
            self.safety_backup(
                cwd,
                if squash { "squash-into" } else { "fixup" },
                &old,
                cancel,
            )
            .await?,
        );

        let staged = GitInvocation::new(cwd, ["diff", "--cached", "--quiet"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let use_all_tracked = match self.run(staged, cancel).await {
            Ok(_) => true,
            Err(error) if error.exit_code == Some(1) => false,
            Err(error) => return Err(error),
        };
        let mut args = vec![
            "commit".to_string(),
            "--message".into(),
            // Subjects can repeat or themselves start with fixup!/squash!.
            // Git's autosquash accepts an object ID as the exact target.
            format!("{}! {target}", if squash { "squash" } else { "fixup" }),
        ];
        if use_all_tracked {
            args.push("-a".into());
        }
        // A rejected hook is an error. Retrying with -a would silently include
        // unrelated unstaged files and run the hook a second time.
        self.run(
            GitInvocation::new(cwd, args)
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone()),
            cancel,
        )
        .await?;
        let fixup = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        let mut plan = self.rebase_interactive_plan(cwd, &target, cancel).await?;
        plan.autosquash = true;
        for item in &mut plan.items {
            if self.is_merge_commit(cwd, &item.sha, cancel).await {
                plan.rebase_merges = true;
            }
            if squash && item.sha == fixup {
                item.action = RebaseTodoAction::Squash;
                item.message = squash_message.clone();
            }
        }

        // A flat in-memory replay would fold the new change into the tip.
        // Native autosquash performs the target-aware reorder, while Smart
        // restoration preserves any local changes excluded from this commit.
        let result = self
            .cli_interactive_rebase(cwd, &plan, &old, backup, true, cancel)
            .await?;
        if result.outcome == RewriteOutcome::Success {
            Ok(RewriteResult {
                message: if squash {
                    "Squashed into commit".into()
                } else {
                    "Fixed up into commit".into()
                },
                ..result
            })
        } else {
            Ok(result)
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
        let backup = Some(self.safety_backup(cwd, "uncommit", &old, cancel).await?);
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
            undo_head: None,
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
        let backup = Some(self.safety_backup(cwd, "revert", &old, cancel).await?);
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
            Ok(_) => {
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
                        undo_head: None,
                    });
                }
                Ok(RewriteResult {
                    old_head: old,
                    new_head: new,
                    outcome: RewriteOutcome::Success,
                    message: format!("Reverted {} commit(s)", shas.len()),
                    conflict_files: vec![],
                    backup_ref: backup,
                    undo_head: None,
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
        let backup = Some(self.safety_backup(cwd, "reset", &old, cancel).await?);
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
                    undo_head: None,
                })
            }
            Err(e) => {
                self.map_rewrite_err(cwd, e, &old, backup, "reset", cancel)
                    .await
            }
        }
    }

    async fn backup_worktree_snapshot(
        &self,
        cwd: &Path,
        backup_ref: &str,
        cancel: &CancellationToken,
    ) -> Result<Option<String>, AppError> {
        let Some(reference) = companion_wt_ref(backup_ref) else {
            return Ok(None);
        };
        let inv = GitInvocation::new(cwd, ["show-ref", "--verify", "--quiet", &reference])
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(_) => Ok(Some(self.rev_parse_public(cwd, &reference, cancel).await?)),
            Err(error) if error.exit_code == Some(1) => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Restore branch tip to a backup ref (Undo after rewrite).
    pub async fn undo_rewrite(
        &self,
        cwd: &Path,
        backup_ref: &str,
        restore_worktree: bool,
        expected: &RewriteHead,
        cancel: &CancellationToken,
    ) -> Result<RewriteResult, AppError> {
        self.ensure_not_busy(cwd, cancel).await?;
        if !backup_ref.starts_with("refs/gitx/backup/") {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "undo requires a gitx backup reference",
            ));
        }
        self.run(
            GitInvocation::new(cwd, ["check-ref-format", backup_ref]).git_bin(self.git_bin.clone()),
            cancel,
        )
        .await?;
        self.check_undo_head(cwd, expected, cancel).await?;
        let old = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        let target = self.rev_parse_public(cwd, backup_ref, cancel).await?;
        let snapshot = if restore_worktree {
            self.backup_worktree_snapshot(cwd, backup_ref, cancel)
                .await?
        } else {
            None
        };
        let backup = self.safety_backup(cwd, "undo", &old, cancel).await?;
        // Partial drop (and other ref-only rewrites) retain the original index
        // and worktree. If both still equal the saved snapshot, only HEAD needs
        // restoring. Checking out would reject the already-preserved local work
        // on paths whose committed content changed. Exact trees are required;
        // matching deltas alone cannot establish that a checkout is unnecessary.
        let preserve_checkout = if let Some(original) = snapshot.as_ref() {
            if let Some(current) = self.backup_worktree_snapshot(cwd, &backup, cancel).await? {
                self.same_snapshot_trees(cwd, original, &current, cancel)
                    .await?
            } else {
                false
            }
        } else {
            false
        };
        // A two-tree checkout retains staged and unstaged changes on paths
        // unchanged between the two commits, and refuses an overwrite. Unlike
        // reset --keep, it does not silently unstage unrelated local work.
        if !preserve_checkout {
            let inv = GitInvocation::new(cwd, ["read-tree", "-m", "-u", &old, &target])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            self.run(inv, cancel).await?;
        }
        if let Err(mut error) = self
            .update_ref_cas(cwd, "HEAD", &target, &old, "gitx: undo rewrite", cancel)
            .await
        {
            // A ref lock or transaction hook can reject the final HEAD update.
            // Reverse only this checkout, using the same overwrite protection.
            if !preserve_checkout {
                let rollback = GitInvocation::new(cwd, ["read-tree", "-m", "-u", &target, &old])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                if let Err(rollback_error) = self.run(rollback, &CancellationToken::new()).await {
                    error.message = format!(
                        "{}; checkout rollback failed: {}. Backup retained at {backup}",
                        error.message, rollback_error.message
                    );
                }
            }
            return Err(error);
        }
        if let Some(snapshot) = snapshot.filter(|_| !preserve_checkout) {
            // Pure message rewrites leave the original dirty state in place.
            // Do not reapply a snapshot that is already present in full.
            let current = self
                .run(
                    GitInvocation::new(cwd, ["stash", "create"]).git_bin(self.git_bin.clone()),
                    cancel,
                )
                .await?;
            let current = String::from_utf8_lossy(&current.stdout).trim().to_owned();
            let mut already_restored = !current.is_empty()
                && self
                    .same_snapshot_trees(cwd, &snapshot, &current, cancel)
                    .await?;
            if !already_restored && !current.is_empty() {
                already_restored = self
                    .same_snapshot_changes(cwd, &snapshot, &current, cancel)
                    .await?;
            }
            if !already_restored {
                let inv = GitInvocation::new(cwd, ["stash", "apply", "--index", &snapshot])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone());
                self.run(inv, cancel).await.map_err(|error| {
                    AppError::new(error.code, format!(
                        "Previous HEAD restored, but local changes could not be restored from snapshot {snapshot}. Both snapshots are retained ({backup_ref}, {backup}): {}",
                        error.message
                    )).with_stderr(error.git_stderr.unwrap_or_default())
                })?;
            }
        }
        Ok(RewriteResult {
            old_head: old,
            new_head: target,
            outcome: RewriteOutcome::Success,
            message: "Restored previous HEAD".into(),
            conflict_files: vec![],
            backup_ref: Some(backup),
            undo_head: None,
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
                ErrorCode::InvalidArgument,
                "no paths selected",
            ));
        }
        let root = self.resolve_repo_root(cwd, 0, cancel).await?;
        let cwd = Path::new(&root.worktree_root);
        let c = self.rev_parse_public(cwd, commit, cancel).await?;
        self.ensure_on_current_branch(cwd, &c, cancel).await?;
        let details = self.log_commit_details(cwd, &c, cancel).await?;
        if details.parents.len() > 1 {
            return Err(AppError::new(
                ErrorCode::MergeCommitNotAllowed,
                "cannot extract/drop from a merge commit",
            ));
        }
        let old = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        let merges = self
            .run(
                GitInvocation::new(cwd, ["rev-list", "--merges", "-1", &format!("{c}..{old}")])
                    .kind(OpKind::Read)
                    .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?;
        if !merges.stdout.is_empty() {
            return Err(AppError::new(
                ErrorCode::MergeCommitNotAllowed,
                "cannot extract/drop across descendant merge commits",
            ));
        }
        let changed = self.commit_changed_files(cwd, &c, cancel).await?;
        let mut selected = HashSet::new();
        for path in paths {
            let file = changed
                .iter()
                .find(|file| file.path == *path)
                .ok_or_else(|| {
                    AppError::new(
                        ErrorCode::InvalidArgument,
                        format!("path is not changed in this commit: {path}"),
                    )
                })?;
            selected.insert(file.path.clone());
            // A rename is one change: restore both its source and destination.
            // Copies leave the source unchanged.
            if file.status.starts_with('R') {
                if let Some(original) = &file.orig_path {
                    selected.insert(original.clone());
                }
            }
        }
        let donor = match details.parents.first() {
            Some(parent) => parent.clone(),
            None => self.empty_tree(cwd, cancel).await?,
        };
        let backup = Some(
            self.safety_backup(
                cwd,
                if extract { "extract" } else { "drop-changes" },
                &old,
                cancel,
            )
            .await?,
        );

        // T1 = parent tree with only non-selected changes from C applied
        // = C's tree with selected paths restored from parent
        let t_c = self
            .rev_parse_public(cwd, &format!("{c}^{{tree}}"), cancel)
            .await?;
        let t1 = self
            .tree_with_paths_from(cwd, &t_c, &donor, &selected, cancel)
            .await?;

        let orig_msg = self.commit_message(cwd, &c, cancel).await?;
        let author_env = self.commit_author_env(cwd, &c, cancel).await?;

        let parents: Vec<&str> = details.parents.iter().map(String::as_str).collect();
        let c_prime = self
            .commit_tree(cwd, &t1, &parents, &orig_msg, &author_env, cancel)
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
            undo_head: None,
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
                    let msg = if let Some(ref m) = item.message {
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
            undo_head: None,
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
        let todo_path = self.write_todo_file(cwd, plan, cancel).await?;
        let plan_path = todo_path.with_file_name("rebase-plan.json");
        let mut args = vec![
            "-c".into(),
            "rebase.abbreviateCommands=false".into(),
            "rebase".into(),
            "-i".into(),
        ];
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

        let seq_editor = helper_command("seq-editor");
        let editor = helper_command("editor");
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone())
            .timeout(Some(std::time::Duration::from_secs(600)))
            .env("GIT_SEQUENCE_EDITOR", seq_editor)
            .env("GITX_REBASE_TODO", todo_path.to_string_lossy())
            .env("GITX_REBASE_PLAN", plan_path.to_string_lossy())
            .env("GIT_EDITOR", editor);

        let run = if smart {
            self.with_clean_tree_inv(cwd, "rebase", inv, cancel)
                .await
                .map(|_| ())
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
                            format!("Rebase paused{}", self.smart_stash_note(cwd, cancel).await?)
                        } else {
                            format!("Conflicts in {} file(s)", files.len())
                        },
                        conflict_files: files,
                        backup_ref: backup,
                        undo_head: None,
                    });
                }
                Ok(RewriteResult {
                    old_head: old.to_string(),
                    new_head: new,
                    outcome: RewriteOutcome::Success,
                    message: "Rebase finished".into(),
                    conflict_files: vec![],
                    backup_ref: backup,
                    undo_head: None,
                })
            }
            Err(e) => {
                self.map_rewrite_err(cwd, e, old, backup, "rebase", cancel)
                    .await
            }
        }
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
                if e.exit_code == Some(129) {
                    return self
                        .replay_with_temporary_index(cwd, ours, merge_base, theirs, cancel)
                        .await;
                }
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

    /// Compatibility with Git versions predating merge-tree --write-tree.
    /// An isolated index keeps both the user's index and worktree untouched.
    async fn replay_with_temporary_index(
        &self,
        cwd: &Path,
        ours: &str,
        base: &str,
        theirs: &str,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        // git apply silently skips paths outside its cwd. Replay the complete
        // commit from the repository root even when the caller opened a subdir.
        let root = self.resolve_repo_root(cwd, 0, cancel).await?;
        let cwd = Path::new(&root.worktree_root);
        let dir =
            tempfile::tempdir().map_err(|e| AppError::new(ErrorCode::FsError, e.to_string()))?;
        let index = dir.path().join("index").to_string_lossy().into_owned();
        // This patch is machine input. Display settings and text converters
        // must not change its paths/content or hide submodule updates.
        let patch = self
            .run(
                GitInvocation::new(
                    cwd,
                    [
                        "diff",
                        "--binary",
                        "--full-index",
                        "--no-ext-diff",
                        "--no-textconv",
                        "--no-color",
                        "--no-relative",
                        "--src-prefix=a/",
                        "--dst-prefix=b/",
                        "--output-indicator-new=+",
                        "--output-indicator-old=-",
                        "--output-indicator-context= ",
                        "--ignore-submodules=none",
                        "--submodule=short",
                        base,
                        theirs,
                        "--",
                    ],
                )
                .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?
            .stdout;
        self.run(
            GitInvocation::new(cwd, ["read-tree", ours])
                .git_bin(self.git_bin.clone())
                .env("GIT_INDEX_FILE", &index),
            cancel,
        )
        .await?;
        if !patch.is_empty() {
            if let Err(error) = self
                .run(
                    GitInvocation::new(cwd, ["apply", "--cached", "--3way", "--whitespace=nowarn"])
                        .git_bin(self.git_bin.clone())
                        .env("GIT_INDEX_FILE", &index)
                        .stdin(patch),
                    cancel,
                )
                .await
            {
                if error.exit_code == Some(1) {
                    return Err(AppError::new(
                        ErrorCode::RewriteConflict,
                        "in-memory replay conflicted",
                    ));
                }
                return Err(error);
            }
        }
        let out = self
            .run(
                GitInvocation::new(cwd, ["write-tree"])
                    .git_bin(self.git_bin.clone())
                    .env("GIT_INDEX_FILE", &index),
                cancel,
            )
            .await?;
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
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
        donor_tree: &str,
        paths: &HashSet<String>,
        cancel: &CancellationToken,
    ) -> Result<String, AppError> {
        // Keep temporary state in the actual git directory, including linked
        // worktrees. RAII removes the index and lock on errors/cancellation too.
        let git_dir = self.git_dir(cwd, cancel).await?;
        let temporary = tempfile::Builder::new()
            .prefix("gitx-partial-")
            .tempdir_in(git_dir)
            .map_err(|e| AppError::new(ErrorCode::FsError, e.to_string()))?;
        let index_path = temporary.path().join("index");
        self.run(
            GitInvocation::new(cwd, ["read-tree", base_tree])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone())
                .env("GIT_INDEX_FILE", index_path.to_string_lossy()),
            cancel,
        )
        .await?;

        // Compare exact, repository-relative names instead of treating filenames
        // as pathspecs. NUL-delimited index-info also preserves commas and tabs.
        let donor = self
            .run(
                GitInvocation::new(cwd, ["ls-tree", "-rz", "--full-tree", donor_tree])
                    .kind(OpKind::Read)
                    .git_bin(self.git_bin.clone()),
                cancel,
            )
            .await?;
        let selected_bytes: HashSet<&[u8]> = paths.iter().map(|path| path.as_bytes()).collect();
        let mut updates = Vec::new();
        for path in paths {
            updates.extend_from_slice(
                format!("0 {}\t{}\0", "0".repeat(base_tree.len()), path).as_bytes(),
            );
        }
        for entry in donor
            .stdout
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
        {
            let separator = entry
                .iter()
                .position(|byte| *byte == b'\t')
                .ok_or_else(|| AppError::new(ErrorCode::Internal, "invalid tree entry"))?;
            if selected_bytes.contains(&entry[separator + 1..]) {
                updates.extend_from_slice(entry);
                updates.push(0);
            }
        }
        self.run(
            GitInvocation::new(cwd, ["update-index", "-z", "--index-info"])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone())
                .env("GIT_INDEX_FILE", index_path.to_string_lossy())
                .stdin(updates),
            cancel,
        )
        .await?;
        let out = self
            .run(
                GitInvocation::new(cwd, ["write-tree"])
                    .kind(OpKind::Write)
                    .git_bin(self.git_bin.clone())
                    .env("GIT_INDEX_FILE", index_path.to_string_lossy()),
                cancel,
            )
            .await?;
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

    async fn write_todo_file(
        &self,
        cwd: &Path,
        plan: &RebasePlan,
        cancel: &CancellationToken,
    ) -> Result<PathBuf, AppError> {
        self.save_rebase_plan(cwd, plan, cancel).await?;
        let dir = self.gitx_dir(cwd, cancel).await?;
        let path = dir.join("rebase-todo");
        let mut body = String::new();
        for item in &plan.items {
            let verb = match item.action {
                RebaseTodoAction::Pick if item.message.is_some() => "reword",
                RebaseTodoAction::Pick => "pick",
                RebaseTodoAction::Reword => "reword",
                RebaseTodoAction::Edit => "edit",
                RebaseTodoAction::Squash => "squash",
                RebaseTodoAction::Fixup => "fixup",
                RebaseTodoAction::Drop => "drop",
            };
            let subject = item.subject.replace(['\r', '\n'], " ");
            body.push_str(&format!("{verb} {} {subject}\n", item.sha));
        }
        std::fs::write(&path, body)
            .map_err(|e| AppError::new(ErrorCode::FsError, e.to_string()))?;
        Ok(path)
    }

    async fn save_rebase_plan(
        &self,
        cwd: &Path,
        plan: &RebasePlan,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let dir = self.gitx_dir(cwd, cancel).await?;
        let path = dir.join("rebase-plan.json");
        let mut data = serde_json::to_value(plan)
            .map_err(|e| AppError::new(ErrorCode::Internal, e.to_string()))?;
        if plan
            .items
            .iter()
            .any(|item| item.action == RebaseTodoAction::Squash && item.message.is_some())
        {
            let mut originals = serde_json::Map::new();
            for item in &plan.items {
                if item.message.is_none()
                    && (item.action == RebaseTodoAction::Squash
                        || (plan.autosquash && item.subject.starts_with("squash! ")))
                {
                    originals.insert(
                        item.sha.clone(),
                        self.commit_message(cwd, &item.sha, cancel).await?.into(),
                    );
                }
            }
            data["originalMessages"] = originals.into();
        }
        let json = serde_json::to_string_pretty(&data)
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

pub(crate) fn helper_command(mode: &str) -> String {
    let path = crate::runner::helper_bin();
    // Git evaluates editor commands with its shell, including Git for Windows.
    // Preserve spaces and shell metacharacters as part of the executable path.
    #[cfg(windows)]
    let path = path.replace('\\', "/");
    format!("'{}' {mode}", path.replace('\'', "'\\''"))
}

fn companion_wt_ref(backup_ref: &str) -> Option<String> {
    // refs/gitx/backup/<op>-<ts> → refs/gitx/backup/<op>-wt-<ts>
    let name = backup_ref.rsplit('/').next()?;
    let (op, ts) = name.rsplit_once('-')?;
    Some(format!("refs/gitx/backup/{op}-wt-{ts}"))
}

#[cfg(test)]
mod tests;
