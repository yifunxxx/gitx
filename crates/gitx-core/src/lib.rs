//! Domain types, error model, and settings schema shared across gitx crates.

mod error;
mod ids;
mod settings;
mod vcs;

pub use error::{AppError, ErrorCode, RecoverAction};
pub use ids::{JobHandle, JobId, JobInfo, JobKind, RepoId};
pub use settings::{
    AppSettings, AppearanceSettings, FetchTagsPolicy, GitSettings, IncomingCheckPolicy,
    UpdateMethod, SETTINGS_SCHEMA_VERSION,
};
pub use vcs::*;
