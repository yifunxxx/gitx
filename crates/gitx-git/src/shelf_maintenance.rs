//! Coordinate retention with complete Shelf writes, including across worktrees
//! and app processes. External Git operations still use Git's ref transactions.

use crate::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode};
use std::collections::BTreeSet;
use std::fs::File;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Default)]
pub struct ShelfMaintenanceReport {
    pub expired: usize,
    pub removed_refs: usize,
    pub refs_preserved: bool,
}

pub(super) async fn shelf_operation_lock(
    common: &Path,
    cancel: &CancellationToken,
) -> Result<File, AppError> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        check_cancel(cancel)?;
        if let Some(lock) = gitx_meta::try_shelf_operation_lock(common)? {
            return Ok(lock);
        }
        tokio::select! {
            _ = cancel.cancelled() => return Err(AppError::new(ErrorCode::Cancelled, "cancelled")),
            _ = tokio::time::sleep_until(deadline) => return Err(AppError::new(ErrorCode::OperationInProgress, "another Shelf operation is running; try again")),
            _ = tokio::time::sleep(Duration::from_millis(25)) => {}
        }
    }
}

fn check_cancel(cancel: &CancellationToken) -> Result<(), AppError> {
    if cancel.is_cancelled() {
        Err(AppError::new(ErrorCode::Cancelled, "cancelled"))
    } else {
        Ok(())
    }
}

fn object_id(id: &str) -> bool {
    matches!(id.len(), 40 | 64)
        && id.bytes().all(|b| b.is_ascii_hexdigit())
        && id.bytes().any(|b| b != b'0')
}

impl GitRunner {
    pub async fn shelf_maintenance_is_due(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<bool, AppError> {
        let common = self.git_common_dir(cwd, cancel).await?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AppError::new(ErrorCode::Internal, "invalid system clock"))?
            .as_secs() as i64;
        gitx_meta::shelf_maintenance_due(&common, now)
    }

    pub async fn shelf_maintain_if_due(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Option<ShelfMaintenanceReport>, AppError> {
        self.maintain_shelf(cwd, false, cancel).await
    }

    /// Explicit maintenance for tests and callers that already hold the repo
    /// write permit. Native refresh uses the hourly, persisted due check.
    pub async fn shelf_maintain(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<ShelfMaintenanceReport, AppError> {
        Ok(self
            .maintain_shelf(cwd, true, cancel)
            .await?
            .unwrap_or_default())
    }

    async fn maintain_shelf(
        &self,
        cwd: &Path,
        force: bool,
        cancel: &CancellationToken,
    ) -> Result<Option<ShelfMaintenanceReport>, AppError> {
        let common = self.git_common_dir(cwd, cancel).await?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AppError::new(ErrorCode::Internal, "invalid system clock"))?
            .as_secs() as i64;
        if !force && !gitx_meta::shelf_maintenance_due(&common, now)? {
            return Ok(None);
        }
        let _lock = shelf_operation_lock(&common, cancel).await?;
        // Another process could have completed maintenance while we waited.
        if !force && !gitx_meta::shelf_maintenance_due(&common, now)? {
            return Ok(None);
        }
        check_cancel(cancel)?;
        let inventory = gitx_meta::maintain_deleted_shelves(&common, now)?;
        let mut report = ShelfMaintenanceReport {
            expired: inventory.expired,
            refs_preserved: !inventory.complete,
            ..Default::default()
        };
        let mut ids = BTreeSet::new();
        let mut objects = BTreeSet::new();
        'shelves: for shelf in inventory.entries {
            check_cancel(cancel)?;
            ids.insert(shelf.entry.id.clone());
            let retained = match shelf.objects {
                Some(objects) => objects,
                None => {
                    let patches = match gitx_meta::shelf_legacy_patches(
                        &common,
                        &shelf.entry.id,
                        shelf.deleted,
                    ) {
                        Ok(patches) => patches,
                        Err(error) => {
                            tracing::warn!(%error, "legacy Shelf refs preserved");
                            report.refs_preserved = true;
                            continue;
                        }
                    };
                    let mut retained = vec![shelf.entry.base_sha.clone()];
                    for patch in patches {
                        match self.shelf_patch_preimages(cwd, &patch, true, cancel).await {
                            Ok(Some(tree)) => retained.push(tree),
                            Ok(None) => {}
                            Err(error) if error.code == ErrorCode::ShelfFailed => {
                                tracing::warn!(%error, "legacy Shelf refs preserved");
                                report.refs_preserved = true;
                                continue 'shelves;
                            }
                            Err(error) => return Err(error),
                        }
                    }
                    retained.sort();
                    retained.dedup();
                    if !retained.iter().all(|id| object_id(id)) {
                        report.refs_preserved = true;
                        continue;
                    }
                    // Publish reachability before declaring ownership complete.
                    self.retain_shelf_objects(cwd, &retained, cancel).await?;
                    gitx_meta::record_shelf_objects(
                        &common,
                        &shelf.entry.id,
                        shelf.deleted,
                        retained.clone(),
                    )?;
                    retained
                }
            };
            if !retained.iter().all(|id| object_id(id)) || !retained.contains(&shelf.entry.base_sha)
            {
                report.refs_preserved = true;
                continue;
            }
            objects.extend(retained);
        }
        if !report.refs_preserved {
            if !objects.is_empty() {
                self.retain_shelf_objects(
                    cwd,
                    &objects.iter().cloned().collect::<Vec<_>>(),
                    cancel,
                )
                .await?;
            }
            let out = self
                .run(
                    GitInvocation::new(
                        cwd,
                        [
                            "for-each-ref",
                            "--format=%(refname) %(objectname) %(symref)",
                            "refs/gitx/",
                        ],
                    ),
                    cancel,
                )
                .await?;
            let mut deletes = String::new();
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let fields: Vec<_> = line.split_whitespace().collect();
                let [name, old] = fields.as_slice() else {
                    continue;
                }; // Never follow symbolic refs.
                if !object_id(old) {
                    continue;
                }
                let orphan = if let Some(object) = name.strip_prefix("refs/gitx/shelf-base-") {
                    // Unknown/mismatched internal refs are not ours to reclaim.
                    object == *old && !objects.contains(object)
                } else if let Some(id) = name.strip_prefix("refs/gitx/shelf/") {
                    uuid::Uuid::parse_str(id).is_ok_and(|u| u.to_string() == id)
                        && !ids.contains(id)
                } else {
                    false
                };
                if orphan {
                    deletes.push_str(&format!("delete {name} {old}\n"));
                    report.removed_refs += 1;
                }
            }
            if !deletes.is_empty() {
                // Atomic compare-and-delete: cancellation or a changed ref
                // leaves the transaction unapplied. --no-deref protects branches.
                self.run(
                    GitInvocation::new(cwd, ["update-ref", "--no-deref", "--stdin"])
                        .stdin(deletes.into_bytes())
                        .kind(OpKind::Write),
                    cancel,
                )
                .await?;
            }
        }
        check_cancel(cancel)?;
        gitx_meta::record_shelf_maintenance(&common, now)?;
        Ok(Some(report))
    }

    async fn retain_shelf_objects(
        &self,
        cwd: &Path,
        objects: &[String],
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let updates = objects
            .iter()
            .map(|id| format!("update refs/gitx/shelf-base-{id} {id}\n"))
            .collect::<String>();
        self.run(
            GitInvocation::new(cwd, ["update-ref", "--no-deref", "--stdin"])
                .stdin(updates.into_bytes())
                .kind(OpKind::Write),
            cancel,
        )
        .await?;
        Ok(())
    }
}
