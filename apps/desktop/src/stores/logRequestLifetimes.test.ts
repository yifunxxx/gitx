import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useLogStore } from "./logStore";

const mocks = vi.hoisted(() => ({
  ws: {} as any,
  backend: {
    logQuery: vi.fn(), logCommitDetails: vi.fn(), logChangedFiles: vi.fn(),
    logIndexStatus: vi.fn(), logIndexRebuild: vi.fn(),
  },
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const row = (sha: string) => ({ sha, refs: [], subject: sha } as any);
const page = (sha: string) => ({ commits: [row(sha)], truncated: false, nextOffset: 1 });
beforeEach(() => {
  vi.resetAllMocks(); setActivePinia(createPinia());
  mocks.ws = reactive({ repoPath: "A", repoId: "A", isRepo: true, generation: 1,
    navigationToken() { return this.generation; } });
  mocks.backend.logCommitDetails.mockImplementation(async ({ sha }) => row(sha));
  mocks.backend.logChangedFiles.mockResolvedValue([]);
  mocks.backend.logIndexStatus.mockResolvedValue(null);
});

it.each(["B", "A"]) ("rejects a late page after navigating away and returning to %s", async (destination) => {
  const pending = deferred(); mocks.backend.logQuery.mockReturnValueOnce(pending.promise);
  const store = useLogStore(); const request = store.load();
  mocks.ws.repoPath = "B"; mocks.ws.generation++;
  mocks.ws.repoPath = destination; mocks.ws.generation++;
  pending.resolve(page("old")); await request;
  expect(store.commits).toEqual([]);
  expect(store.selectedSha).toBeNull();
  expect(store.loading).toBe(false);
  expect(mocks.backend.logCommitDetails).not.toHaveBeenCalled();
});

it("ignores a response once a newer navigation starts before its path changes", async () => {
  const pending = deferred(); mocks.backend.logQuery.mockReturnValueOnce(pending.promise);
  const store = useLogStore(); const request = store.load();
  mocks.ws.generation++;
  pending.resolve(page("old")); await request;
  expect(store.commits).toEqual([]);
  expect(store.loading).toBe(false);
});

it("does not append a page for filters edited while it was loading", async () => {
  const store = useLogStore(); store.commits = [row("visible")]; store.truncated = true;
  const pending = deferred(); mocks.backend.logQuery.mockReturnValueOnce(pending.promise);
  const request = store.loadMore(); store.setTextFilter("new query");
  pending.resolve(page("old")); await request;
  expect(store.commits.map((c) => c.sha)).toEqual(["visible"]);
  expect(store.loadingMore).toBe(false);
});

it("does not let an older A selection replace details after A → B → A", async () => {
  const pending = deferred(); mocks.backend.logCommitDetails.mockReturnValueOnce(pending.promise);
  const store = useLogStore(); const first = store.select("a");
  await store.select("b"); await store.select("a");
  pending.resolve({ ...row("a"), subject: "old subject" }); await first;
  expect(store.details?.subject).toBe("a");
});

it("clears obsolete details immediately when the selected commit changes", async () => {
  const store = useLogStore(); await store.select("a");
  const pending = deferred(); mocks.backend.logCommitDetails.mockReturnValueOnce(pending.promise);
  const request = store.select("b");
  expect(store.details).toBeNull(); expect(store.changedFiles).toEqual([]);
  pending.resolve(row("b")); await request; expect(store.details?.sha).toBe("b");
});

it("keeps an obsolete selection failure from erasing current details", async () => {
  const pending = deferred(); mocks.backend.logCommitDetails.mockReturnValueOnce(pending.promise);
  const store = useLogStore(); const first = store.select("a");
  await store.select("b"); await store.select("a");
  pending.reject(new Error("old failure")); await expect(first).resolves.toBeUndefined();
  expect(store.details?.sha).toBe("a");
});

it("clears all rows and details when leaving a repository", async () => {
  const store = useLogStore(); store.commits = [row("a")]; await store.select("a");
  mocks.ws.repoPath = null; mocks.ws.repoId = null; mocks.ws.isRepo = false; mocks.ws.generation++;
  await store.load();
  expect(store.commits).toEqual([]); expect(store.details).toBeNull();
  expect(store.selectedSha).toBeNull(); expect(store.selectedShas).toEqual([]);
});

it("keeps index state from a newer status response", async () => {
  const pending = deferred(); mocks.backend.logIndexStatus.mockReturnValueOnce(pending.promise);
  const store = useLogStore(); const first = store.refreshIndexStatus();
  mocks.backend.logIndexStatus.mockResolvedValueOnce({ indexed: 9 }); await store.refreshIndexStatus();
  pending.resolve({ indexed: 1 }); await first;
  expect(store.indexStatus).toEqual({ indexed: 9 });
});

it.each([false, true])("ignores obsolete index rebuild completion (failure: %s)", async (failure) => {
  const pending = deferred(); mocks.backend.logIndexRebuild.mockReturnValueOnce(pending.promise);
  const store = useLogStore(); const first = store.rebuildIndex();
  mocks.ws.generation++;
  if (failure) pending.reject(new Error("old rebuild failure")); else pending.resolve({ indexed: 4 });
  await first;
  expect(store.indexStatus).toBeNull(); expect(mocks.toast).not.toHaveBeenCalled();
});
