use crate::{ChangesListMode, CleanTreeMethod, CommitTwMode, LogListMode, SubmoduleUpdatePolicy};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;

pub const SETTINGS_SCHEMA_VERSION: u32 = 4;

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
    /// Add `(cherry picked from commit …)` when source is on a protected remote branch.
    #[serde(default = "default_true")]
    pub cherry_pick_suffix_protected: bool,
    /// Clean working tree using Stash or Shelve (#114).
    #[serde(default)]
    pub clean_tree_method: CleanTreeMethod,
    /// Combine Stashes & Shelves into one Git TW tab (#113).
    #[serde(default = "default_true")]
    pub combine_stashes_and_shelves: bool,
    /// Allow putting changes within one file into different changelists (#52).
    #[serde(default = "default_true")]
    pub allow_per_hunk_changelists: bool,
    /// Execute branch ops (checkout/new/delete/…) on all workspace roots (#33).
    #[serde(default = "default_true")]
    pub execute_branch_ops_on_all_roots: bool,
    /// Update submodules after Update Project (#81).
    #[serde(default)]
    pub update_submodules: SubmoduleUpdatePolicy,
    /// Remote name treated as fork parent for Sync Fork (#17). Default `upstream`.
    #[serde(default = "default_fork_parent")]
    pub fork_parent_remote: String,
    /// Commit TW presentation (#69).
    #[serde(default)]
    pub commit_tw_mode: CommitTwMode,
    /// Hide Commit TW message area until Ctrl+K (#69).
    #[serde(default)]
    pub commit_controls_hidden: bool,
    /// Close Commit TW after successful commit (#69 Advanced).
    #[serde(default)]
    pub close_commit_tw_after_commit: bool,
    /// Log list: chronological flat or branch-oriented tree.
    #[serde(default)]
    pub log_list_mode: LogListMode,
    /// Commit TW Changes list: directory tree or flat paths.
    #[serde(default)]
    pub changes_list_mode: ChangesListMode,
}

fn default_fork_parent() -> String {
    "upstream".into()
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
            cherry_pick_suffix_protected: true,
            clean_tree_method: CleanTreeMethod::Stash,
            combine_stashes_and_shelves: true,
            allow_per_hunk_changelists: true,
            execute_branch_ops_on_all_roots: true,
            update_submodules: SubmoduleUpdatePolicy::Auto,
            fork_parent_remote: default_fork_parent(),
            commit_tw_mode: CommitTwMode::Docked,
            commit_controls_hidden: false,
            close_commit_tw_after_commit: false,
            log_list_mode: LogListMode::Flat,
            changes_list_mode: ChangesListMode::Tree,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u32,
    pub appearance: AppearanceSettings,
    #[serde(default = "default_locale")]
    pub locale: String,
    pub git_executable: Option<String>,
    /// Recent workspace roots (newest first), max 20.
    #[serde(default)]
    pub recent_workspaces: Vec<String>,
    /// M6 default: IDEA Changelist mode (`false`). Staging mode when `true`.
    #[serde(default = "default_staging_mode")]
    pub staging_mode: bool,
    /// Show Ignored Files node in Commit TW (#49).
    #[serde(default)]
    pub show_ignored_files: bool,
    /// Enable SQLite Log indexing (#103). Default on.
    #[serde(default = "default_log_indexing")]
    pub log_indexing: bool,
    #[serde(default)]
    pub git: GitSettings,
    /// Per-action shortcut overrides (platform-agnostic chord strings like `mod+,`).
    #[serde(default)]
    pub keymap_overrides: HashMap<String, Vec<String>>,
}

fn default_staging_mode() -> bool {
    // After M6: Changelist mode is the default (IDEA-aligned).
    false
}

fn default_log_indexing() -> bool {
    true
}

fn default_locale() -> String {
    "en".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            appearance: AppearanceSettings::default(),
            locale: default_locale(),
            git_executable: None,
            recent_workspaces: Vec::new(),
            staging_mode: false,
            show_ignored_files: false,
            log_indexing: true,
            git: GitSettings::default(),
            keymap_overrides: HashMap::new(),
        }
    }
}
