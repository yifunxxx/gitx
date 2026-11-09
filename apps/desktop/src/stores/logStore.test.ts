import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useLogStore } from "./logStore";

const mocks = vi.hoisted(() => ({
  backend: {
    logQuery: vi.fn(),
    logLocate: vi.fn(),
    logCommitDetails: vi.fn(),
    logChangedFiles: vi.fn(),
    logIndexStatus: vi.fn(),
  },
  ws: {} as { repoPath: string | null; repoId: string | null; isRepo: boolean; navigationToken: () => number },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));
const commit = (sha: string) => ({
  sha,
  shortSha: sha,
  parents: [],
  refs: [],
  subject: sha,
  author: "QA",
  authorEmail: "qa@example.invalid",
  authorTime: 1,
  graph: { lane: 0, edges: [], color: 0 },
});
const details = (sha: string, subject = sha) => ({
  ...commit(sha),
  subject,
  body: "",
  committer: "QA",
  committerEmail: "qa@example.invalid",
  commitTime: 1,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.ws = reactive({ repoPath: "A", repoId: "A", isRepo: true, navigationToken: () => 0 });
  mocks.backend.logChangedFiles.mockResolvedValue([]);
  mocks.backend.logCommitDetails.mockImplementation(async ({ sha }) => details(sha));
  mocks.backend.logIndexStatus.mockResolvedValue(null);
});

describe("log request lifetime and selection", () => {
  it("retains selections beyond the backend page limit during background refresh", async () => {
    const log = useLogStore();
    const rows = Array.from({ length: 1200 }, (_, i) => commit(String(i)));
    log.commits = rows;
    await log.select("1150");
    mocks.backend.logQuery.mockImplementation(async ({ offset, limit }) => ({
      commits: rows.slice(offset, offset + limit),
      nextOffset: Math.min(rows.length, offset + limit),
      truncated: offset + limit < rows.length,
    }));
    await log.load(true, true);
    expect(log.commits).toHaveLength(1200);
    expect(log.selectedSha).toBe("1150");
    expect(log.details?.sha).toBe("1150");
    expect(mocks.backend.logQuery).toHaveBeenCalledTimes(2);
    expect(mocks.backend.logQuery.mock.calls[1]![0]).toMatchObject({ offset: 1000, limit: 200 });
  });
  it("preserves loaded history, selected range and details on background refresh", async () => {
    const log = useLogStore();
    const rows = Array.from({ length: 150 }, (_, i) => commit(String(i)));
    log.commits = rows;
    await log.select("120");
    await log.select("123", false, true);
    const selected = [...log.selectedShas];
    const oldDetails = log.details;
    mocks.backend.logQuery.mockResolvedValue({ commits: rows, truncated: false, nextOffset: 150 });
    const request = log.load(true, true);
    expect(log.loading).toBe(false);
    await request;
    expect(mocks.backend.logQuery).toHaveBeenCalledWith(expect.objectContaining({ limit: 150 }));
    expect(log.selectedShas).toEqual(selected);
    expect(log.details).toBe(oldDetails);
  });
  it("rejects a late page after switching repositories even without another load", async () => {
    const pending = deferred<unknown>();
    mocks.backend.logQuery.mockReturnValue(pending.promise);
    const log = useLogStore();
    const request = log.load();
    mocks.ws.repoPath = "B";
    pending.resolve({ commits: [commit("old")], truncated: false, nextOffset: 1 });
    await request;
    expect(log.commits).toEqual([]);
    expect(log.loading).toBe(false);
  });

  it("rejects an old A response after A → B → A selection", async () => {
    const pending = deferred<unknown>();
    mocks.backend.logCommitDetails.mockReturnValueOnce(pending.promise);
    const log = useLogStore();
    const first = log.select("A");
    await log.select("B");
    await log.select("A");
    pending.resolve(details("A", "stale"));
    await first;
    expect(log.details?.subject).toBe("A");
  });

  it("never shows old details with a new selected commit", async () => {
    const log = useLogStore();
    await log.select("A");
    const pending = deferred<unknown>();
    mocks.backend.logCommitDetails.mockReturnValueOnce(pending.promise);
    const selection = log.select("B");
    expect(log.details).toBeNull();
    pending.resolve(details("B"));
    await selection;
    expect(log.details?.sha).toBe("B");
  });

  it("supports a range and more than two selected commits; deselection updates focus", async () => {
    const log = useLogStore();
    log.commits = ["a", "b", "c", "d"].map(commit);
    await log.select("a");
    await log.select("c", false, true);
    expect(log.selectedShas).toEqual(["a", "b", "c"]);
    await log.select("d", true);
    expect(log.selectedShas).toHaveLength(4);
    await log.select("d", true);
    expect(log.selectedSha).toBe("c");
  });

  it("locates a distant commit in a bounded window with unchanged filters and both paging directions", async () => {
    const log = useLogStore();
    log.setTextFilter("match");
    log.setRevisions(["main", "feature"]);
    const filters = { ...log.filters };
    const rows = Array.from({ length: 11000 }, (_, i) => commit(String(i)));
    mocks.backend.logLocate.mockResolvedValue({ sha: "10000", offset: 10000 });
    mocks.backend.logQuery.mockImplementation(async ({ offset, limit }) => ({
      commits: rows.slice(offset, offset + limit),
      truncated: offset + limit < rows.length,
      nextOffset: offset + limit,
    }));
    log.goToInput = "feature/search";
    await log.goToHashOrRef();
    expect(mocks.backend.logLocate).toHaveBeenCalledWith({
      path: "A",
      revision: "feature/search",
      filters,
    });
    expect(mocks.backend.logQuery).toHaveBeenCalledTimes(1);
    expect(mocks.backend.logQuery.mock.calls[0]![0]).toMatchObject({
      offset: 9950,
      limit: 150,
      filters,
    });
    expect(log.filters).toEqual(filters);
    expect(log.selectedSha).toBe("10000");
    expect(log.commits).toHaveLength(150);
    await log.loadPrevious();
    expect(log.startOffset).toBe(9850);
    expect(log.commits[0]!.sha).toBe("9850");
    await log.loadMore();
    expect(log.commits.at(-1)!.sha).toBe("10199");
    expect(log.selectedSha).toBe("10000");
  });

  it("reports a filtered-out target without replacing history, and only clears filters explicitly", async () => {
    const log = useLogStore();
    log.commits = [commit("visible")];
    await log.select("visible");
    log.setTextFilter("match");
    mocks.backend.logLocate.mockResolvedValueOnce({ sha: "hidden", offset: null });
    await log.goToHashOrRef("hidden");
    expect(log.navigationMiss).toBe("hidden");
    expect(log.filters.text).toBe("match");
    expect(log.selectedSha).toBe("visible");
    expect(mocks.backend.logQuery).not.toHaveBeenCalled();
    mocks.backend.logLocate.mockResolvedValueOnce({ sha: "hidden", offset: 0 });
    mocks.backend.logQuery.mockResolvedValue({
      commits: [commit("hidden"), commit("visible")],
      truncated: false,
      nextOffset: 2,
    });
    await log.revealNavigationTarget();
    expect(log.filters.text).toBeNull();
    expect(log.selectedSha).toBe("hidden");
    expect(log.navigationMiss).toBeNull();
  });

  it("resolves even loaded abbreviations through Git instead of picking an ambiguous prefix", async () => {
    const log = useLogStore();
    log.commits = [commit("abcdef123")];
    await log.select("abcdef123");
    mocks.backend.logLocate.mockRejectedValue(new Error("ambiguous revision"));
    await expect(log.goToHashOrRef("abcdef")).rejects.toThrow("ambiguous");
    expect(log.locating).toBe(false);
    expect(log.commits).toHaveLength(1);
    expect(log.selectedSha).toBe("abcdef123");
  });

  it("discards a delayed navigation after repository A → B → A", async () => {
    const log = useLogStore();
    const pending = deferred<unknown>();
    mocks.backend.logLocate.mockReturnValue(pending.promise);
    const navigation = log.goToHashOrRef("old");
    mocks.ws.repoPath = "B";
    mocks.ws.repoPath = "A";
    pending.resolve({ sha: "old", offset: 900 });
    await navigation;
    expect(log.commits).toEqual([]);
    expect(log.locating).toBe(false);
    expect(mocks.backend.logQuery).not.toHaveBeenCalled();
  });

  it("does not override a selection made while navigation is loading", async () => {
    const log = useLogStore();
    const pending = deferred<unknown>();
    mocks.backend.logLocate.mockReturnValue(pending.promise);
    const navigation = log.goToHashOrRef("old");
    await log.select("new");
    pending.resolve({ sha: "old", offset: 900 });
    await navigation;
    expect(log.selectedSha).toBe("new");
    expect(mocks.backend.logQuery).not.toHaveBeenCalled();
  });

  it("discards a delayed target page when filters change", async () => {
    const log = useLogStore();
    const pending = deferred<unknown>();
    mocks.backend.logLocate.mockResolvedValue({ sha: "target", offset: 10000 });
    mocks.backend.logQuery.mockReturnValue(pending.promise);
    const navigation = log.goToHashOrRef("target");
    await Promise.resolve();
    log.setTextFilter("new query");
    pending.resolve({ commits: [commit("target")], truncated: false, nextOffset: 10001 });
    await navigation;
    expect(log.commits).toEqual([]);
    expect(log.locating).toBe(false);
  });

  it("refreshes a distant window around its anchor when new commits shift its offset", async () => {
    const log = useLogStore();
    log.startOffset = 9000;
    log.commits = [commit("anchor"), commit("selected")];
    await log.select("selected");
    mocks.backend.logLocate.mockResolvedValue({ sha: "anchor", offset: 9001 });
    mocks.backend.logQuery.mockResolvedValue({
      commits: [commit("anchor"), commit("selected")],
      truncated: false,
      nextOffset: 9003,
    });
    await log.load(true, true);
    expect(mocks.backend.logQuery.mock.calls[0]![0].offset).toBe(9001);
    expect(log.startOffset).toBe(9001);
    expect(log.selectedSha).toBe("selected");
  });
});
