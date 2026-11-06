//! Git CLI runner, repo scheduler, progress/stderr helpers.

#![allow(clippy::result_large_err)]

mod clone_ops;
mod detect;
mod jobs;
mod ops;
mod progress;
mod refs_ops;
mod remote_ops;
mod runner;
mod scheduler;
mod status;
mod stderr;
mod sync_ops;

pub use detect::{detect_git, GitDetectResult, MIN_GIT_VERSION};
pub use jobs::{JobEvent, JobManager, JobProgress, JobState};
pub use ops::RawLogCommit;
pub use progress::ProgressParser;
pub use runner::{GitInvocation, GitOutput, GitRunner, OpKind};
pub use scheduler::RepoScheduler;
pub use status::parse_status_porcelain_v2;
pub use stderr::StderrClassifier;
