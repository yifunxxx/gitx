//! Domain types, error model, and settings schema shared across gitx crates.

mod error;
mod ids;
mod settings;

pub use error::{AppError, ErrorCode, RecoverAction};
pub use ids::{JobHandle, JobId, JobInfo, JobKind, RepoId};
pub use settings::{AppSettings, AppearanceSettings, SETTINGS_SCHEMA_VERSION};
