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
  FavoritesSetReq,
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
  RewritePathReq,
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
  ResetMode,
  UndoRewriteReq,
  PartialChangesReq,
  RebaseTodoAction,
  RebaseTodoItem,
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
  favoritesSet(req: FavoritesSetReq): Promise<null>;
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
  favoritesSet: (req) => commands.favoritesSet(req),
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
};

export function getBackend(): Backend {
  if (isTauri()) return tauriBackend;
  return mockBackend;
}

export * from "./bindings";
