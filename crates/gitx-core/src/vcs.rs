//! Shared VCS domain types used across IPC and crates.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum FileChangeKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    Typechange,
    Unmerged,
    Untracked,
    Ignored,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub orig_path: Option<String>,
    /// Single-letter index status from porcelain v2 (`M`, `A`, `.`, …).
    pub index_status: String,
    /// Single-letter worktree status from porcelain v2.
    pub worktree_status: String,
    pub kind: FileChangeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub head: String,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub detached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    pub repo_id: String,
    pub version: u64,
    pub branch: BranchInfo,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DiffSide {
    Head,
    Index,
    Worktree,
}

/// Whitespace ignore mode for Diff (#97).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum IgnoreWhitespace {
    #[default]
    None,
    Trim,
    All,
    AllAndEmptyLines,
}

/// Log commit order (#102 Graph Options).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum LogOrder {
    #[default]
    Date,
    Topo,
}

/// Filters for `log_query` (M3).
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogFilters {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub match_case: bool,
    /// Author substrings (OR). Empty = no author filter.
    #[serde(default)]
    pub authors: Vec<String>,
    /// Git date string (`2024-01-01`, `7.days`, …).
    #[serde(default)]
    pub since: Option<String>,
    #[serde(default)]
    pub until: Option<String>,
    #[serde(default)]
    pub paths: Vec<String>,
    /// Tips or ranges (`main`, `main..feature`, `a...b`).
    #[serde(default)]
    pub revisions: Vec<String>,
    #[serde(default)]
    pub first_parent: bool,
    #[serde(default)]
    pub no_merges: bool,
    #[serde(default)]
    pub order: LogOrder,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line: u32,
    pub sha: String,
    pub author: String,
    pub author_time: i64,
    pub summary: String,
    pub original_path: Option<String>,
    pub not_committed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BlameResult {
    pub path: String,
    pub rev: String,
    pub lines: Vec<BlameLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCommit {
    pub sha: String,
    pub short_sha: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub author: String,
    pub author_email: String,
    pub author_time: i64,
    /// Path as seen in this commit (rename follow).
    pub path_at_commit: String,
    pub status: Option<String>,
    pub orig_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub commits: Vec<HistoryCommit>,
    pub truncated: bool,
    pub next_offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub mode: String,
    pub size: Option<u64>,
    pub sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BlobContent {
    pub path: String,
    pub rev: String,
    pub text: Option<String>,
    pub binary: bool,
    pub too_large: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub enabled: bool,
    pub ready: bool,
    pub progress: f32,
    pub commit_count: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffLineRange {
    pub start: u32,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub index: u32,
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// Unified hunk body lines including leading ` `, `+`, `-`.
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileResult {
    pub path: String,
    pub left_label: String,
    pub right_label: String,
    pub left_text: Option<String>,
    pub right_text: Option<String>,
    pub binary: bool,
    pub too_large: bool,
    pub hunks: Vec<DiffHunk>,
    pub encoding: String,
    /// True when left/right texts use different end-of-line styles (LF vs CRLF).
    /// Diff compare normalizes EOL so identical visible lines stay uncolored;
    /// the UI surfaces this flag instead of painting whole blocks red/green.
    #[serde(default)]
    pub eol_mismatch: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffRefsResult {
    pub left: String,
    pub right: String,
    pub files: Vec<ChangedFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CombinedDiffFile {
    pub path: String,
    pub status: String,
    pub orig_path: Option<String>,
    pub hunks: Vec<DiffHunk>,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CombinedDiffResult {
    pub left: String,
    pub right: String,
    pub files: Vec<CombinedDiffFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub from_lane: u32,
    pub to_lane: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GraphRow {
    pub lane: u32,
    pub edges: Vec<GraphEdge>,
    pub color: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogCommit {
    pub sha: String,
    pub short_sha: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub author: String,
    pub author_email: String,
    pub author_time: i64,
    pub refs: Vec<String>,
    pub graph: GraphRow,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub commits: Vec<LogCommit>,
    pub truncated: bool,
    pub next_offset: u32,
}

/// Position in the same filtered, ordered history used by `log_query`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogLocation {
    pub sha: String,
    /// None means the commit exists but is outside the displayed history.
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub author_email: String,
    pub author_time: i64,
    pub committer: String,
    pub committer_email: String,
    pub committer_time: i64,
    pub subject: String,
    pub body: String,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
    pub orig_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub sha: String,
    pub subject: String,
    pub amended: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RefKind {
    LocalBranch,
    RemoteBranch,
    Tag,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RefEntry {
    pub name: String,
    pub full_name: String,
    pub kind: RefKind,
    pub sha: String,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub is_head: bool,
    pub subject: Option<String>,
    pub committer_time: Option<i64>,
    /// Peeled object for annotated tags.
    pub peeled_sha: Option<String>,
    pub is_favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RefsList {
    pub local: Vec<RefEntry>,
    pub remote: Vec<RefEntry>,
    pub tags: Vec<RefEntry>,
    pub recent: Vec<String>,
    pub current: Option<String>,
    pub detached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub fetch_url: String,
    pub push_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FetchSummary {
    pub remote: String,
    pub new_branches: u32,
    pub updated_branches: u32,
    pub new_tags: u32,
    pub pruned: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    pub old_head: String,
    pub new_head: String,
    pub strategy: String,
    pub updated: bool,
    pub updated_files: Vec<ChangedFile>,
    pub commits: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PushRefspec {
    pub local: String,
    pub remote: String,
    pub remote_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PushPreview {
    pub remote: String,
    pub refs: Vec<PushRefspec>,
    pub commits: Vec<String>,
    pub commits_truncated: bool,
    pub set_upstream: bool,
    pub has_remote: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PushOutcome {
    Success,
    UpToDate,
    Rejected,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub outcome: PushOutcome,
    pub remote: String,
    pub message: String,
    pub rejected: bool,
    pub set_upstream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub old_head: String,
    pub new_head: String,
    pub strategy: String,
    pub updated_files: Vec<ChangedFile>,
    pub commits: Vec<String>,
    pub message: String,
    #[serde(default)]
    pub submodules: Option<SubmoduleUpdateResult>,
    /// The superproject may already be updated when module discovery fails.
    #[serde(default)]
    pub submodule_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CloneResult {
    pub path: String,
    pub shallow: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IncomingCheck {
    pub has_unfetched: bool,
    pub remotes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CompareRange {
    pub left: String,
    pub right: String,
    pub left_only: Vec<String>,
    pub right_only: Vec<String>,
}

// --- M4: merge / rebase / cherry-pick / conflicts ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RepoOpKind {
    Normal,
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RepoOpPhase {
    Normal,
    InProgress,
    Conflicted,
    ReadyToContinue,
    StoppedForEdit,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoOpState {
    pub kind: RepoOpKind,
    pub phase: RepoOpPhase,
    pub step: Option<u32>,
    pub total: Option<u32>,
    pub conflict_count: u32,
    pub yours_label: String,
    pub theirs_label: String,
    pub summary: String,
    pub head_branch: Option<String>,
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RewriteOutcome {
    Success,
    AlreadyUpToDate,
    FastForward,
    Conflicts,
    NothingToCommit,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RewriteHead {
    pub oid: String,
    /// Full symbolic reference, or None for a detached HEAD.
    pub symbolic_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RewriteResult {
    pub old_head: String,
    pub new_head: String,
    pub outcome: RewriteOutcome,
    pub message: String,
    pub conflict_files: Vec<String>,
    pub backup_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_head: Option<RewriteHead>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ConflictKind {
    Content,
    DeleteModify,
    AddAdd,
    Rename,
    Binary,
    Submodule,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ConflictSideStatus {
    Modified,
    Deleted,
    Added,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictEntry {
    pub path: String,
    pub kind: ConflictKind,
    pub yours: ConflictSideStatus,
    pub theirs: ConflictSideStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictsList {
    pub entries: Vec<ConflictEntry>,
    pub yours_label: String,
    pub theirs_label: String,
    pub title: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ConflictSide {
    Ours,
    Theirs,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictVersions {
    pub path: String,
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub is_binary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Merge3BlockKind {
    Equal,
    OnlyOurs,
    OnlyTheirs,
    BothSame,
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Merge3Block {
    pub kind: Merge3BlockKind,
    /// Complete line tokens, retaining CR/LF and whether the last line has a terminator.
    /// Concatenate these arrays without inserting separators to reconstruct each side.
    pub base_lines: Vec<String>,
    pub ours_lines: Vec<String>,
    pub theirs_lines: Vec<String>,
    /// Suggested merge for non-conflicting / simple blocks.
    pub result_lines: Vec<String>,
    pub is_simple: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Merge3Result {
    pub blocks: Vec<Merge3Block>,
    pub conflict_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DirtyWorktreeInfo {
    pub files: Vec<String>,
    pub operation: String,
}

// --- M5: rewrite history / interactive rebase / reset / undo ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RebaseTodoAction {
    Pick,
    Reword,
    Edit,
    Squash,
    Fixup,
    Drop,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RebaseTodoItem {
    pub action: RebaseTodoAction,
    pub sha: String,
    pub subject: String,
    /// Full message used for reword / squash combined message.
    pub message: Option<String>,
    pub author: String,
    pub author_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlan {
    /// Exclusive base (parent of first commit); empty string means `--root`.
    pub base: String,
    pub onto: Option<String>,
    pub items: Vec<RebaseTodoItem>,
    pub rebase_merges: bool,
    pub autosquash: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
    Keep,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResetPreview {
    pub target: String,
    pub commits_affected: u32,
    pub dirty_tracked: Vec<String>,
    pub will_discard_local: bool,
}

// ─── M6: Changelists / Stash / Shelf / Patch / Ignore ───────────────────────

/// Content-anchor for per-hunk changelist assignment (#52).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HunkAnchor {
    pub before: Vec<String>,
    pub after: Vec<String>,
    pub change_hash: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PathAssignment {
    pub path: String,
    pub list_id: String,
    /// Empty = whole file belongs to list_id.
    #[serde(default)]
    pub hunk_ranges: Vec<HunkAnchor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangelistInfo {
    pub id: String,
    pub name: String,
    pub comment: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangelistsState {
    pub lists: Vec<ChangelistInfo>,
    pub assignments: Vec<PathAssignment>,
}

impl Default for ChangelistsState {
    fn default() -> Self {
        Self {
            lists: vec![ChangelistInfo {
                id: "default".into(),
                name: "Changes".into(),
                comment: String::new(),
                active: true,
            }],
            assignments: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: u32,
    pub sha: String,
    pub message: String,
    pub branch: Option<String>,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShelfEntry {
    pub id: String,
    pub message: String,
    pub created_at: i64,
    pub base_sha: String,
    pub paths: Vec<String>,
    pub source_changelist: Option<String>,
    pub binary: bool,
    pub system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PatchCreateResult {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreAddResult {
    pub ignore_file: String,
    pub patterns: Vec<String>,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PartialFileSelection {
    pub path: String,
    /// 1-based new-side line numbers to include from worktree vs base.
    pub selected_lines: Vec<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub enum CleanTreeMethod {
    #[default]
    Stash,
    Shelve,
}

/// Commit tool window presentation (#69). Modal is deferred (#139).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub enum CommitTwMode {
    #[default]
    Docked,
    Window,
    Float,
}

/// Submodule update policy after Update Project (#81).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub enum SubmoduleUpdatePolicy {
    #[default]
    Auto,
    Always,
    Never,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub bare: bool,
    pub detached: bool,
    pub locked: bool,
    pub lock_reason: Option<String>,
    pub prunable: bool,
    pub prune_reason: Option<String>,
    /// First entry from `git worktree list` (main worktree).
    pub is_main: bool,
    /// Matches the currently open repo path.
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreePrunePreview {
    pub paths: Vec<String>,
    pub dry_run_output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoRoot {
    pub id: String,
    pub worktree_root: String,
    pub git_dir: String,
    pub common_dir: String,
    pub is_worktree: bool,
    pub display_name: String,
    pub color: String,
    /// True when discovered from `.gitmodules` (read-only root; register deferred #11).
    pub is_submodule: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MultiRootOpStep {
    pub repo_id: String,
    pub path: String,
    pub ok: bool,
    pub previous_ref: Option<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub skipped: bool,
    #[serde(default)]
    pub previous_head: Option<RewriteHead>,
    #[serde(default)]
    pub checkout_head: Option<RewriteHead>,
    #[serde(default)]
    pub rolled_back: bool,
    #[serde(default)]
    pub rollback_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MultiRootOpResult {
    pub ok: bool,
    pub steps: Vec<MultiRootOpStep>,
    pub rolled_back: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncForkResult {
    pub default_branch: String,
    pub upstream_ref: String,
    pub old_head: String,
    pub new_head: String,
    pub strategy: String,
    pub pushed: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleUpdateItem {
    pub path: String,
    pub old_sha: Option<String>,
    pub new_sha: Option<String>,
    pub on_branch: Option<String>,
    pub updated: bool,
    pub skipped: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleUpdateResult {
    pub items: Vec<SubmoduleUpdateItem>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WslPathInfo {
    pub distro: String,
    pub linux_path: String,
    pub suggested_git: String,
}
