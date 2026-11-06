//! Remote list / add / edit / remove (M2).

use crate::runner::{GitInvocation, GitRunner, OpKind};
use gitx_core::{AppError, ErrorCode, RemoteInfo};
use std::collections::BTreeMap;
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitRunner {
    pub async fn remote_list(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<RemoteInfo>, AppError> {
        let inv = GitInvocation::new(cwd, ["remote", "-v"])
            .kind(OpKind::Read)
            .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let text = String::from_utf8_lossy(&out.stdout);
        let mut map: BTreeMap<String, RemoteInfo> = BTreeMap::new();
        for line in text.lines() {
            // name<TAB>url (fetch|push)
            let mut parts = line.split_whitespace();
            let Some(name) = parts.next() else { continue };
            let Some(url) = parts.next() else { continue };
            let kind = parts.next().unwrap_or("(fetch)");
            let entry = map.entry(name.to_string()).or_insert_with(|| RemoteInfo {
                name: name.to_string(),
                fetch_url: String::new(),
                push_url: None,
            });
            if kind.contains("push") {
                if entry.fetch_url.is_empty() {
                    entry.fetch_url = url.to_string();
                } else if url != entry.fetch_url {
                    entry.push_url = Some(url.to_string());
                }
            } else {
                entry.fetch_url = url.to_string();
            }
        }
        Ok(map.into_values().collect())
    }

    pub async fn remote_add(
        &self,
        cwd: &Path,
        name: &str,
        url: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        validate_remote_name(name)?;
        let inv = GitInvocation::new(cwd, ["remote", "add", name, url])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await?;
        Ok(())
    }

    pub async fn remote_edit(
        &self,
        cwd: &Path,
        name: &str,
        new_name: Option<&str>,
        url: Option<&str>,
        push_url: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let mut current = name.to_string();
        if let Some(nn) = new_name.filter(|n| *n != name) {
            validate_remote_name(nn)?;
            let inv = GitInvocation::new(cwd, ["remote", "rename", &current, nn])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            self.run(inv, cancel).await?;
            current = nn.to_string();
        }
        if let Some(u) = url {
            let inv = GitInvocation::new(cwd, ["remote", "set-url", &current, u])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            self.run(inv, cancel).await?;
        }
        if let Some(pu) = push_url {
            let inv = GitInvocation::new(cwd, ["remote", "set-url", "--push", &current, pu])
                .kind(OpKind::Write)
                .git_bin(self.git_bin.clone());
            self.run(inv, cancel).await?;
        }
        Ok(())
    }

    pub async fn remote_remove(
        &self,
        cwd: &Path,
        name: &str,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let inv = GitInvocation::new(cwd, ["remote", "remove", name])
            .kind(OpKind::Write)
            .git_bin(self.git_bin.clone());
        self.run(inv, cancel).await.map_err(|e| {
            if e.message.to_lowercase().contains("no such remote") {
                AppError::new(
                    ErrorCode::RemoteNotFound,
                    format!("remote '{name}' not found"),
                )
            } else {
                e
            }
        })?;
        Ok(())
    }

    pub async fn remote_tracking_count(
        &self,
        cwd: &Path,
        remote: &str,
        cancel: &CancellationToken,
    ) -> Result<u32, AppError> {
        let inv = GitInvocation::new(
            cwd,
            [
                "for-each-ref",
                "--format=%(refname)",
                &format!("refs/remotes/{remote}"),
            ],
        )
        .kind(OpKind::Read)
        .git_bin(self.git_bin.clone());
        let out = self.run(inv, cancel).await?;
        let n = String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter(|l| !l.is_empty() && !l.ends_with("/HEAD"))
            .count();
        Ok(n as u32)
    }
}

fn validate_remote_name(name: &str) -> Result<(), AppError> {
    if name.is_empty()
        || name.contains(|c: char| c.is_whitespace() || c == '/' || c == '\\')
        || name == "."
        || name == ".."
    {
        return Err(AppError::new(
            ErrorCode::InvalidRefName,
            format!("invalid remote name: {name}"),
        ));
    }
    Ok(())
}
