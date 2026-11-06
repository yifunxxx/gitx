//! Fixture repository builder (M0 scenarios + M2 with-remote).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TestkitError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("git: {0}")]
    Git(String),
}

pub struct FixtureRepo {
    pub root: PathBuf,
    _temp: Option<TempDir>,
}

impl FixtureRepo {
    pub fn path(&self) -> &Path {
        &self.root
    }
}

pub struct FixtureBuilder {
    keep: bool,
}

impl Default for FixtureBuilder {
    fn default() -> Self {
        Self { keep: false }
    }
}

impl FixtureBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn build(&self, scenario: &str) -> Result<FixtureRepo, TestkitError> {
        let temp = TempDir::new()?;
        // Deterministic timestamps.
        std::env::set_var("GIT_AUTHOR_DATE", "2024-01-01T00:00:00Z");
        std::env::set_var("GIT_COMMITTER_DATE", "2024-01-01T00:00:00Z");

        let repo_root = if scenario == "with-remote" {
            build_with_remote(temp.path())?
        } else {
            let root = temp.path().to_path_buf();
            git(&root, &["init", "-b", "main"])?;
            git(&root, &["config", "user.name", "gitx-test"])?;
            git(&root, &["config", "user.email", "gitx@test.local"])?;
            match scenario {
                "clean" => {
                    write(&root, "README.md", "# clean\n")?;
                    git(&root, &["add", "README.md"])?;
                    git(&root, &["commit", "-m", "initial"])?;
                }
                "dirty" => {
                    write(&root, "README.md", "# dirty\n")?;
                    git(&root, &["add", "README.md"])?;
                    git(&root, &["commit", "-m", "initial"])?;
                    write(&root, "README.md", "# dirty modified\n")?;
                }
                "untracked" => {
                    write(&root, "README.md", "# untracked\n")?;
                    git(&root, &["add", "README.md"])?;
                    git(&root, &["commit", "-m", "initial"])?;
                    write(&root, "new.txt", "untracked\n")?;
                }
                "empty" => {}
                "detached" => {
                    write(&root, "README.md", "# detached\n")?;
                    git(&root, &["add", "README.md"])?;
                    git(&root, &["commit", "-m", "initial"])?;
                    write(&root, "README.md", "# second\n")?;
                    git(&root, &["add", "README.md"])?;
                    git(&root, &["commit", "-m", "second"])?;
                    let sha = git_stdout(&root, &["rev-parse", "HEAD~1"])?;
                    git(&root, &["checkout", "--detach", sha.trim()])?;
                }
                other => {
                    return Err(TestkitError::Git(format!("unknown scenario: {other}")));
                }
            }
            root
        };

        if self.keep {
            let kept = temp.keep();
            let root = if scenario == "with-remote" {
                kept.join("work")
            } else {
                kept
            };
            Ok(FixtureRepo { root, _temp: None })
        } else {
            Ok(FixtureRepo {
                root: repo_root,
                _temp: Some(temp),
            })
        }
    }
}

fn build_with_remote(temp: &Path) -> Result<PathBuf, TestkitError> {
    let work = temp.join("work");
    let bare = temp.join("remote.git");
    fs::create_dir_all(&work)?;
    git(&work, &["init", "-b", "main"])?;
    git(&work, &["config", "user.name", "gitx-test"])?;
    git(&work, &["config", "user.email", "gitx@test.local"])?;
    write(&work, "README.md", "# with-remote\n")?;
    git(&work, &["add", "README.md"])?;
    git(&work, &["commit", "-m", "initial"])?;

    let status = Command::new("git")
        .args(["init", "--bare", "-b", "main"])
        .arg(&bare)
        .env("GIT_TERMINAL_PROMPT", "0")
        .status()?;
    if !status.success() {
        return Err(TestkitError::Git(format!("bare init failed with {status}")));
    }
    git(&work, &["remote", "add", "origin", bare.to_str().unwrap()])?;
    git(&work, &["push", "-u", "origin", "main"])?;
    Ok(work)
}

fn write(root: &Path, rel: &str, content: &str) -> Result<(), TestkitError> {
    let path = root.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}

fn git(root: &Path, args: &[&str]) -> Result<(), TestkitError> {
    let status = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .status()?;
    if !status.success() {
        return Err(TestkitError::Git(format!(
            "git {args:?} failed with {status}"
        )));
    }
    Ok(())
}

fn git_stdout(root: &Path, args: &[&str]) -> Result<String, TestkitError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()?;
    if !output.status.success() {
        return Err(TestkitError::Git(format!(
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_clean_fixture() {
        let repo = FixtureBuilder::new().build("clean").expect("fixture");
        assert!(repo.path().join("README.md").exists());
        assert!(repo.path().join(".git").exists());
    }

    #[test]
    fn builds_with_remote_fixture() {
        let repo = FixtureBuilder::new().build("with-remote").expect("fixture");
        assert!(repo.path().join("README.md").exists());
        let out = git_stdout(repo.path(), &["remote", "-v"]).expect("remote");
        assert!(out.contains("origin"));
    }
}
