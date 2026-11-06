import type {
  AppInfo,
  AppSettings,
  CommitCreateReq,
  CommitDetails,
  CommitResult,
  DiffFileReq,
  DiffFileResult,
  GitDetectDto,
  HeadMessageReq,
  HunksReq,
  JobHandle,
  JobInfo,
  LogChangedFilesReq,
  LogCommitDetailsReq,
  LogPage,
  LogQueryReq,
  PathsReq,
  AddPathsReq,
  StatusGetReq,
  StatusProbeReq,
  StatusSnapshot,
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
};

export function getBackend(): Backend {
  if (isTauri()) return tauriBackend;
  return mockBackend;
}

export * from "./bindings";
