use crate::{GitInvocation, GitRunner};
use gitx_core::{AppError, RewriteHead};
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitRunner {
    pub async fn rewrite_head(
        &self,
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<RewriteHead, AppError> {
        let oid = self.rev_parse_public(cwd, "HEAD", cancel).await?;
        let invocation = GitInvocation::new(cwd, ["symbolic-ref", "--quiet", "HEAD"])
            .git_bin(self.git_bin.clone());
        let symbolic_ref = match self.run(invocation, cancel).await {
            Ok(output) => Some(String::from_utf8_lossy(&output.stdout).trim().to_owned()),
            Err(error) if error.exit_code == Some(1) => None,
            Err(error) => return Err(error),
        };
        Ok(RewriteHead { oid, symbolic_ref })
    }
}
