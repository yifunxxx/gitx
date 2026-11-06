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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum UpdateMethod {
    Merge,
    Rebase,
    Reset,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub enum FetchTagsPolicy {
    #[default]
    Auto,
    SyncAndPrune,
    Always,
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub enum IncomingCheckPolicy {
    #[default]
    Auto,
    Always,
    Never,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitSettings {
    #[serde(default = "default_update_method")]
    pub update_method: UpdateMethod,
    #[serde(default)]
    pub fetch_tags: FetchTagsPolicy,
    /// 0 = disabled. IDEA default is off.
    #[serde(default)]
    pub auto_fetch_minutes: u32,
    #[serde(default)]
    pub check_incoming: IncomingCheckPolicy,
    #[serde(default = "default_true")]
    pub show_update_info: bool,
    #[serde(default = "default_true")]
    pub show_options_before_update: bool,
    #[serde(default = "default_true")]
    pub fetch_on_add_remote: bool,
    /// Glob patterns; force-with-lease / force push refused when matching.
    #[serde(default = "default_protected")]
    pub protected_branches: Vec<String>,
    #[serde(default = "default_true")]
    pub use_credential_helper: bool,
    #[serde(default = "default_true")]
    pub group_branches_by_directory: bool,
    #[serde(default = "default_true")]
    pub show_recent_branches: bool,
    #[serde(default = "default_true")]
    pub show_tags: bool,
}

fn default_update_method() -> UpdateMethod {
    UpdateMethod::Merge
}

fn default_true() -> bool {
    true
}

fn default_protected() -> Vec<String> {
    vec!["main".into(), "master".into()]
}

impl Default for GitSettings {
    fn default() -> Self {
        Self {
            update_method: UpdateMethod::Merge,
            fetch_tags: FetchTagsPolicy::Auto,
            auto_fetch_minutes: 0,
            check_incoming: IncomingCheckPolicy::Auto,
            show_update_info: true,
            show_options_before_update: true,
            fetch_on_add_remote: true,
            protected_branches: default_protected(),
            use_credential_helper: true,
            group_branches_by_directory: true,
            show_recent_branches: true,
            show_tags: true,
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
    #[serde(default)]
    pub git: GitSettings,
}

fn default_staging_mode() -> bool {
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
            git: GitSettings::default(),
        }
    }
}
