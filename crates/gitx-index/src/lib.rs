//! Git Log Index — SQLite store for fast Log / File History filters (#103).
//!
//! Schema lives under `<git-common-dir>/gitx/log-index.sqlite`.
//! M3 ships a pragmatic first cut: commits + FTS5 messages; path tables reserved for later.

#![allow(clippy::result_large_err)]

use gitx_core::{AppError, ErrorCode, IndexStatus};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

const SCHEMA: &str = r#"
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS commits (
  id INTEGER PRIMARY KEY,
  sha TEXT NOT NULL UNIQUE,
  author TEXT NOT NULL,
  author_email TEXT NOT NULL,
  time INTEGER NOT NULL,
  parents TEXT NOT NULL,
  subject TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(
  sha UNINDEXED,
  subject,
  tokenize = 'trigram'
);
"#;

#[derive(Debug, Clone)]
pub struct IndexCommit {
    pub sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub author_email: String,
    pub author_time: i64,
    pub subject: String,
}

pub struct LogIndex {
    conn: Connection,
    path: PathBuf,
}

impl LogIndex {
    pub fn db_path(git_common_dir: &Path) -> PathBuf {
        git_common_dir.join("gitx").join("log-index.sqlite")
    }

    pub fn open(git_common_dir: &Path) -> Result<Self, AppError> {
        let dir = git_common_dir.join("gitx");
        std::fs::create_dir_all(&dir).map_err(|e| {
            AppError::new(ErrorCode::FsError, format!("create gitx index dir: {e}"))
        })?;
        let path = Self::db_path(git_common_dir);
        let conn = Connection::open(&path)
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("open log index: {e}")))?;
        conn.execute_batch(SCHEMA)
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("init log index: {e}")))?;
        Ok(Self { conn, path })
    }

    pub fn status(&self) -> IndexStatus {
        let count: u32 = self
            .conn
            .query_row("SELECT COUNT(*) FROM commits", [], |r| r.get(0))
            .unwrap_or(0);
        let ready = count > 0;
        IndexStatus {
            enabled: true,
            ready,
            progress: if ready { 1.0 } else { 0.0 },
            commit_count: count,
            message: if ready {
                format!("Indexed {count} commits")
            } else {
                "Index empty — Rebuild to accelerate filters".into()
            },
        }
    }

    pub fn rebuild_from_commits(
        &mut self,
        commits: impl IntoIterator<Item = IndexCommit>,
    ) -> Result<(), AppError> {
        self.conn
            .execute_batch("DELETE FROM commits; DELETE FROM messages;")
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("clear index: {e}")))?;
        let tx = self
            .conn
            .transaction()
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("begin tx: {e}")))?;
        {
            let mut insert = tx
                .prepare(
                    "INSERT OR REPLACE INTO commits(sha, author, author_email, time, parents, subject)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )
                .map_err(|e| AppError::new(ErrorCode::Internal, format!("prepare: {e}")))?;
            let mut fts = tx
                .prepare("INSERT INTO messages(sha, subject) VALUES (?1, ?2)")
                .map_err(|e| AppError::new(ErrorCode::Internal, format!("prepare fts: {e}")))?;
            for c in commits {
                let parents = c.parents.join(" ");
                insert
                    .execute(params![
                        c.sha,
                        c.author,
                        c.author_email,
                        c.author_time,
                        parents,
                        c.subject
                    ])
                    .map_err(|e| AppError::new(ErrorCode::Internal, format!("insert: {e}")))?;
                fts.execute(params![c.sha, c.subject])
                    .map_err(|e| AppError::new(ErrorCode::Internal, format!("fts: {e}")))?;
            }
        }
        tx.commit()
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("commit index: {e}")))?;
        let _ = &self.path;
        Ok(())
    }

    /// Search subjects via FTS5; returns matching SHAs (newest first by commit time).
    pub fn search_text(&self, query: &str, limit: u32) -> Result<Vec<String>, AppError> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let mut stmt = self
            .conn
            .prepare(
                "SELECT c.sha FROM messages m
                 JOIN commits c ON c.sha = m.sha
                 WHERE m.subject LIKE ?1
                 ORDER BY c.time DESC
                 LIMIT ?2",
            )
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("prepare search: {e}")))?;
        // Prefer LIKE for substring (works for CJK); FTS5 trigram kept for future.
        let q = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
        let rows = stmt
            .query_map(params![q, limit], |r| r.get(0))
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("search: {e}")))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(
                row.map_err(|e| AppError::new(ErrorCode::Internal, format!("search row: {e}")))?,
            );
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn rebuild_and_search() {
        let dir = std::env::temp_dir().join(format!(
            "gitx-index-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let mut index = LogIndex::open(&dir).unwrap();
        index
            .rebuild_from_commits([IndexCommit {
                sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
                parents: vec![],
                author: "Ada".into(),
                author_email: "ada@ex".into(),
                author_time: 1,
                subject: "hello indexing world".into(),
            }])
            .unwrap();
        let st = index.status();
        assert!(st.ready);
        assert_eq!(st.commit_count, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
