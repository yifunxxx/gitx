import type {
  AppInfo,
  AppSettings,
  BlameReq,
  BlameResult,
  BlobContent,
  BlobReadReq,
  ChangedFile,
  CheckoutPathReq,
  CombinedDiffReq,
  CombinedDiffResult,
  CommitCreateReq,
  CommitDetails,
  CommitResult,
  DiffFileAtReq,
  DiffFileReq,
  DiffFileResult,
  DiffRefsReq,
  DiffRefsResult,
  FileHistoryReq,
  GitDetectDto,
  HeadMessageReq,
  HistoryPage,
  HunksReq,
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
  StatusGetReq,
  StatusProbeReq,
  StatusSnapshot,
  TreeEntry,
  TreeListReq,
  WorkspaceOpenReq,
  WorkspaceOpenRes,
  WorkspaceRecentRes,
  InitRunReq,
  VcsEnableReq,
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
  fileHistory(req: FileHistoryReq): Promise<HistoryPage>;
  blameFile(req: BlameReq): Promise<BlameResult>;
  treeList(req: TreeListReq): Promise<TreeEntry[]>;
  blobRead(req: BlobReadReq): Promise<BlobContent>;
  checkoutPathFromRev(req: CheckoutPathReq): Promise<null>;
  listRefs(req: ListRefsReq): Promise<string[]>;
  logIndexStatus(req: IndexStatusReq): Promise<IndexStatus>;
  logIndexRebuild(req: IndexRebuildReq): Promise<IndexStatus>;
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
};

export function getBackend(): Backend {
  if (isTauri()) return tauriBackend;
  return mockBackend;
}

export * from "./bindings";
