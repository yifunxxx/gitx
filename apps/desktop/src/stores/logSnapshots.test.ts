import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import type { CommitDetails, LogCommit, LogPage } from "@/lib/backend";
import { useLogStore } from "./logStore";

const mocks = vi.hoisted(() => ({
  backend: {
    logQuery: vi.fn(),
    logCommitDetails: vi.fn(),
    logChangedFiles: vi.fn(),
    logIndexStatus: vi.fn(),
  },
  ws: {} as { repoPath: string; repoId: string; isRepo: boolean; navigationToken: () => number },
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));

const commit = (sha: string, parents: string[] = []): LogCommit => ({
  sha,
  shortSha: sha.slice(0, 7),
  parents,
  refs: [],
  subject: sha,
  author: "Before",
  authorEmail: "before@example.invalid",
  authorTime: 1,
  graph: { lane: 0, color: 0, edges: [] },
});
const details = (row: LogCommit): CommitDetails => ({
  ...row,
  body: "",
  committer: "QA",
  committerEmail: "qa@example.invalid",
  committerTime: 1,
});
const page = (rows: LogCommit[]): LogPage => ({
  commits: rows,
  nextOffset: rows.length,
  truncated: false,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};
let pinia: ReturnType<typeof createPinia>;
let rows: LogCommit[];
let response: LogCommit[];
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.ws = reactive({ repoPath: "A", repoId: "A", isRepo: true, navigationToken: () => 1 });
  rows = [
    commit("tip", ["left", "right"]),
    commit("right", ["base"]),
    commit("left", ["base"]),
    commit("base"),
  ];
  response = structuredClone(rows);
  mocks.backend.logQuery.mockImplementation(async () => page(structuredClone(response)));
  mocks.backend.logCommitDetails.mockImplementation(async ({ sha }) =>
    details(response.find((row) => row.sha === sha)!),
  );
  mocks.backend.logChangedFiles.mockResolvedValue([]);
  mocks.backend.logIndexStatus.mockResolvedValue(null);
});
afterEach(() => disposePinia(pinia));
async function ready() {
  const log = useLogStore();
  log.commits = rows;
  await log.select("tip");
  mocks.backend.logCommitDetails.mockClear();
  mocks.backend.logChangedFiles.mockClear();
  return log;
}

describe.each([true, false])("Log snapshot publication (background=%s)", (background) => {
  it.each([
    ["parent order", { parents: ["right", "left"] }],
    ["parent addition", { parents: ["left", "right", "base"] }],
    ["parent removal", { parents: ["left"] }],
    ["author", { author: "After" }],
    ["author email", { authorEmail: "after@example.invalid" }],
    ["short SHA", { shortSha: "tip-long" }],
  ] satisfies [string, Partial<LogCommit>][])(
    "publishes changed %s with an unchanged SHA",
    async (_label, patch) => {
      const log = await ready();
      Object.assign(response[0]!, patch);
      await log.load(true, background);
      await flushPromises();
      expect(log.commits[0]).toMatchObject(patch);
      expect(log.commits).not.toBe(rows);
      if ("shortSha" in patch) expect(log.details?.sha).toBe("tip");
      else expect(log.details).toMatchObject(patch);
      expect(mocks.backend.logCommitDetails).toHaveBeenCalledExactlyOnceWith({
        path: "A",
        sha: "tip",
      });
      expect(mocks.backend.logChangedFiles).toHaveBeenCalledExactlyOnceWith({
        path: "A",
        sha: "tip",
      });
    },
  );
});

it("retains identical rows and details without starting redundant reads", async () => {
  const log = await ready();
  const previous = log.details;
  await log.load(true, true);
  expect(log.commits).toBe(rows);
  expect(log.details).toBe(previous);
  expect(mocks.backend.logCommitDetails).not.toHaveBeenCalled();
});

it.each(["refs", "other row"])(
  "publishes %s changes without reloading selected details",
  async (kind) => {
    const log = await ready();
    const previous = log.details;
    if (kind === "refs") response[0]!.refs = ["new-tag"];
    else response[1]!.author = "Changed elsewhere";
    await log.load(true, true);
    expect(log.commits).toEqual(response);
    expect(log.details).toBe(previous);
    expect(mocks.backend.logCommitDetails).not.toHaveBeenCalled();
  },
);

it("refreshes the current selected commit and retains the multi-selection anchor", async () => {
  const log = await ready();
  await log.select("base");
  await log.select("right", false, true);
  response[1]!.parents = [];
  await log.load(true, true);
  await flushPromises();
  expect(log.details?.parents).toEqual([]);
  expect(log.selectedSha).toBe("right");
  expect(log.selectedShas).toEqual(["right", "left", "base"]);
  await log.select("left", false, true);
  expect(log.selectedShas).toEqual(["left", "base"]);
});

it("keeps the list usable while updated details and changed files are pending", async () => {
  const log = await ready();
  const pending = deferred<CommitDetails>();
  const files = deferred<[]>();
  mocks.backend.logCommitDetails.mockReturnValueOnce(pending.promise);
  mocks.backend.logChangedFiles.mockReturnValueOnce(files.promise);
  response[0]!.author = "After";
  await log.load(true, true);
  expect(log.loading).toBe(false);
  expect(log.detailsLoading).toBe(true);
  expect(log.details).toBeNull();
  expect(log.changedFiles).toEqual([]);
  pending.resolve(details(response[0]!));
  await flushPromises();
  expect(log.detailsLoading).toBe(true);
  files.resolve([]);
  await flushPromises();
  expect(log.detailsLoading).toBe(false);
  expect(log.details?.author).toBe("After");
});

it("supersedes an already pending read for the replaced commit", async () => {
  const log = await ready();
  const old = deferred<CommitDetails>();
  mocks.backend.logCommitDetails.mockReturnValueOnce(old.promise);
  const selection = log.select("tip");
  await flushPromises();
  response[0]!.author = "After";
  await log.load(true, true);
  await flushPromises();
  expect(log.details?.author).toBe("After");
  old.resolve(details(rows[0]!));
  await selection;
  expect(log.details?.author).toBe("After");
});

it.each(["selection", "repository", "dispose"])(
  "ignores delayed refresh details after %s changes",
  async (change) => {
    const log = await ready();
    const pending = deferred<CommitDetails>();
    mocks.backend.logCommitDetails.mockReturnValueOnce(pending.promise);
    response[0]!.author = "After";
    await log.load(true, true);
    expect(log.detailsLoading).toBe(true);
    if (change === "selection") await log.select("right");
    else if (change === "repository") mocks.ws.repoPath = "B";
    else log.$dispose();
    const current = log.details;
    pending.resolve(details(response[0]!));
    await flushPromises();
    expect(log.details).toBe(current);
    expect(log.detailsLoading).toBe(false);
  },
);

it("reports refreshed details failure and retries without collapsing a range", async () => {
  const log = await ready();
  await log.select("base");
  await log.select("tip", false, true);
  mocks.backend.logChangedFiles.mockRejectedValueOnce(new Error("replacement files unavailable"));
  response[0]!.parents.reverse();
  await log.load(true, true);
  await flushPromises();
  expect(log.detailsError).toBe("replacement files unavailable");
  expect(log.details).toBeNull();
  expect(log.loading).toBe(false);
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  await log.retryDetails();
  expect(log.detailsError).toBeNull();
  expect(log.details?.parents).toEqual(["right", "left"]);
  expect(log.selectedShas).toEqual(["tip", "right", "left", "base"]);
});
