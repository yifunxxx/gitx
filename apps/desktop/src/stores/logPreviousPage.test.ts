import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { reactive } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useLogStore } from "./logStore";
import { useJobsStore } from "./jobsStore";
import type { LogCommit, LogPage } from "@/lib/backend";

const mocks = vi.hoisted(() => ({
  backend: {
    logQuery: vi.fn(),
    logLocate: vi.fn(),
    logCommitDetails: vi.fn(),
    logChangedFiles: vi.fn(),
  },
  toast: vi.fn(),
}));
let workspace: ReturnType<typeof makeWorkspace>;
const makeWorkspace = () =>
  reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  });
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => workspace }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));

const row = (sha: string): LogCommit => ({
  sha,
  shortSha: sha,
  subject: sha,
  parents: [],
  refs: [],
  author: "QA",
  authorEmail: "qa@example.invalid",
  authorTime: 1,
  graph: { lane: 0, edges: [], color: 0 },
});
const initial = Array.from({ length: 400 }, (_, i) => row(String(i)));
let history: LogCommit[];
let pinia: Pinia;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function query({ offset, limit }: { offset: number; limit: number }): LogPage {
  return {
    commits: history.slice(offset, offset + limit),
    nextOffset: Math.min(history.length, offset + limit),
    truncated: offset + limit < history.length,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  workspace = makeWorkspace();
  history = [...initial];
  mocks.backend.logQuery.mockImplementation(async (request) => query(request));
  mocks.backend.logLocate.mockImplementation(async ({ revision }) => {
    const offset = history.findIndex((c) => c.sha === revision);
    return { sha: revision, offset: offset < 0 ? null : offset };
  });
  mocks.backend.logCommitDetails.mockResolvedValue(null);
  mocks.backend.logChangedFiles.mockResolvedValue([]);
});
afterEach(() => disposePinia(pinia));

async function distantWindow() {
  const log = useLogStore();
  await log.goToHashOrRef("250");
  await flushPromises();
  expect(log.startOffset).toBe(200);
  expect(useJobsStore().running).toEqual([]);
  mocks.backend.logQuery.mockClear();
  mocks.backend.logLocate.mockClear();
  return log;
}

it.each(["insert", "remove", "replace", "empty"])(
  "keeps the window and paging offsets when history changes during the read: %s",
  async (change) => {
    const log = await distantWindow();
    const before = log.commits;
    const location = deferred<{ sha: string; offset: number }>();
    mocks.backend.logLocate.mockReturnValueOnce(location.promise);
    const request = log.loadPrevious();
    if (change === "insert") history.unshift(row("new"));
    else if (change === "remove") history.shift();
    else if (change === "replace") history[200] = row("replacement");
    else history = [];
    location.resolve({ sha: "200", offset: 200 });
    await request;
    expect(log.commits).toBe(before);
    expect(log.startOffset).toBe(200);
    expect(log.selectedSha).toBe("250");
    expect(log.loadingPrevious).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "log.historyChanged" }),
    );
    expect(useJobsStore().running).toEqual([]);
    // The rejected read must not change the offset used by older pagination.
    history = [...initial];
    mocks.backend.logQuery.mockClear();
    await log.loadMore();
    expect(mocks.backend.logQuery.mock.calls[0]![0]).toMatchObject({ offset: 349 });
  },
);

it("retries against the new history without dropping a boundary commit or moving selection", async () => {
  const log = await distantWindow();
  const location = deferred<{ sha: string; offset: number }>();
  mocks.backend.logLocate.mockReturnValueOnce(location.promise);
  const request = log.loadPrevious();
  history.unshift(row("new"));
  location.resolve({ sha: "200", offset: 200 });
  await request;
  await log.loadPrevious();
  expect(log.commits.map((c) => c.sha)).toEqual(initial.slice(100, 350).map((c) => c.sha));
  expect(log.startOffset).toBe(101);
  expect(log.selectedSha).toBe("250");
  expect(log.selectedShas).toEqual(["250"]);
  await log.loadMore();
  expect(log.commits.map((c) => c.sha)).toEqual(initial.slice(100).map((c) => c.sha));
});

it("reads a stable boundary even when the anchor has moved to the first position", async () => {
  const log = await distantWindow();
  history = initial.slice(200);
  await log.loadPrevious();
  expect(log.startOffset).toBe(0);
  expect(mocks.backend.logQuery).toHaveBeenCalledWith(
    expect.objectContaining({ offset: 0, limit: 1 }),
  );
  mocks.backend.logQuery.mockClear();
  await log.loadMore();
  expect(mocks.backend.logQuery.mock.calls[0]![0]).toMatchObject({ offset: 149 });
  expect(log.commits.map((c) => c.sha)).toEqual(initial.slice(200).map((c) => c.sha));
});

it("does not hide newer history when new commits arrive after locating the anchor at zero", async () => {
  const log = await distantWindow();
  const before = log.commits;
  history = [row("new"), ...initial.slice(200)];
  mocks.backend.logLocate.mockResolvedValueOnce({ sha: "200", offset: 0 });
  await log.loadPrevious();
  expect(log.startOffset).toBe(200);
  expect(log.commits).toBe(before);
  expect(mocks.toast).toHaveBeenCalledOnce();
});

it("owns one task through both reads and deduplicates clicks until the page settles", async () => {
  const log = await distantWindow();
  const location = deferred<{ sha: string; offset: number }>();
  const page = deferred<LogPage>();
  mocks.backend.logLocate.mockReturnValueOnce(location.promise);
  mocks.backend.logQuery.mockReturnValueOnce(page.promise);
  const request = log.loadPrevious();
  expect(log.loadingPrevious).toBe(true);
  expect(useJobsStore().running).toEqual([
    expect.objectContaining({ message: "A", cancellable: false }),
  ]);
  const taskId = useJobsStore().running[0]!.id;
  await log.loadPrevious();
  expect(mocks.backend.logLocate).toHaveBeenCalledOnce();
  location.resolve({ sha: "200", offset: 200 });
  await flushPromises();
  expect(useJobsStore().running.map((j) => j.id)).toEqual([taskId]);
  page.resolve(query(mocks.backend.logQuery.mock.lastCall![0]));
  await request;
  expect(log.commits.map((c) => c.sha)).toEqual(initial.slice(100, 350).map((c) => c.sha));
  expect(log.loadingPrevious).toBe(false);
  expect(useJobsStore().running).toEqual([]);
});

it.each(["locate", "page"])("ends the task after a %s error and allows retry", async (stage) => {
  const log = await distantWindow();
  const before = log.commits;
  const pending = deferred<never>();
  if (stage === "locate") mocks.backend.logLocate.mockReturnValueOnce(pending.promise);
  else mocks.backend.logQuery.mockReturnValueOnce(pending.promise);
  const request = log.loadPrevious();
  await flushPromises();
  expect(useJobsStore().count).toBe(1);
  pending.reject(new Error("read failed"));
  await request;
  expect(log.commits).toBe(before);
  expect(log.startOffset).toBe(200);
  expect(useJobsStore().count).toBe(0);
  expect(log.loadingPrevious).toBe(false);
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "read failed" }));
  await log.loadPrevious();
  expect(log.startOffset).toBe(100);
});

it.each(["navigate", "same-path", "filter", "dispose"])(
  "ignores a late page after %s while retaining its task until the actual read settles",
  async (change) => {
    const log = await distantWindow();
    const pending = deferred<LogPage>();
    mocks.backend.logQuery.mockReturnValueOnce(pending.promise);
    const request = log.loadPrevious();
    await flushPromises();
    if (change === "navigate") {
      workspace.repoPath = "B";
      workspace.generation++;
    } else if (change === "same-path") workspace.generation++;
    else if (change === "filter") log.setTextFilter("new");
    else log.$dispose();
    const retained = log.commits;
    const offset = log.startOffset;
    expect(useJobsStore().count).toBe(1);
    pending.resolve(query(mocks.backend.logQuery.mock.lastCall![0]));
    await request;
    expect(log.commits).toBe(retained);
    expect(log.startOffset).toBe(offset);
    expect(useJobsStore().count).toBe(0);
    expect(mocks.toast).not.toHaveBeenCalled();
  },
);

it("does not start reads or tasks after store disposal", async () => {
  const log = await distantWindow();
  log.$dispose();
  await log.loadPrevious();
  expect(mocks.backend.logLocate).not.toHaveBeenCalled();
  expect(mocks.backend.logQuery).not.toHaveBeenCalled();
  expect(useJobsStore().count).toBe(0);
});

it("preserves the current window when its anchor no longer exists", async () => {
  const log = await distantWindow();
  const before = log.commits;
  mocks.backend.logLocate.mockResolvedValueOnce({ sha: "200", offset: null });
  await log.loadPrevious();
  expect(log.commits).toBe(before);
  expect(log.startOffset).toBe(200);
  expect(mocks.backend.logQuery).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledOnce();
  expect(log.loadingPrevious).toBe(false);
  expect(useJobsStore().count).toBe(0);
});

it.each(["navigate", "filter", "dispose"])("silences late failures after %s", async (change) => {
  const log = await distantWindow();
  const pending = deferred<never>();
  mocks.backend.logQuery.mockReturnValueOnce(pending.promise);
  const request = log.loadPrevious();
  await flushPromises();
  if (change === "navigate") workspace.generation++;
  else if (change === "filter") log.setTextFilter("new");
  else log.$dispose();
  pending.reject(new Error("obsolete failure"));
  await request;
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(useJobsStore().count).toBe(0);
});

it("does not let a superseded page finish the replacement operation's task or spinner", async () => {
  const log = await distantWindow();
  const first = deferred<LogPage>();
  const second = deferred<LogPage>();
  mocks.backend.logQuery.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const oldRequest = log.loadPrevious();
  await flushPromises();
  log.setTextFilter("new");
  const currentRequest = log.loadPrevious();
  await flushPromises();
  expect(useJobsStore().count).toBe(2);
  first.resolve(query({ offset: 100, limit: 101 }));
  await oldRequest;
  expect(useJobsStore().count).toBe(1);
  expect(log.loadingPrevious).toBe(true);
  expect(log.startOffset).toBe(200);
  second.resolve(query({ offset: 100, limit: 101 }));
  await currentRequest;
  expect(useJobsStore().count).toBe(0);
  expect(log.loadingPrevious).toBe(false);
  expect(log.startOffset).toBe(100);
});

it("does not read or create a task when already at the newest commit", async () => {
  const log = useLogStore();
  log.commits = initial.slice(0, 100);
  await log.loadPrevious();
  expect(mocks.backend.logLocate).not.toHaveBeenCalled();
  expect(mocks.backend.logQuery).not.toHaveBeenCalled();
  expect(useJobsStore().count).toBe(0);
});
