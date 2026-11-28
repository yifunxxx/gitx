import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { reactive } from "vue";
import { useLogStore } from "./logStore";
import { useJobsStore } from "./jobsStore";

const m = vi.hoisted(() => ({
  ws: {} as any,
  backend: {
    logCommitDetails: vi.fn(),
    logChangedFiles: vi.fn(),
    logQuery: vi.fn(),
    logIndexStatus: vi.fn(),
  },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => m.ws }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const row = (sha: string) => ({ sha, subject: sha, refs: [], parents: [] }) as any;
let pinia: Pinia;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  m.ws = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  });
  m.backend.logCommitDetails.mockImplementation(async ({ sha }) => row(sha));
  m.backend.logChangedFiles.mockResolvedValue([]);
  m.backend.logIndexStatus.mockResolvedValue(null);
});
afterEach(() => disposePinia(pinia));

it("shows loading until both details and changed files arrive, then clears the task", async () => {
  const pending = deferred();
  m.backend.logChangedFiles.mockReturnValueOnce(pending.promise);
  const log = useLogStore();
  const request = log.select("a");
  const busy = log.detailsLoading;
  await vi.waitFor(() => expect(m.backend.logChangedFiles).toHaveBeenCalledOnce());
  const tasks = useJobsStore().count;
  const oldDetails = log.details;
  pending.resolve([]);
  await request;
  expect(busy).toBe(true);
  expect(tasks).toBe(1);
  expect(oldDetails).toBeNull();
  expect(log.detailsLoading).toBe(false);
  expect(log.detailsError).toBeNull();
  expect(log.details?.sha).toBe("a");
  expect(log.changedFiles).toEqual([]);
  await vi.waitFor(() => expect(useJobsStore().count).toBe(0));
});

it.each(["logCommitDetails", "logChangedFiles"] as const)(
  "keeps an actionable error when %s fails",
  async (method) => {
    m.backend[method].mockRejectedValueOnce(new Error("object unavailable"));
    const log = useLogStore();
    await expect(log.select("a")).rejects.toThrow("object unavailable");
    expect(log.selectedSha).toBe("a");
    expect(log.details).toBeNull();
    expect(log.changedFiles).toEqual([]);
    expect(log.detailsLoading).toBe(false);
    expect(log.detailsError).toBe("object unavailable");
  },
);

it("retries the focused commit without collapsing multi-selection or moving its range anchor", async () => {
  const log = useLogStore();
  log.commits = ["a", "b", "c"].map(row);
  await log.select("a");
  m.backend.logChangedFiles.mockRejectedValueOnce(new Error("read failed"));
  await expect(log.select("b", false, true)).rejects.toThrow("read failed");
  await log.retryDetails();
  expect(log.selectedShas).toEqual(["a", "b"]);
  expect(log.selectedSha).toBe("b");
  expect(log.details?.sha).toBe("b");
  expect(log.detailsError).toBeNull();
  await log.select("c", false, true);
  expect(log.selectedShas).toEqual(["a", "b", "c"]);
});

it("ignores repeated retries while the current details request is pending", async () => {
  const log = useLogStore();
  m.backend.logCommitDetails.mockRejectedValueOnce(new Error("failed"));
  await expect(log.select("a")).rejects.toThrow();
  const pending = deferred();
  m.backend.logCommitDetails.mockReturnValueOnce(pending.promise);
  const retry = log.retryDetails();
  await log.retryDetails();
  const busy = log.detailsLoading;
  const error = log.detailsError;
  pending.resolve(row("a"));
  await retry;
  expect(m.backend.logCommitDetails).toHaveBeenCalledTimes(2);
  expect(busy).toBe(true);
  expect(error).toBeNull();
});

it.each([false, true])(
  "keeps a newer selection busy when an old request finishes (failure: %s)",
  async (failure) => {
    const a = deferred(),
      b = deferred();
    m.backend.logCommitDetails.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const log = useLogStore();
    const first = log.select("a");
    const second = log.select("b");
    if (failure) a.reject(new Error("old error"));
    else a.resolve(row("a"));
    await first;
    const busy = log.detailsLoading;
    const error = log.detailsError;
    b.resolve(row("b"));
    await second;
    expect(busy).toBe(true);
    expect(error).toBeNull();
    expect(log.details?.sha).toBe("b");
  },
);

it("clears pending feedback immediately when navigation starts without changing the path", async () => {
  const pending = deferred();
  m.backend.logCommitDetails.mockReturnValueOnce(pending.promise);
  const log = useLogStore();
  const request = log.select("a");
  m.ws.generation++;
  const busy = log.detailsLoading;
  pending.reject(new Error("old navigation"));
  await request;
  expect(busy).toBe(false);
  expect(log.detailsError).toBeNull();
  expect(log.details).toBeNull();
});

it("clears feedback on deselection while outstanding work finishes independently", async () => {
  const pending = deferred();
  m.backend.logCommitDetails.mockReturnValueOnce(pending.promise);
  const log = useLogStore();
  const request = log.select("a");
  await log.select("a", true);
  const busy = log.detailsLoading;
  pending.resolve(row("a"));
  await request;
  expect(log.selectedSha).toBeNull();
  expect(busy).toBe(false);
  expect(log.detailsError).toBeNull();
  expect(log.details).toBeNull();
});

it("invalidates feedback on an explicit history reload", async () => {
  const pending = deferred();
  m.backend.logCommitDetails.mockReturnValueOnce(pending.promise);
  m.backend.logQuery.mockResolvedValueOnce({ commits: [], truncated: false, nextOffset: 0 });
  const log = useLogStore();
  const request = log.select("a");
  await log.load();
  const busy = log.detailsLoading;
  pending.resolve(row("a"));
  await request;
  expect(busy).toBe(false);
  expect(log.details).toBeNull();
});

it("keeps the task until both backend calls settle even if the UI already reports failure", async () => {
  const pending = deferred();
  m.backend.logCommitDetails.mockRejectedValueOnce(new Error("bad object"));
  m.backend.logChangedFiles.mockReturnValueOnce(pending.promise);
  const log = useLogStore();
  await expect(log.select("a")).rejects.toThrow("bad object");
  const tasks = useJobsStore().count;
  pending.resolve([]);
  await vi.waitFor(() => expect(useJobsStore().count).toBe(0));
  expect(tasks).toBe(1);
  expect(log.detailsError).toBe("bad object");
});

it("ignores disposed requests and refuses later retries", async () => {
  const pending = deferred();
  m.backend.logCommitDetails.mockReturnValueOnce(pending.promise);
  const log = useLogStore();
  const request = log.select("a");
  log.$dispose();
  pending.resolve(row("a"));
  await request;
  await log.retryDetails();
  expect(log.details).toBeNull();
  expect(log.detailsLoading).toBe(false);
  expect(m.backend.logCommitDetails).toHaveBeenCalledOnce();
});
