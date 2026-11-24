import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { createWorkspaceOpen } from "./useWorkspaceOpen";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useJobsStore } from "@/stores/jobsStore";

const m = vi.hoisted(() => ({
  workspaceOpen: vi.fn(),
  workspaceRecent: vi.fn(),
  initRun: vi.fn(),
  vcsEnable: vi.fn(),
  appOpenNewWindow: vi.fn(),
  refresh: vi.fn(),
  load: vi.fn(),
  branches: vi.fn(),
  pick: vi.fn(),
  toast: vi.fn(),
  jobList: vi.fn(),
  choose: vi.fn(),
}));
vi.mock("@/lib/backend", async () => {
  const { withBackendActivity } = await import("@/lib/backend/activity");
  const backend = withBackendActivity(m);
  return { getBackend: () => backend };
});
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: m.refresh }) }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => ({ load: m.load }) }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ refresh: m.branches }) }));
vi.mock("@/lib/utils", async (original) => ({
  ...(await original<object>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: m.pick }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/composables/useOpenProjectChoice", () => ({
  chooseOpenProjectTarget: m.choose,
}));

let pinia: ReturnType<typeof createPinia>;
const cleanup: Array<() => void> = [];
const running: Promise<unknown>[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  cleanup.push(() => resolve(undefined as T));
  return { promise, resolve, reject };
}
function track<T>(request: Promise<T>) {
  running.push(request);
  void request.catch(() => {});
  return request;
}
const opened = (path: string, isRepo = true) => ({
  path,
  isRepo,
  gitDir: isRepo ? `${path}/.git` : null,
  toplevel: isRepo ? path : null,
});
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  m.workspaceOpen.mockImplementation(async ({ path }) => opened(path));
  m.initRun.mockImplementation(async ({ path }) => opened(path));
  m.vcsEnable.mockImplementation(async ({ path }) => opened(path));
  m.workspaceRecent.mockResolvedValue({ paths: [] });
  m.jobList.mockResolvedValue([]);
  m.appOpenNewWindow.mockResolvedValue(null);
  m.choose.mockResolvedValue("here");
  m.pick.mockResolvedValue("repo");
});
afterEach(async () => {
  for (const release of cleanup.splice(0)) release();
  await Promise.allSettled(running.splice(0));
  disposePinia(pinia);
});

it.each(["folder", "create", "recent", "clone", "enable"] as const)(
  "%s keeps one task during opening and required reads, without waiting for recent projects",
  async (kind) => {
    const jobs = useJobsStore();
    const entry = createWorkspaceOpen((key) => key);
    const opening = deferred<ReturnType<typeof opened>>();
    const files = deferred<void>();
    const recent = deferred<{ paths: string[] }>();
    const method =
      kind === "create" ? m.initRun : kind === "enable" ? m.vcsEnable : m.workspaceOpen;
    method.mockReturnValueOnce(opening.promise);
    m.refresh.mockReturnValueOnce(files.promise);
    m.workspaceRecent.mockReturnValueOnce(recent.promise);
    useWorkspaceStore().folderPath = "repo";
    const request = track(
      kind === "folder"
        ? entry.openFolder()
        : kind === "create"
          ? entry.createRepo()
          : kind === "enable"
            ? entry.enableVcs()
            : kind === "clone"
              ? entry.openCloned("repo")
              : entry.openRecent("repo"),
    );
    await flushPromises();
    expect(jobs.count).toBe(1);
    expect(jobs.running[0]).toMatchObject({ message: "repo", cancellable: false });
    opening.resolve(opened("repo"));
    await flushPromises();
    expect(m.refresh).toHaveBeenCalledOnce();
    expect(entry.pending.value).toBe(true);
    expect(jobs.running).toHaveLength(1);
    expect(jobs.running[0]).toMatchObject({ title: "operations.open", message: "repo" });
    await jobs.refresh();
    expect(jobs.count).toBe(1);
    files.resolve();
    await request;
    expect(entry.pending.value).toBe(false);
    expect(jobs.count).toBe(0);
    recent.resolve({ paths: ["repo"] });
    await flushPromises();
    expect(jobs.count).toBe(0);
  },
);

it.each(["success", "failure"] as const)(
  "late %s finishes only its own loading task",
  async (outcome) => {
    const jobs = useJobsStore();
    const entry = createWorkspaceOpen((key) => key);
    const oldFiles = deferred<void>();
    const newFiles = deferred<void>();
    m.refresh.mockReturnValueOnce(oldFiles.promise).mockReturnValueOnce(newFiles.promise);
    const first = track(entry.openRecent("A"));
    await flushPromises();
    expect(jobs.running.map((job) => job.message)).toEqual(["A"]);
    await useWorkspaceStore().openFolder("external navigation");
    const second = track(entry.openRecent("B"));
    await flushPromises();
    expect(jobs.running.map((job) => job.message)).toEqual(["A", "B"]);
    if (outcome === "success") oldFiles.resolve();
    else oldFiles.reject(new Error("Old read failed"));
    await first;
    expect(jobs.running.map((job) => job.message)).toEqual(["B"]);
    expect(entry.pending.value).toBe(true);
    expect(m.toast).not.toHaveBeenCalled();
    newFiles.resolve();
    await second;
    expect(jobs.count).toBe(0);
  },
);

it("releases failed initial reads and permits a successful retry", async () => {
  const jobs = useJobsStore();
  const entry = createWorkspaceOpen((key) => key);
  const files = deferred<void>();
  m.refresh.mockReturnValueOnce(files.promise);
  const request = track(entry.openRecent("repo"));
  await flushPromises();
  expect(jobs.count).toBe(1);
  files.reject(new Error("Cannot read changes"));
  await request;
  expect(jobs.count).toBe(0);
  expect(entry.pending.value).toBe(false);
  expect(m.toast).toHaveBeenCalledWith({
    title: "rewrite.refreshFailed",
    description: "Cannot read changes",
  });
  await track(entry.openRecent("repo"));
  expect(jobs.count).toBe(0);
  expect(m.refresh).toHaveBeenCalledTimes(2);
});

it("does not create a read task for a cancelled picker or non-repository folder", async () => {
  const jobs = useJobsStore();
  const begin = vi.spyOn(jobs, "begin");
  const entry = createWorkspaceOpen((key) => key);
  m.pick.mockResolvedValueOnce(null);
  await track(entry.openFolder());
  expect(begin).not.toHaveBeenCalled();
  m.workspaceOpen.mockResolvedValueOnce(opened("plain folder", false));
  await track(entry.openRecent("plain folder"));
  expect(begin).not.toHaveBeenCalled();
  expect(jobs.count).toBe(0);
  expect(m.refresh).not.toHaveBeenCalled();
});
