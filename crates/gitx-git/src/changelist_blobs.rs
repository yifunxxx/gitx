//! One refresh uses a fixed HEAD and bounded blob batches. This is deliberately
//! not a content cache: every refresh and every commit still reads fresh bytes.
use crate::{partial_ops::validate_partial_path, GitInvocation, GitRunner};
use gitx_core::{AppError, ErrorCode};
use std::{collections::VecDeque, path::Path};
use tokio_util::sync::CancellationToken;

const CHECK_BATCH: usize = 128;
const CONTENT_BATCH_BYTES: usize = 8 * 1024 * 1024;
pub(crate) type HeadBlob = (String, Result<Option<Vec<u8>>, AppError>);

enum Request {
    Blob {
        path: String,
        oid: String,
        size: usize,
    },
    Fallback(String),
    Ready(HeadBlob),
}

pub(crate) struct ChangelistHeadReader {
    head: String,
    requests: VecDeque<Request>,
}

fn invalid_batch() -> AppError {
    AppError::new(
        ErrorCode::GitCommandFailed,
        "invalid Git blob batch response",
    )
}

fn blob_header(line: &[u8]) -> Option<(String, usize)> {
    let line = std::str::from_utf8(line).ok()?;
    let mut parts = line.split(' ');
    let oid = parts.next()?;
    if !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    if parts.next()? != "blob" {
        return None;
    }
    let size = parts.next()?.parse::<usize>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((oid.to_string(), size))
}

fn parse_contents(
    bytes: &[u8],
    batch: &[(String, String, usize)],
) -> Result<Vec<Vec<u8>>, AppError> {
    let mut rest = bytes;
    let mut blobs = Vec::with_capacity(batch.len());
    for (_, oid, size) in batch {
        let end = rest
            .iter()
            .position(|byte| *byte == b'\n')
            .ok_or_else(invalid_batch)?;
        if blob_header(&rest[..end]).as_ref() != Some(&(oid.clone(), *size)) {
            return Err(invalid_batch());
        }
        rest = &rest[end + 1..];
        if rest.get(*size) != Some(&b'\n') {
            return Err(invalid_batch());
        }
        blobs.push(rest[..*size].to_vec());
        rest = &rest[size + 1..];
    }
    if !rest.is_empty() {
        return Err(invalid_batch());
    }
    Ok(blobs)
}

impl ChangelistHeadReader {
    pub(crate) async fn new(
        runner: &GitRunner,
        cwd: &Path,
        paths: Vec<String>,
        cancel: &CancellationToken,
    ) -> Result<Self, AppError> {
        let head = match runner
            .run(
                GitInvocation::new(cwd, ["rev-parse", "--verify", "HEAD"]),
                cancel,
            )
            .await
        {
            Ok(output) => String::from_utf8(output.stdout)
                .map_err(|_| invalid_batch())?
                .trim()
                .to_string(),
            Err(error) if error.code == ErrorCode::Cancelled => return Err(error),
            Err(error) => {
                // An unborn HEAD is an absent base, but an invalid existing ref
                // or a damaged object must remain a per-file error.
                let unborn = if error.exit_code == Some(128) {
                    match runner.head_is_unborn(cwd, cancel).await {
                        Ok(value) => value,
                        Err(error) if error.code == ErrorCode::Cancelled => return Err(error),
                        Err(_) => false,
                    }
                } else {
                    false
                };
                return Ok(Self {
                    head: "HEAD".into(),
                    requests: paths
                        .into_iter()
                        .map(|path| {
                            if unborn {
                                Request::Ready((path, Ok(None)))
                            } else {
                                Request::Fallback(path)
                            }
                        })
                        .collect(),
                });
            }
        };
        let mut requests = VecDeque::new();
        for chunk in paths.chunks(CHECK_BATCH) {
            let eligible = chunk
                .iter()
                .filter(|path| validate_partial_path(path).is_ok() && !path.contains(['\r', '\n']))
                .collect::<Vec<_>>();
            let input = eligible
                .iter()
                .map(|path| format!("{head}:{path}\n"))
                .collect::<String>();
            let output = if input.is_empty() {
                None
            } else {
                match runner
                    .run(
                        GitInvocation::new(cwd, ["cat-file", "--batch-check"])
                            .stdin(input.into_bytes()),
                        cancel,
                    )
                    .await
                {
                    Ok(output) => Some(output.stdout),
                    Err(error) if error.code == ErrorCode::Cancelled => return Err(error),
                    Err(_) => None,
                }
            };
            let lines = output.as_ref().map(|bytes| {
                bytes
                    .split_inclusive(|byte| *byte == b'\n')
                    .collect::<Vec<_>>()
            });
            let mut lines = lines
                .filter(|lines| lines.len() == eligible.len())
                .map(Vec::into_iter);
            for path in chunk {
                if let Err(error) = validate_partial_path(path) {
                    requests.push_back(Request::Ready((path.clone(), Err(error))));
                    continue;
                }
                if path.contains(['\r', '\n']) {
                    // Git 2.34's line protocol cannot represent these names.
                    requests.push_back(Request::Fallback(path.clone()));
                    continue;
                }
                let header = lines
                    .as_mut()
                    .and_then(Iterator::next)
                    .and_then(|line| line.strip_suffix(b"\n"))
                    .and_then(blob_header);
                requests.push_back(match header {
                    Some((_, size)) if size > gitx_diff::TOO_LARGE_BYTES => Request::Ready((
                        path.clone(),
                        Err(AppError::new(
                            ErrorCode::InvalidArgument,
                            "large files require a whole-file changelist assignment",
                        )),
                    )),
                    Some((oid, size)) => Request::Blob {
                        path: path.clone(),
                        oid,
                        size,
                    },
                    // `missing` does not prove a path is absent. The ordinary
                    // reader checks the tree to distinguish a lost blob.
                    None => Request::Fallback(path.clone()),
                });
            }
        }
        Ok(Self { head, requests })
    }

    pub(crate) async fn next(
        &mut self,
        runner: &GitRunner,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<HeadBlob>, AppError> {
        if cancel.is_cancelled() {
            return Err(AppError::new(ErrorCode::Cancelled, "operation cancelled"));
        }
        let mut batch = Vec::new();
        let mut size = 0;
        while let Some(Request::Blob { size: next, .. }) = self.requests.front() {
            if batch.len() == CHECK_BATCH || size + next > CONTENT_BATCH_BYTES {
                break;
            }
            if let Some(Request::Blob {
                path,
                oid,
                size: bytes,
            }) = self.requests.pop_front()
            {
                size += bytes;
                batch.push((path, oid, bytes));
            }
        }
        if batch.is_empty() {
            return match self.requests.pop_front() {
                None => Ok(Vec::new()),
                Some(Request::Ready(value)) => Ok(vec![value]),
                Some(Request::Fallback(path)) => {
                    let value = runner
                        .read_git_blob(cwd, &self.head, &path, false, cancel)
                        .await;
                    Ok(vec![(path, value)])
                }
                Some(Request::Blob { .. }) => Err(invalid_batch()),
            };
        }
        let input = batch
            .iter()
            .map(|(_, oid, _)| format!("{oid}\n"))
            .collect::<String>();
        let result = runner
            .run(
                GitInvocation::new(cwd, ["cat-file", "--batch"]).stdin(input.into_bytes()),
                cancel,
            )
            .await
            .and_then(|output| parse_contents(&output.stdout, &batch));
        match result {
            Ok(contents) => Ok(batch
                .into_iter()
                .zip(contents)
                .map(|((path, _, _), bytes)| (path, Ok(Some(bytes))))
                .collect()),
            Err(error) if error.code == ErrorCode::Cancelled => Err(error),
            Err(_) => {
                // Corruption or a concurrent GC must not hide the remaining
                // valid files. Retain the original per-file diagnostic path.
                let mut results = Vec::with_capacity(batch.len());
                for (path, _, _) in batch {
                    let value = runner
                        .read_git_blob(cwd, &self.head, &path, false, cancel)
                        .await;
                    if let Err(error) = &value {
                        if error.code == ErrorCode::Cancelled {
                            return Err(error.clone());
                        }
                    }
                    results.push((path, value));
                }
                Ok(results)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn git(cwd: &Path, args: &[&str]) {
        GitRunner::new("git")
            .run(
                GitInvocation::new(cwd, args.iter().copied()),
                &CancellationToken::new(),
            )
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn content_batches_keep_the_captured_head_across_a_concurrent_commit() {
        let repo = gitx_testkit::FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]).await;
        let paths = (0..129)
            .map(|i| format!("file-{i:03}.txt"))
            .collect::<Vec<_>>();
        for path in &paths {
            std::fs::write(cwd.join(path), "old\n").unwrap();
        }
        git(cwd, &["add", "."]).await;
        git(cwd, &["commit", "-m", "old"]).await;
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let mut reader = ChangelistHeadReader::new(&runner, cwd, paths.clone(), &cancel)
            .await
            .unwrap();
        for path in &paths {
            std::fs::write(cwd.join(path), "new\n").unwrap();
        }
        git(cwd, &["add", "."]).await;
        git(cwd, &["commit", "-m", "new"]).await;
        for count in [128, 1] {
            let batch = reader.next(&runner, cwd, &cancel).await.unwrap();
            assert_eq!(batch.len(), count);
            assert!(batch
                .into_iter()
                .all(|(_, value)| value.unwrap().unwrap() == b"old\n"));
        }
        assert!(reader.next(&runner, cwd, &cancel).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn content_batches_bound_bytes_and_honor_cancellation_between_batches() {
        let repo = gitx_testkit::FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        let bytes = vec![b'x'; CONTENT_BATCH_BYTES / 2 + 1];
        for path in ["one", "two"] {
            std::fs::write(cwd.join(path), &bytes).unwrap();
        }
        git(cwd, &["add", "."]).await;
        git(cwd, &["commit", "-m", "large supported blobs"]).await;
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let mut reader =
            ChangelistHeadReader::new(&runner, cwd, vec!["one".into(), "two".into()], &cancel)
                .await
                .unwrap();
        let first = reader.next(&runner, cwd, &cancel).await.unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first.into_iter().next().unwrap().1.unwrap().unwrap(), bytes);
        cancel.cancel();
        assert_eq!(
            reader.next(&runner, cwd, &cancel).await.unwrap_err().code,
            ErrorCode::Cancelled
        );
    }

    #[tokio::test]
    async fn failed_content_batch_keeps_errors_and_valid_neighbours() {
        let repo = gitx_testkit::FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        std::fs::write(cwd.join("lost"), "unique lost\n").unwrap();
        std::fs::write(cwd.join("valid"), "valid\n").unwrap();
        git(cwd, &["add", "."]).await;
        git(cwd, &["commit", "-m", "objects"]).await;
        let runner = GitRunner::new("git");
        let cancel = CancellationToken::new();
        let mut reader =
            ChangelistHeadReader::new(&runner, cwd, vec!["lost".into(), "valid".into()], &cancel)
                .await
                .unwrap();
        let oid = match reader.requests.front().unwrap() {
            Request::Blob { oid, .. } => oid,
            _ => panic!("expected existing blob"),
        };
        std::fs::remove_file(cwd.join(".git/objects").join(&oid[..2]).join(&oid[2..])).unwrap();
        let result = reader.next(&runner, cwd, &cancel).await.unwrap();
        assert_eq!(result.len(), 2);
        assert!(result[0].1.is_err());
        assert_eq!(
            result[1].1.as_ref().unwrap().as_deref().unwrap(),
            b"valid\n"
        );
    }

    #[test]
    fn batch_contents_use_byte_lengths_and_validate_every_header() {
        let oid = "a".repeat(40);
        let content = b"first\n\0fake blob 99\nlast";
        let batch = vec![
            ("one".into(), oid.clone(), content.len()),
            ("two".into(), oid.clone(), 0),
        ];
        let mut bytes = format!("{oid} blob {}\n", content.len()).into_bytes();
        bytes.extend_from_slice(content);
        bytes.extend_from_slice(format!("\n{oid} blob 0\n\n").as_bytes());
        assert_eq!(
            parse_contents(&bytes, &batch).unwrap(),
            vec![content.to_vec(), vec![]]
        );
        assert!(parse_contents(&bytes[..bytes.len() - 1], &batch).is_err());
        let mut extra = bytes.clone();
        extra.push(b'x');
        assert!(parse_contents(&extra, &batch).is_err());
        bytes[0] = b'b';
        assert!(parse_contents(&bytes, &batch).is_err());
        assert!(blob_header(b"HEAD:missing missing").is_none());
        assert!(blob_header(format!("{oid} tree 3").as_bytes()).is_none());
    }
}
