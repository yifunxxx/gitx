//! Git CLI runner, repo scheduler, progress/stderr helpers.

#![allow(clippy::result_large_err)]

mod detect;
mod jobs;
mod progress;
mod runner;
mod scheduler;
mod stderr;

pub use detect::{detect_git, GitDetectResult, MIN_GIT_VERSION};
pub use jobs::{JobEvent, JobManager, JobProgress, JobState};
pub use progress::ProgressParser;
pub use runner::{GitInvocation, GitOutput, GitRunner, OpKind};
pub use scheduler::RepoScheduler;
pub use stderr::StderrClassifier;
