//! Git CLI runner, repo scheduler, progress/stderr helpers.

#![allow(clippy::result_large_err)]

mod clone_ops;
mod conflict_ops;
mod detect;
mod head_state;
mod history_rewrite_ops;
mod ignore_ops;
mod jobs;
mod multi_root_checkout;
mod multi_root_ops;
mod ops;
mod partial_ops;
mod patch_ops;
mod paths;
mod process_win;
mod progress;
mod refs_ops;
mod remote_ops;
mod rewrite_ops;
mod runner;
mod scheduler;
mod shelf_export;
mod shelf_ops;
mod smart_ops;
mod stash_ops;
mod status;
mod stderr;
mod sync_ops;
mod update_local_changes;
mod worktree_ops;

pub use detect::{
    detect_git, ensure_windows_git_path, parse_wsl_unc_path, resolve_git_bin_for_path,
    wsl_translate_path, GitDetectResult, MIN_GIT_VERSION,
};
pub use jobs::{JobEvent, JobManager, JobProgress, JobState};
pub use ops::RawLogCommit;
pub use progress::ProgressParser;
pub use runner::{helper_bin, GitInvocation, GitOutput, GitRunner, OpKind};
pub use scheduler::RepoScheduler;
pub use status::parse_status_porcelain_v2;
pub use stderr::StderrClassifier;

pub use paths::resolve_git_path;
