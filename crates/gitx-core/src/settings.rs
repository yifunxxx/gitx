use serde::{Deserialize, Serialize};
use specta::Type;

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub theme: String,
    pub palette: String,
    pub corner_style: String,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            palette: "pearl".into(),
            corner_style: "small".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u32,
    pub appearance: AppearanceSettings,
    pub locale: String,
    pub git_executable: Option<String>,
    /// Recent workspace roots (newest first), max 20.
    #[serde(default)]
    pub recent_workspaces: Vec<String>,
    /// M1 ships staging mode first (changelist mode lands in M6).
    #[serde(default = "default_staging_mode")]
    pub staging_mode: bool,
    /// Enable SQLite Log indexing (#103). Default on.
    #[serde(default = "default_log_indexing")]
    pub log_indexing: bool,
}

fn default_staging_mode() -> bool {
    true
}

fn default_log_indexing() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            appearance: AppearanceSettings::default(),
            locale: "en".into(),
            git_executable: None,
            recent_workspaces: Vec::new(),
            staging_mode: true,
            log_indexing: true,
        }
    }
}
