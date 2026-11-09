//! Clone / unshallow / URL check (M2).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, CloneResult, ErrorCode};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

impl GitRunner {
    pub async fn clone_check_url(
        &self,
        url: &str,
        cancel: &CancellationToken,
    ) -> Result<bool, AppError> {
        let cwd = std::env::temp_dir();
        let inv = GitInvocation::new(&cwd, ["ls-remote", "--heads", "--", url])
            .kind(OpKind::Network)
            .timeout(Some(Duration::from_secs(10)))
            .git_bin(self.git_bin.clone());
        match self.run(inv, cancel).await {
            Ok(_) => Ok(true),
            Err(e) => {
                let msg = e.message.to_lowercase();
                if msg.contains("authentication")
                    || msg.contains("could not read username")
                    || msg.contains("permission denied")
                {
                    // Reachable but needs credentials — treat as found.
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
        }
    }

    pub async fn clone_run(
        &self,
        url: &str,
        dir: &Path,
        depth: Option<u32>,
        branch: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<CloneResult, AppError> {
        if dir.exists() {
            let is_empty = std::fs::read_dir(dir)
                .map(|mut d| d.next().is_none())
                .unwrap_or(false);
            if !is_empty {
                return Err(AppError::new(
                    ErrorCode::FsError,
                    format!("target directory is not empty: {}", dir.display()),
                ));
            }
        } else if let Some(parent) = dir.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::new(
                    ErrorCode::FsError,
                    format!("failed to create parent directory: {e}"),
                )
            })?;
        }

        let mut args = vec!["clone".to_string(), "--progress".into()];
        if let Some(d) = depth {
            // Local (file) clones skip shallow unless --no-local is set.
            args.push("--no-local".into());
            args.push("--depth".into());
            args.push(d.to_string());
        }
        if let Some(b) = branch {
            args.push("--branch".into());
            args.push(b.to_string());
        }
        args.push("--".into());
        args.push(url.to_string());
        args.push(dir.display().to_string());

        let cwd = dir
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        let inv = GitInvocation::new(&cwd, args)
            .kind(OpKind::NetworkWrite)
            .timeout(Some(Duration::from_secs(3600)))
            .git_bin(self.git_bin.clone());

        match self.run(inv, cancel).await {
            Ok(_) => Ok(CloneResult {
                path: dir.display().to_string(),
                shallow: depth.is_some(),
            }),
            // A concurrent process may have created files in the destination.
            // Leave Git's own rollback in charge; never recursively delete it.
            Err(e) => Err(e),
        }
    }

    pub async fn unshallow_run(
        &self,
        cwd: &Path,
        remote: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let mut args = vec![
            "fetch".to_string(),
            "--progress".into(),
            "--unshallow".into(),
        ];
        if let Some(r) = remote {
            args.push(r.to_string());
        }
        let inv = GitInvocation::new(cwd, args)
            .kind(OpKind::Network)
            .timeout(Some(Duration::from_secs(3600)))
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn is_shallow(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<bool, AppError> {
        let inv = GitInvocation::new(cwd, ["rev-parse", "--is-shallow-repository"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        Ok(String::from_utf8_lossy(&out.stdout).trim() == "true")
    }
}
