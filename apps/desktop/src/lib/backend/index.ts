import type {
  AppInfo,
  AppSettings,
  BranchCheckoutReq,
  BranchCreateReq,
  BranchDeleteReq,
  BranchDeleteRes,
  BranchRenameReq,
  BranchRestoreReq,
  BranchUpdateReq,
  CloneCheckUrlReq,
  CloneResult,
  CloneRunReq,
  CommitCreateReq,
  CommitDetails,
  CommitResult,
  CompareRange,
  CompareReq,
  DiffFileReq,
  DiffFileResult,
  FavoritesSetReq,
  FetchRunReq,
  FetchSummary,
  GitDetectDto,
  HeadMessageReq,
  HunksReq,
  IncomingCheck,
  IncomingCheckReq,
  JobHandle,
  JobInfo,
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
  UnshallowReq,
  UpdateInfo,
  UpdateProjectReq,
  WorkspaceOpenReq,
  WorkspaceOpenRes,
  WorkspaceRecentRes,
  InitRunReq,
  VcsEnableReq,
  ChangedFile,
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
  commitCreate(req: CommitCreateReq): Promise<CommitResult>;
  commitHeadMessage(req: HeadMessageReq): Promise<string>;
  logQuery(req: LogQueryReq): Promise<LogPage>;
  logCommitDetails(req: LogCommitDetailsReq): Promise<CommitDetails>;
  logChangedFiles(req: LogChangedFilesReq): Promise<ChangedFile[]>;
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
  commitCreate: (req) => commands.commitCreate(req),
  commitHeadMessage: (req) => commands.commitHeadMessage(req),
  logQuery: (req) => commands.logQuery(req),
  logCommitDetails: (req) => commands.logCommitDetails(req),
  logChangedFiles: (req) => commands.logChangedFiles(req),
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
};

export function getBackend(): Backend {
  if (isTauri()) return tauriBackend;
  return mockBackend;
}

export * from "./bindings";
