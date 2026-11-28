import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { i18n } from "@/i18n";
import { createWorkspaceOpen } from "./useWorkspaceOpen";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore } from "@/stores/changesStore";
import { useLogStore } from "@/stores/logStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { useJobsStore } from "@/stores/jobsStore";
import { useWorktreesStore } from "@/stores/worktreesStore";
import CommitToolWindow from "@/components/layout/CommitToolWindow.vue";
import LogView from "@/features/log/LogView.vue";
import BranchesPane from "@/features/branches/BranchesPane.vue";
import FileRootSelector from "@/features/file-tree/FileRootSelector.vue";
import type { LogPage, RefsList, StatusSnapshot } from "@/lib/backend";

const m = vi.hoisted(() => ({
  backend: {
    workspaceOpen: vi.fn(),
    workspaceRecent: vi.fn(),
    initRun: vi.fn(),
    vcsEnable: vi.fn(),
    statusGet: vi.fn(),
    changelistList: vi.fn(),
    refsList: vi.fn(),
    remoteList: vi.fn(),
    logQuery: vi.fn(),
    logIndexStatus: vi.fn(),
    logCommitDetails: vi.fn(),
    logChangedFiles: vi.fn(),
  },
  opState: vi.fn(),
  pick: vi.fn(),
  choose: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", async () => {
  const { withBackendActivity } = await import("@/lib/backend/activity");
  const backend = withBackendActivity({
    ...m.backend,
    appOpenNewWindow: vi.fn().mockResolvedValue(null),
  });
  return { getBackend: () => backend };
});
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({ settings: { stagingMode: true, git: {} }, load: vi.fn() }),
}));
vi.mock("@/stores/rewriteStore", () => ({
  useRewriteStore: () => ({ busy: false, refreshOpState: m.opState }),
}));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => ({}) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({ tabs: [] }) }));
vi.mock("@/stores/fileOperationsStore", () => ({
  useFileOperationsStore: () => ({ busy: false }),
}));
vi.mock("@/stores/conflictsStore", () => ({
  useConflictsStore: () => ({ mergeTabs: [] }),
}));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => ({}) }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => ({}) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => ({}) }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/lib/utils", async (original) => ({
  ...(await original<object>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: m.pick }));
vi.mock("@/composables/useOpenProjectChoice", () => ({
  chooseOpenProjectTarget: m.choose,
}));

enableAutoUnmount(afterEach);
let pinia: ReturnType<typeof createPinia>;
const releases: Array<() => void> = [];
const pending: Promise<unknown>[] = [];
const opened = (path: string) => ({ path, isRepo: true, gitDir: `${path}/.git`, toplevel: path });
const status = (path = "repo") => ({ repoId: path, version: 1, files: [], branch: null });
const page = { commits: [], nextOffset: 0, truncated: false };
const refs = { local: [], remote: [], tags: [] };
function deferred<T>(fallback: T) {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  releases.push(() => resolve(fallback));
  return { promise, resolve, reject };
}
function track<T>(promise: Promise<T>) {
  pending.push(promise);
  return promise;
}
function mountPanels() {
  const global = {
    plugins: [pinia, i18n],
    stubs: {
      Splitpanes: { template: "<div><slot /></div>" },
      Pane: { template: "<div><slot /></div>" },
      // Use the actual nested branch pane and its real mount lifecycle.
      BranchesPane,
    },
  };
  shallowMount(CommitToolWindow, { global });
  shallowMount(LogView, { global });
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  m.backend.workspaceOpen.mockImplementation(async ({ path }) => opened(path));
  m.backend.workspaceRecent.mockResolvedValue({ paths: [] });
  m.backend.initRun.mockImplementation(async ({ path }) => opened(path));
  m.backend.vcsEnable.mockImplementation(async ({ path }) => opened(path));
  m.backend.statusGet.mockImplementation(async ({ path }) => status(path));
  m.backend.changelistList.mockResolvedValue({ lists: [], assignments: [] });
  m.backend.logQuery.mockResolvedValue(page);
  m.backend.logIndexStatus.mockResolvedValue(null);
  m.backend.logChangedFiles.mockResolvedValue([]);
  m.backend.refsList.mockResolvedValue(refs);
  m.backend.remoteList.mockResolvedValue([]);
  m.choose.mockResolvedValue("here");
  m.pick.mockResolvedValue("repo");
});
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(pending.splice(0));
  await flushPromises();
  disposePinia(pinia);
});

it.each(["already mounted", "mounted during opening"])(
  "%s panels share the opening controller's initial reads and task lifetime",
  async (when) => {
    const entry = createWorkspaceOpen((key) => key);
    const files = deferred(status());
    const history = deferred(page);
    const branches = deferred(refs);
    m.backend.statusGet.mockReturnValue(files.promise);
    m.backend.logQuery.mockReturnValue(history.promise);
    m.backend.refsList.mockReturnValue(branches.promise);
    if (when === "already mounted") mountPanels();
    const opening = track(entry.openRecent("repo"));
    await flushPromises();
    if (when === "mounted during opening") {
      mountPanels();
      await flushPromises();
    }
    expect({
      status: m.backend.statusGet.mock.calls.length,
      history: m.backend.logQuery.mock.calls.length,
      refs: m.backend.refsList.mock.calls.length,
      remotes: m.backend.remoteList.mock.calls.length,
    }).toEqual({ status: 1, history: 1, refs: 1, remotes: 1 });
    expect(useJobsStore().count).toBe(1);
    files.resolve(status());
    history.resolve(page);
    await flushPromises();
    expect(entry.pending.value).toBe(true);
    expect(useJobsStore().count).toBe(1);
    branches.resolve(refs);
    await opening;
    expect(useChangesStore().loading).toBe(false);
    expect(useLogStore().loading).toBe(false);
    expect(useBranchesStore().loading).toBe(false);
    expect(useJobsStore().count).toBe(0);
    expect(m.opState).toHaveBeenCalledOnce();
  },
);

it("still reads when panels mount without a shared opening operation", async () => {
  await useWorkspaceStore().openFolder("repo");
  mountPanels();
  await flushPromises();
  expect(m.backend.statusGet).toHaveBeenCalledOnce();
  expect(m.backend.logQuery).toHaveBeenCalledOnce();
  expect(m.backend.refsList).toHaveBeenCalledOnce();
  expect(m.opState).toHaveBeenCalledOnce();
});

it("registers an explicit user query independently while the opening task still owns initial reads", async () => {
  const entry = createWorkspaceOpen((key) => key);
  const history = deferred(page);
  const userHistory = deferred(page);
  const branches = deferred(refs);
  m.backend.logQuery.mockReturnValueOnce(history.promise).mockReturnValueOnce(userHistory.promise);
  m.backend.refsList.mockReturnValueOnce(branches.promise);
  const opening = track(entry.openRecent("repo"));
  await flushPromises();
  expect(useJobsStore().count).toBe(1);
  const log = useLogStore();
  log.setTextFilter("manual query");
  const query = track(log.applyFilters());
  await flushPromises();
  expect(useJobsStore().count).toBe(2);
  history.resolve(page);
  branches.resolve(refs);
  await opening;
  expect(useJobsStore().count).toBe(1);
  expect(log.loading).toBe(true);
  userHistory.resolve(page);
  await query;
  expect(useJobsStore().count).toBe(0);
});

it("does not let a late panel mount replace reads owned by the opening task", async () => {
  const entry = createWorkspaceOpen((key) => key);
  const files = deferred(status());
  const history = deferred(page);
  const branches = deferred(refs);
  m.backend.statusGet
    .mockReturnValueOnce(files.promise)
    .mockReturnValue(deferred(status()).promise);
  m.backend.logQuery.mockReturnValueOnce(history.promise).mockReturnValue(deferred(page).promise);
  m.backend.refsList.mockReturnValueOnce(branches.promise).mockReturnValue(deferred(refs).promise);
  const opening = track(entry.openRecent("repo"));
  await flushPromises();
  mountPanels();
  await flushPromises();
  files.resolve(status());
  history.resolve(page);
  branches.resolve(refs);
  await opening;
  expect({
    loading: [useChangesStore().loading, useLogStore().loading, useBranchesStore().loading],
    tasks: useJobsStore().count,
    status: useChangesStore().snapshot,
  }).toEqual({ loading: [false, false, false], tasks: 0, status: status() });
});

it.each(["folder", "create", "clone", "enable", "worktree"] as const)(
  "%s initializes each panel once through its actual store",
  async (kind) => {
    const entry = createWorkspaceOpen((key) => key);
    useWorkspaceStore().folderPath = "repo";
    mountPanels();
    await track(
      kind === "folder"
        ? entry.openFolder()
        : kind === "create"
          ? entry.createRepo()
          : kind === "clone"
            ? entry.openCloned("repo")
            : kind === "worktree"
              ? useWorktreesStore().openWorktree("repo", false)
              : entry.enableVcs(),
    );
    await flushPromises();
    expect(m.backend.statusGet).toHaveBeenCalledOnce();
    expect(m.backend.logQuery).toHaveBeenCalledOnce();
    expect(m.backend.refsList).toHaveBeenCalledOnce();
    expect(useJobsStore().count).toBe(0);
  },
);

it.each(["cancel picker", "fail backend"] as const)(
  "still loads the displayed repository when panels mount before an open can %s",
  async (outcome) => {
    const ws = useWorkspaceStore();
    await ws.openFolder("displayed");
    const entry = createWorkspaceOpen((key) => key);
    const picker = deferred<string | null>(null);
    const backend = deferred(opened("displayed"));
    m.pick.mockReturnValueOnce(picker.promise);
    m.backend.workspaceOpen.mockReturnValueOnce(backend.promise);
    const opening = track(
      outcome === "cancel picker" ? entry.openFolder() : entry.openRecent("displayed"),
    );
    await flushPromises();
    mountPanels();
    await flushPromises();
    expect(m.backend.statusGet).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: "displayed" }),
    );
    expect(m.backend.logQuery).toHaveBeenCalledOnce();
    expect(m.backend.refsList).toHaveBeenCalledOnce();
    if (outcome === "cancel picker") picker.resolve(null);
    else backend.reject(new Error("Open failed"));
    await opening;
    expect(ws.repoPath).toBe("displayed");
    expect(useChangesStore().snapshot).toEqual(status("displayed"));
    expect(useJobsStore().count).toBe(0);
  },
);

it.each([
  ["success", false],
  ["failure", false],
  ["success", true],
  ["failure", true],
] as const)(
  "isolates old %s after a root selection (new opening pending: %s)",
  async (outcome, reopen) => {
    const entry = createWorkspaceOpen((key) => key);
    const ws = useWorkspaceStore();
    const parentStatus: StatusSnapshot = {
      ...status(),
      branch: { head: "parent", upstream: null, ahead: 0, behind: 0, detached: false },
    };
    const parentHistory: LogPage = {
      commits: [
        {
          sha: "parent",
          shortSha: "parent",
          parents: [],
          subject: "PARENT",
          author: "QA",
          authorEmail: "qa@example.test",
          authorTime: 1,
          refs: ["refs/heads/parent"],
          graph: { lane: 0, color: 0, edges: [] },
        },
      ],
      nextOffset: 1,
      truncated: false,
    };
    const parentRefs: RefsList = {
      local: [
        {
          name: "parent",
          fullName: "refs/heads/parent",
          kind: "localBranch",
          sha: "parent",
          upstream: null,
          ahead: 0,
          behind: 0,
          isHead: true,
          subject: "PARENT",
          committerTime: 1,
          peeledSha: null,
          isFavorite: false,
        },
      ],
      remote: [],
      tags: [],
      recent: [],
      current: "parent",
      detached: false,
    };
    const files = deferred(parentStatus);
    const history = deferred(parentHistory);
    const branches = deferred(parentRefs);
    m.backend.statusGet.mockReturnValueOnce(files.promise);
    m.backend.logQuery.mockReturnValueOnce(history.promise);
    m.backend.refsList.mockReturnValueOnce(branches.promise);
    m.backend.workspaceOpen.mockResolvedValueOnce({
      ...opened("repo"),
      roots: ["repo", "nested"].map((path) => ({
        id: path,
        worktreeRoot: path,
        gitDir: `${path}/.git`,
        commonDir: `${path}/.git`,
        isWorktree: false,
        displayName: path,
        color: "#123456",
        isSubmodule: false,
      })),
    });
    mountPanels();
    const opening = track(entry.openRecent("repo"));
    await flushPromises();
    expect(entry.pending.value).toBe(true);
    expect(useJobsStore().running.map((job) => job.message)).toEqual(["repo"]);
    const selector = shallowMount(FileRootSelector, { global: { plugins: [pinia, i18n] } });
    await selector.get("select").setValue("nested");
    await flushPromises();
    expect(ws.folderPath).toBe("repo");
    expect(ws.repoPath).toBe("nested");
    expect(selector.get("select").element.value).toBe("nested");
    expect(entry.pending.value).toBe(false);
    shallowMount(BranchesPane, { global: { plugins: [pinia, i18n] } });
    await flushPromises();
    expect(m.backend.statusGet).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "nested" }),
    );
    expect(m.backend.logQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "nested" }),
    );
    expect(m.backend.refsList).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "nested" }),
    );
    const nextFiles = deferred(status("next"));
    let nextOpening: Promise<void> | undefined;
    if (reopen) {
      m.backend.statusGet.mockReturnValueOnce(nextFiles.promise);
      nextOpening = track(entry.openRecent("next"));
      await flushPromises();
      expect(entry.pending.value).toBe(true);
      expect(useChangesStore().loading).toBe(true);
      expect(useJobsStore().running.map((job) => job.message)).toEqual(["repo", "next"]);
    }
    const currentStatus = useChangesStore().snapshot;
    const currentCommits = useLogStore().commits;
    const currentRefs = useBranchesStore().refs;
    const currentBranch = ws.branch;
    if (outcome === "success") {
      files.resolve(parentStatus);
      history.resolve(parentHistory);
      branches.resolve(parentRefs);
    } else {
      const error = new Error("Obsolete parent read failed");
      files.reject(error);
      history.reject(error);
      branches.reject(error);
    }
    await opening;
    await flushPromises();
    expect(useChangesStore().snapshot).toBe(currentStatus);
    expect(useLogStore().commits).toBe(currentCommits);
    expect(useBranchesStore().refs).toBe(currentRefs);
    expect(ws.branch).toBe(currentBranch);
    expect([useChangesStore().error, useLogStore().error, useBranchesStore().error]).toEqual([
      null,
      null,
      null,
    ]);
    expect(m.toast).not.toHaveBeenCalled();
    expect(entry.pending.value).toBe(reopen);
    expect(useChangesStore().loading).toBe(reopen);
    expect(useJobsStore().running.map((job) => job.message)).toEqual(reopen ? ["next"] : []);
    if (nextOpening) {
      nextFiles.resolve(status("next"));
      await nextOpening;
    }
    expect(useChangesStore().snapshot?.repoId).toBe(reopen ? "next" : "nested");
    expect(entry.pending.value).toBe(false);
    expect(useJobsStore().count).toBe(0);
  },
);
