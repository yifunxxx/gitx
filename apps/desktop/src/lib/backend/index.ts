import type {
  AppInfo,
  AppSettings,
  BlameReq,
  BlameResult,
  BlobContent,
  BlobReadReq,
  BranchCheckoutReq,
  BranchCreateReq,
  BranchDeleteReq,
  BranchDeleteRes,
  BranchRenameReq,
  BranchRestoreReq,
  BranchUpdateReq,
  ChangedFile,
  CheckoutPathReq,
  CloneCheckUrlReq,
  CloneResult,
  CloneRunReq,
  CredentialSessionReq,
  CredentialSessionRes,
  RemoteDeleteBranchReq,
  CombinedDiffReq,
  CombinedDiffResult,
  CommitCreateReq,
  CommitDetails,
  CommitResult,
  CompareRange,
  CompareReq,
  DiffFileAtReq,
  DiffFileReq,
  DiffFileResult,
  DiffRefsReq,
  DiffRefsResult,
  FavoritesToggleReq,
  FetchRunReq,
  FetchSummary,
  FileHistoryReq,
  GitDetectDto,
  HeadMessageReq,
  HistoryPage,
  HunksReq,
  IncomingCheck,
  IncomingCheckReq,
  IndexRebuildReq,
  IndexStatus,
  IndexStatusReq,
  JobHandle,
  JobInfo,
  ListRefsReq,
  LogChangedFilesReq,
  LogCommitDetailsReq,
  LogPage,
  LogQueryReq,
  LogLocation,
  LogLocateReq,
  PathsReq,
  AddPathsReq,
  PullResult,
  PullRunReq,
  PushPreview,
  PushPreviewReq,
  PushResult,
  PushRunReq,
  RefsList,
  RefsListReq,
  RemoteAddReq,
  RemoteEditReq,
  RemoteInfo,
  RemoteListReq,
  RemoteRemovePreview,
  RemoteRemoveReq,
  RepoStateReq,
  RepoStateRes,
  StatusGetReq,
  StatusProbeReq,
  StatusSnapshot,
  TagCreateReq,
  TagDeleteReq,
  TagDeleteRes,
  TagPushReq,
  TreeEntry,
  TreeListReq,
  UnshallowReq,
  UpdateInfo,
  UpdateProjectReq,
  WorkspaceOpenReq,
  WorkspaceOpenRes,
  WorkspaceRecentRes,
  InitRunReq,
  VcsEnableReq,
  RepoOpState,
  RewriteResult,
  PathReq as RewritePathReq,
  MergeRunReq,
  MergeCommitReq,
  RebaseRunReq,
  CherryPickRunReq,
  ConflictsList,
  ConflictsPathReq,
  ConflictAcceptReq,
  ConflictVersions,
  ConflictFileReq,
  ConflictSaveReq,
  ConflictMarkReq,
  Merge3Result,
  RebasePlan,
  RebasePlanReq,
  RebaseInteractiveStartReq,
  RewordCommitReq,
  SquashCommitsReq,
  DropCommitsReq,
  FixupIntoReq,
  RevertRunReq,
  ResetPreview,
  ResetPreviewReq,
  ResetRunReq,
  UndoRewriteReq,
  PartialChangesReq,
  LinesReq,
  ChangelistPathReq,
  ChangelistCreateReq,
  ChangelistRenameReq,
  ChangelistDeleteReq,
  ChangelistIdReq,
  ChangelistMoveReq,
  ChangelistsState,
  StashPathReq,
  StashCreateReq,
  StashRefReq,
  StashBranchReq,
  StashRestoreReq,
  StashEntry,
  ShelfPathReq,
  ShelfCreateReq,
  ShelfIdReq,
  ShelfUnshelveReq,
  ShelfUnshelveResult,
  ShelfRenameReq,
  ShelfImportReq,
  ShelfExportReq,
  ShelfEntry,
  IgnoreAddReq,
  IgnoreSuggestReq,
  IgnoreAddResult,
  ExcludePathReq,
  RmCachedReq,
  PatchCreateReq,
  PatchApplyReq,
  PatchApplyClipboardReq,
  PatchCreateResult,
  WorktreeListReq,
  WorktreeAddReq,
  WorktreeAddRes,
  WorktreeRemoveReq,
  WorktreeLockReq,
  WorktreePathReq,
  WorktreeOpenRefReq,
  WorktreeDefaultPathReq,
  WorktreeDefaultPathRes,
  WorktreeInfo,
  WorktreePrunePreview,
  DiscoverRootsReq,
  RepoRoot,
  MultiRootCheckoutReq,
  MultiRootRollbackReq,
  MultiRootOpResult,
  UiSyncPayload,
  ParseWslPathReq,
  WslPathInfo,
  SyncForkReq,
  SyncForkResult,
  SubmoduleUpdateReq,
  SubmoduleUpdateResult,
} from "./bindings";
import { commands } from "./bindings";
import { mockBackend } from "./mock";
import { isTauri } from "@/lib/utils";

export type Backend = {
  appInfo(): Promise<AppInfo>;
  gitDetect(): Promise<GitDetectDto>;
  gitTestExecutable(path: string): Promise<GitDetectDto>;
  settingsGet(): Promise<AppSettings>;
  settingsSet(settings: AppSettings): Promise<AppSettings>;
  jobList(): Promise<JobInfo[]>;
  jobCancel(jobId: string): Promise<boolean>;
  workspaceOpen(req: WorkspaceOpenReq): Promise<WorkspaceOpenRes>;
  workspaceWatch(roots: RepoRoot[], generation: number): Promise<null>;
  workspaceUnwatch(generation: number): Promise<null>;
  workspaceRecent(): Promise<WorkspaceRecentRes>;
  statusProbe(req: StatusProbeReq): Promise<JobHandle>;
  initRun(req: InitRunReq): Promise<WorkspaceOpenRes>;
  vcsEnable(req: VcsEnableReq): Promise<WorkspaceOpenRes>;
  statusGet(req: StatusGetReq): Promise<StatusSnapshot>;
  stagePaths(req: PathsReq): Promise<null>;
  unstagePaths(req: PathsReq): Promise<null>;
  addPaths(req: AddPathsReq): Promise<null>;
  stageHunks(req: HunksReq): Promise<null>;
  unstageHunks(req: HunksReq): Promise<null>;
  diffFile(req: DiffFileReq): Promise<DiffFileResult>;
  diffFileAt(req: DiffFileAtReq): Promise<DiffFileResult>;
  diffRefs(req: DiffRefsReq): Promise<DiffRefsResult>;
  diffCombined(req: CombinedDiffReq): Promise<CombinedDiffResult>;
  commitCreate(req: CommitCreateReq): Promise<CommitResult>;
  commitHeadMessage(req: HeadMessageReq): Promise<string>;
  logQuery(req: LogQueryReq): Promise<LogPage>;
  logLocate(req: LogLocateReq): Promise<LogLocation>;
  logCommitDetails(req: LogCommitDetailsReq): Promise<CommitDetails>;
  logChangedFiles(req: LogChangedFilesReq): Promise<ChangedFile[]>;
  // M3
  fileHistory(req: FileHistoryReq): Promise<HistoryPage>;
  blameFile(req: BlameReq): Promise<BlameResult>;
  treeList(req: TreeListReq): Promise<TreeEntry[]>;
  blobRead(req: BlobReadReq): Promise<BlobContent>;
  checkoutPathFromRev(req: CheckoutPathReq): Promise<null>;
  listRefs(req: ListRefsReq): Promise<string[]>;
  logIndexStatus(req: IndexStatusReq): Promise<IndexStatus>;
  logIndexRebuild(req: IndexRebuildReq): Promise<IndexStatus>;
  // M2
  refsList(req: RefsListReq): Promise<RefsList>;
  favoritesToggle(req: FavoritesToggleReq): Promise<null>;
  branchCreate(req: BranchCreateReq): Promise<null>;
  branchCheckout(req: BranchCheckoutReq): Promise<null>;
  branchRename(req: BranchRenameReq): Promise<null>;
  branchDelete(req: BranchDeleteReq): Promise<BranchDeleteRes>;
  branchRestore(req: BranchRestoreReq): Promise<null>;
  branchUpdate(req: BranchUpdateReq): Promise<null>;
  compareBranches(req: CompareReq): Promise<CompareRange>;
  tagCreate(req: TagCreateReq): Promise<null>;
  tagDelete(req: TagDeleteReq): Promise<TagDeleteRes>;
  tagPush(req: TagPushReq): Promise<null>;
  remoteList(req: RemoteListReq): Promise<RemoteInfo[]>;
  remoteAdd(req: RemoteAddReq): Promise<null>;
  remoteEdit(req: RemoteEditReq): Promise<null>;
  remoteRemovePreview(req: RemoteRemoveReq): Promise<RemoteRemovePreview>;
  remoteRemove(req: RemoteRemoveReq): Promise<null>;
  remoteDeleteBranch(req: RemoteDeleteBranchReq): Promise<null>;
  fetchRun(req: FetchRunReq): Promise<FetchSummary>;
  pullRun(req: PullRunReq): Promise<PullResult>;
  updateProjectRun(req: UpdateProjectReq): Promise<UpdateInfo>;
  pushPreview(req: PushPreviewReq): Promise<PushPreview>;
  pushRun(req: PushRunReq): Promise<PushResult>;
  lsRemoteCheck(req: IncomingCheckReq): Promise<IncomingCheck>;
  cloneCheckUrl(req: CloneCheckUrlReq): Promise<boolean>;
  cloneRun(req: CloneRunReq): Promise<CloneResult>;
  unshallowRun(req: UnshallowReq): Promise<null>;
  repoStateGet(req: RepoStateReq): Promise<RepoStateRes>;
  // M4
  repoOpStateGet(req: RewritePathReq): Promise<RepoOpState>;
  mergeRun(req: MergeRunReq): Promise<RewriteResult>;
  mergeAbort(req: RewritePathReq): Promise<RewriteResult>;
  mergeCommit(req: MergeCommitReq): Promise<RewriteResult>;
  rebaseRun(req: RebaseRunReq): Promise<RewriteResult>;
  rebaseContinue(req: RewritePathReq): Promise<RewriteResult>;
  rebaseSkip(req: RewritePathReq): Promise<RewriteResult>;
  rebaseAbort(req: RewritePathReq): Promise<RewriteResult>;
  cherryPickRun(req: CherryPickRunReq): Promise<RewriteResult>;
  cherryPickContinue(req: RewritePathReq): Promise<RewriteResult>;
  cherryPickSkip(req: RewritePathReq): Promise<RewriteResult>;
  cherryPickAbort(req: RewritePathReq): Promise<RewriteResult>;
  conflictsList(req: ConflictsPathReq): Promise<ConflictsList>;
  conflictAcceptSide(req: ConflictAcceptReq): Promise<null>;
  conflictVersions(req: ConflictFileReq): Promise<ConflictVersions>;
  conflictMerge3(req: ConflictFileReq): Promise<Merge3Result>;
  conflictSaveResult(req: ConflictSaveReq): Promise<null>;
  conflictMarkResolved(req: ConflictMarkReq): Promise<null>;
  conflictResolveSimple(req: ConflictsPathReq): Promise<number>;
  // M5
  rebaseInteractivePlan(req: RebasePlanReq): Promise<RebasePlan>;
  rebaseInteractiveStart(req: RebaseInteractiveStartReq): Promise<RewriteResult>;
  rewordCommit(req: RewordCommitReq): Promise<RewriteResult>;
  squashCommits(req: SquashCommitsReq): Promise<RewriteResult>;
  dropCommits(req: DropCommitsReq): Promise<RewriteResult>;
  fixupInto(req: FixupIntoReq): Promise<RewriteResult>;
  uncommit(req: RewritePathReq): Promise<RewriteResult>;
  revertRun(req: RevertRunReq): Promise<RewriteResult>;
  revertContinue(req: RewritePathReq): Promise<RewriteResult>;
  revertAbort(req: RewritePathReq): Promise<RewriteResult>;
  resetPreview(req: ResetPreviewReq): Promise<ResetPreview>;
  resetRun(req: ResetRunReq): Promise<RewriteResult>;
  undoRewrite(req: UndoRewriteReq): Promise<RewriteResult>;
  extractChanges(req: PartialChangesReq): Promise<RewriteResult>;
  dropChanges(req: PartialChangesReq): Promise<RewriteResult>;
  // M6
  stageLines(req: LinesReq): Promise<null>;
  unstageLines(req: LinesReq): Promise<null>;
  revertLines(req: LinesReq): Promise<null>;
  changelistList(req: ChangelistPathReq): Promise<ChangelistsState>;
  changelistCreate(req: ChangelistCreateReq): Promise<ChangelistsState>;
  changelistRename(req: ChangelistRenameReq): Promise<ChangelistsState>;
  changelistDelete(req: ChangelistDeleteReq): Promise<ChangelistsState>;
  changelistSetActive(req: ChangelistIdReq): Promise<ChangelistsState>;
  changelistMove(req: ChangelistMoveReq): Promise<ChangelistsState>;
  stashList(req: StashPathReq): Promise<StashEntry[]>;
  stashCreate(req: StashCreateReq): Promise<null>;
  stashApply(req: StashRefReq): Promise<null>;
  stashPop(req: StashRefReq): Promise<null>;
  stashDrop(req: StashRefReq): Promise<null>;
  stashClear(req: StashPathReq): Promise<null>;
  stashBranch(req: StashBranchReq): Promise<null>;
  stashRestore(req: StashRestoreReq): Promise<null>;
  shelfList(req: ShelfPathReq): Promise<ShelfEntry[]>;
  shelfListDeleted(req: ShelfPathReq): Promise<ShelfEntry[]>;
  shelfCreate(req: ShelfCreateReq): Promise<ShelfEntry>;
  shelfUnshelve(req: ShelfUnshelveReq): Promise<ShelfUnshelveResult>;
  shelfDelete(req: ShelfIdReq): Promise<null>;
  shelfRestore(req: ShelfIdReq): Promise<ShelfEntry>;
  shelfRename(req: ShelfRenameReq): Promise<ShelfEntry>;
  shelfImport(req: ShelfImportReq): Promise<ShelfEntry>;
  shelfExport(req: ShelfExportReq): Promise<PatchCreateResult>;
  ignoreAdd(req: IgnoreAddReq): Promise<IgnoreAddResult>;
  ignoreSuggestPatterns(req: IgnoreSuggestReq): Promise<string[]>;
  excludeOpen(req: ExcludePathReq): Promise<string>;
  rmCached(req: RmCachedReq): Promise<null>;
  patchCreate(req: PatchCreateReq): Promise<PatchCreateResult>;
  patchApply(req: PatchApplyReq): Promise<null>;
  patchApplyClipboard(req: PatchApplyClipboardReq): Promise<null>;
  // M7
  worktreeList(req: WorktreeListReq): Promise<WorktreeInfo[]>;
  worktreeAdd(req: WorktreeAddReq): Promise<WorktreeAddRes>;
  worktreeRemove(req: WorktreeRemoveReq): Promise<null>;
  worktreeLock(req: WorktreeLockReq): Promise<null>;
  worktreeUnlock(req: WorktreePathReq): Promise<null>;
  worktreePrunePreview(req: WorktreeListReq): Promise<WorktreePrunePreview>;
  worktreePrune(req: WorktreeListReq): Promise<WorktreePrunePreview>;
  worktreeOpenRef(req: WorktreeOpenRefReq): Promise<WorktreeAddRes>;
  worktreeDefaultPath(req: WorktreeDefaultPathReq): Promise<WorktreeDefaultPathRes>;
  repoDiscover(req: DiscoverRootsReq): Promise<RepoRoot[]>;
  multiRootCheckout(req: MultiRootCheckoutReq): Promise<MultiRootOpResult>;
  multiRootRollback(req: MultiRootRollbackReq): Promise<MultiRootOpResult>;
  uiSyncBroadcast(payload: UiSyncPayload): Promise<null>;
  parseWslPath(req: ParseWslPathReq): Promise<WslPathInfo | null>;
  syncFork(req: SyncForkReq): Promise<SyncForkResult>;
  submoduleUpdate(req: SubmoduleUpdateReq): Promise<SubmoduleUpdateResult>;
  credentialSessionSet(req: CredentialSessionReq): Promise<CredentialSessionRes>;
  credentialSessionClear(): Promise<null>;
};

export const tauriBackend: Backend = {
  appInfo: () => commands.appInfo(),
  gitDetect: () => commands.gitDetect(),
  gitTestExecutable: (path) => commands.gitTestExecutable(path),
  settingsGet: () => commands.settingsGet(),
  settingsSet: (settings) => commands.settingsSet(settings),
  jobList: () => commands.jobList(),
  jobCancel: (jobId) => commands.jobCancel({ jobId }),
  workspaceOpen: (req) => commands.workspaceOpen(req),
  workspaceWatch: (roots, generation) => commands.workspaceWatch(roots, generation),
  workspaceUnwatch: (generation) => commands.workspaceUnwatch(generation),
  workspaceRecent: () => commands.workspaceRecent(),
  statusProbe: (req) => commands.statusProbe(req),
  initRun: (req) => commands.initRun(req),
  vcsEnable: (req) => commands.vcsEnable(req),
  statusGet: (req) => commands.statusGet(req),
  stagePaths: (req) => commands.stagePaths(req),
  unstagePaths: (req) => commands.unstagePaths(req),
  addPaths: (req) => commands.addPaths(req),
  stageHunks: (req) => commands.stageHunks(req),
  unstageHunks: (req) => commands.unstageHunks(req),
  diffFile: (req) => commands.diffFile(req),
  diffFileAt: (req) => commands.diffFileAt(req),
  diffRefs: (req) => commands.diffRefs(req),
  diffCombined: (req) => commands.diffCombined(req),
  commitCreate: (req) => commands.commitCreate(req),
  commitHeadMessage: (req) => commands.commitHeadMessage(req),
  logQuery: (req) => commands.logQuery(req),
  logLocate: (req) => commands.logLocate(req),
  logCommitDetails: (req) => commands.logCommitDetails(req),
  logChangedFiles: (req) => commands.logChangedFiles(req),
  fileHistory: (req) => commands.fileHistory(req),
  blameFile: (req) => commands.blameFile(req),
  treeList: (req) => commands.treeList(req),
  blobRead: (req) => commands.blobRead(req),
  checkoutPathFromRev: (req) => commands.checkoutPathFromRev(req),
  listRefs: (req) => commands.listRefs(req),
  logIndexStatus: (req) => commands.logIndexStatus(req),
  logIndexRebuild: (req) => commands.logIndexRebuild(req),
  refsList: (req) => commands.refsList(req),
  favoritesToggle: (req) => commands.favoritesToggle(req),
  branchCreate: (req) => commands.branchCreate(req),
  branchCheckout: (req) => commands.branchCheckout(req),
  branchRename: (req) => commands.branchRename(req),
  branchDelete: (req) => commands.branchDelete(req),
  branchRestore: (req) => commands.branchRestore(req),
  branchUpdate: (req) => commands.branchUpdate(req),
  compareBranches: (req) => commands.compareBranches(req),
  tagCreate: (req) => commands.tagCreate(req),
  tagDelete: (req) => commands.tagDelete(req),
  tagPush: (req) => commands.tagPush(req),
  remoteList: (req) => commands.remoteList(req),
  remoteAdd: (req) => commands.remoteAdd(req),
  remoteEdit: (req) => commands.remoteEdit(req),
  remoteRemovePreview: (req) => commands.remoteRemovePreview(req),
  remoteRemove: (req) => commands.remoteRemove(req),
  remoteDeleteBranch: (req) => commands.remoteDeleteBranch(req),
  fetchRun: (req) => commands.fetchRun(req),
  pullRun: (req) => commands.pullRun(req),
  updateProjectRun: (req) => commands.updateProjectRun(req),
  pushPreview: (req) => commands.pushPreview(req),
  pushRun: (req) => commands.pushRun(req),
  lsRemoteCheck: (req) => commands.lsRemoteCheck(req),
  cloneCheckUrl: (req) => commands.cloneCheckUrl(req),
  cloneRun: (req) => commands.cloneRun(req),
  unshallowRun: (req) => commands.unshallowRun(req),
  repoStateGet: (req) => commands.repoStateGet(req),
  repoOpStateGet: (req) => commands.repoOpStateGet(req),
  mergeRun: (req) => commands.mergeRun(req),
  mergeAbort: (req) => commands.mergeAbort(req),
  mergeCommit: (req) => commands.mergeCommit(req),
  rebaseRun: (req) => commands.rebaseRun(req),
  rebaseContinue: (req) => commands.rebaseContinue(req),
  rebaseSkip: (req) => commands.rebaseSkip(req),
  rebaseAbort: (req) => commands.rebaseAbort(req),
  cherryPickRun: (req) => commands.cherryPickRun(req),
  cherryPickContinue: (req) => commands.cherryPickContinue(req),
  cherryPickSkip: (req) => commands.cherryPickSkip(req),
  cherryPickAbort: (req) => commands.cherryPickAbort(req),
  conflictsList: (req) => commands.conflictsList(req),
  conflictAcceptSide: (req) => commands.conflictAcceptSide(req),
  conflictVersions: (req) => commands.conflictVersions(req),
  conflictMerge3: (req) => commands.conflictMerge3(req),
  conflictSaveResult: (req) => commands.conflictSaveResult(req),
  conflictMarkResolved: (req) => commands.conflictMarkResolved(req),
  conflictResolveSimple: (req) => commands.conflictResolveSimple(req),
  rebaseInteractivePlan: (req) => commands.rebaseInteractivePlan(req),
  rebaseInteractiveStart: (req) => commands.rebaseInteractiveStart(req),
  rewordCommit: (req) => commands.rewordCommit(req),
  squashCommits: (req) => commands.squashCommits(req),
  dropCommits: (req) => commands.dropCommits(req),
  fixupInto: (req) => commands.fixupInto(req),
  uncommit: (req) => commands.uncommit(req),
  revertRun: (req) => commands.revertRun(req),
  revertContinue: (req) => commands.revertContinue(req),
  revertAbort: (req) => commands.revertAbort(req),
  resetPreview: (req) => commands.resetPreview(req),
  resetRun: (req) => commands.resetRun(req),
  undoRewrite: (req) => commands.undoRewrite(req),
  extractChanges: (req) => commands.extractChanges(req),
  dropChanges: (req) => commands.dropChanges(req),
  stageLines: (req) => commands.stageLines(req),
  unstageLines: (req) => commands.unstageLines(req),
  revertLines: (req) => commands.revertLines(req),
  changelistList: (req) => commands.changelistList(req),
  changelistCreate: (req) => commands.changelistCreate(req),
  changelistRename: (req) => commands.changelistRename(req),
  changelistDelete: (req) => commands.changelistDelete(req),
  changelistSetActive: (req) => commands.changelistSetActive(req),
  changelistMove: (req) => commands.changelistMove(req),
  stashList: (req) => commands.stashList(req),
  stashCreate: (req) => commands.stashCreate(req),
  stashApply: (req) => commands.stashApply(req),
  stashPop: (req) => commands.stashPop(req),
  stashDrop: (req) => commands.stashDrop(req),
  stashClear: (req) => commands.stashClear(req),
  stashBranch: (req) => commands.stashBranch(req),
  stashRestore: (req) => commands.stashRestore(req),
  shelfList: (req) => commands.shelfList(req),
  shelfListDeleted: (req) => commands.shelfListDeleted(req),
  shelfCreate: (req) => commands.shelfCreate(req),
  shelfUnshelve: (req) => commands.shelfUnshelve(req),
  shelfDelete: (req) => commands.shelfDelete(req),
  shelfRestore: (req) => commands.shelfRestore(req),
  shelfRename: (req) => commands.shelfRename(req),
  shelfImport: (req) => commands.shelfImport(req),
  shelfExport: (req) => commands.shelfExport(req),
  ignoreAdd: (req) => commands.ignoreAdd(req),
  ignoreSuggestPatterns: (req) => commands.ignoreSuggestPatterns(req),
  excludeOpen: (req) => commands.excludeOpen(req),
  rmCached: (req) => commands.rmCached(req),
  patchCreate: (req) => commands.patchCreate(req),
  patchApply: (req) => commands.patchApply(req),
  patchApplyClipboard: (req) => commands.patchApplyClipboard(req),
  worktreeList: (req) => commands.worktreeList(req),
  worktreeAdd: (req) => commands.worktreeAdd(req),
  worktreeRemove: (req) => commands.worktreeRemove(req),
  worktreeLock: (req) => commands.worktreeLock(req),
  worktreeUnlock: (req) => commands.worktreeUnlock(req),
  worktreePrunePreview: (req) => commands.worktreePrunePreview(req),
  worktreePrune: (req) => commands.worktreePrune(req),
  worktreeOpenRef: (req) => commands.worktreeOpenRef(req),
  worktreeDefaultPath: (req) => commands.worktreeDefaultPath(req),
  repoDiscover: (req) => commands.repoDiscover(req),
  multiRootCheckout: (req) => commands.multiRootCheckout(req),
  multiRootRollback: (req) => commands.multiRootRollback(req),
  uiSyncBroadcast: (payload) => commands.uiSyncBroadcast(payload),
  parseWslPath: (req) => commands.parseWslPath(req),
  syncFork: (req) => commands.syncFork(req),
  submoduleUpdate: (req) => commands.submoduleUpdate(req),
  credentialSessionSet: (req) => commands.credentialSessionSet(req),
  credentialSessionClear: () => commands.credentialSessionClear(),
};

export function getBackend(): Backend {
  if (isTauri()) return tauriBackend;
  return mockBackend;
}

export * from "./bindings";
