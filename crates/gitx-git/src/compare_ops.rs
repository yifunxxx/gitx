use crate::GitRunner;
use gitx_core::{AppError, CombinedDiffFile, CombinedDiffResult, IgnoreWhitespace};
use gitx_diff::{compute_hunks, decode_lossy, is_probably_binary, too_large, DiffComputeOptions};
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitRunner {
    /// Build the display-only combined diff from base to destination.
    pub async fn combined_diff(
        &self,
        cwd: &Path,
        destination: &str,
        base: &str,
        ignore_whitespace: IgnoreWhitespace,
        limit: u32,
        cancel: &CancellationToken,
    ) -> Result<CombinedDiffResult, AppError> {
        let files = self
            .diff_refs_name_status(cwd, base, destination, cancel)
            .await?;
        let limit = limit.clamp(1, 200) as usize;
        let mut out_files = Vec::new();
        for f in files.into_iter().take(limit) {
            let left_path = f.orig_path.as_deref().unwrap_or(&f.path);
            let left_bytes = self
                .read_diff_blob_at(cwd, base, left_path, cancel)
                .await
                .map_err(|error| file_read_error(error, base, left_path))?;
            let right_bytes = self
                .read_diff_blob_at(cwd, destination, &f.path, cancel)
                .await
                .map_err(|error| file_read_error(error, destination, &f.path))?;
            let binary = left_bytes.as_ref().is_some_and(|b| is_probably_binary(b))
                || right_bytes.as_ref().is_some_and(|b| is_probably_binary(b));
            let hunks = if binary
                || too_large(left_bytes.as_deref())
                || too_large(right_bytes.as_deref())
            {
                Vec::new()
            } else {
                compute_hunks(
                    decode_lossy(left_bytes.as_deref()).as_deref(),
                    decode_lossy(right_bytes.as_deref()).as_deref(),
                    &DiffComputeOptions { ignore_whitespace },
                )
            };
            out_files.push(CombinedDiffFile {
                path: f.path,
                status: f.status,
                orig_path: f.orig_path,
                hunks,
                binary,
            });
        }

        Ok(CombinedDiffResult {
            left: destination.to_owned(),
            right: base.to_owned(),
            files: out_files,
        })
    }
}

fn file_read_error(mut error: AppError, revision: &str, path: &str) -> AppError {
    error.message = format!("Could not read {path} ({revision}): {}", error.message);
    error
}
