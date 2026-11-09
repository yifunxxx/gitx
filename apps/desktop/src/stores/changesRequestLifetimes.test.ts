import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useChangesStore } from "./changesStore";
import type { ChangelistsState } from "@/lib/backend";
const mocks = vi.hoisted(() => ({
  ws: {} as any, settings: {} as any,
  backend: { statusGet: vi.fn(), changelistList: vi.fn(), changelistCreate: vi.fn(),
    changelistMove: vi.fn(), changelistSetActive: vi.fn() },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
function deferred<T = any>() {
  let resolve!: (value?: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a as typeof resolve; reject = b; });
  return { promise, resolve, reject };
}
const lists = (name: string): ChangelistsState => ({
  lists: [{ id: name, name, comment: "", active: true }], assignments: [],
});
const snapshot = (version: number, name: string) => ({ version, files: [], branch: { name } });
beforeEach(() => {
  vi.resetAllMocks(); setActivePinia(createPinia());
  mocks.ws = reactive({ repoPath: "A", repoId: "A", isRepo: true, generation: 1,
    navigationToken() { return this.generation; }, setBranch: vi.fn() });
  mocks.settings = reactive({ settings: { stagingMode: false }, load: vi.fn() });
  mocks.backend.changelistList.mockResolvedValue(lists("default"));
});

it.each(["create", "move", "active"])(
  "discards late %s changelist results after A → B → A navigation",
  async (kind) => {
    const completion = deferred<ChangelistsState>();
    mocks.backend.changelistCreate.mockReturnValue(completion.promise);
    mocks.backend.changelistMove.mockReturnValue(completion.promise);
    mocks.backend.changelistSetActive.mockReturnValue(completion.promise);
    const store = useChangesStore();
    const pending =
      kind === "create"
        ? store.createChangelist("old")
        : kind === "move"
          ? store.moveToChangelist(["file"], "old")
          : store.setActiveChangelist("old");
    await vi.waitFor(() =>
      expect(
        mocks.backend.changelistCreate.mock.calls.length +
          mocks.backend.changelistMove.mock.calls.length +
          mocks.backend.changelistSetActive.mock.calls.length,
      ).toBe(1),
    );
    mocks.ws.repoPath = "B";
    mocks.ws.repoPath = "A";
    store.changelists = lists("current");
    completion.resolve(lists("old"));
    await pending;
    expect(store.changelists).toEqual(lists("current"));
  },
);

it("prevents an older changelist read from overwriting a successful mutation", async () => {
  const read = deferred<ChangelistsState>();
  mocks.backend.changelistList.mockReturnValue(read.promise);
  mocks.backend.changelistCreate.mockResolvedValue(lists("new"));
  const store = useChangesStore();
  const pending = store.refreshChangelists();
  await store.createChangelist("new");
  read.resolve(lists("old"));
  await pending;
  expect(store.changelists).toEqual(lists("new"));
});

it("ignores old changelist load failures after navigation", async () => {
  const read = deferred<ChangelistsState>();
  mocks.backend.changelistList.mockReturnValue(read.promise);
  const store = useChangesStore();
  const pending = store.refreshChangelists();
  mocks.ws.repoPath = "B";
  read.reject(new Error("old repository unavailable"));
  await pending;
  expect(store.error).toBeNull();
});

it("serializes changelist mutations in user order and recovers after a failed request", async () => {
  const first = deferred<ChangelistsState>();
  mocks.backend.changelistSetActive
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(lists("second"));
  const store = useChangesStore();
  const a = store.setActiveChangelist("first");
  const rejected = a.catch(() => null);
  const b = store.setActiveChangelist("second");
  await vi.waitFor(() => expect(mocks.backend.changelistSetActive).toHaveBeenCalled());
  const callsBeforeRelease = mocks.backend.changelistSetActive.mock.calls.length;
  first.reject(new Error("save failed"));
  await Promise.all([rejected, b]);
  expect(callsBeforeRelease).toBe(1);
  expect(store.changelists).toEqual(lists("second"));
});

it("cancels queued changelist writes after navigation without blocking the new repository", async () => {
  const first = deferred<ChangelistsState>();
  mocks.backend.changelistCreate
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(lists("B-new"));
  mocks.backend.changelistMove.mockResolvedValue(lists("old-move"));
  const store = useChangesStore();
  const a = store.createChangelist("A-new");
  const move = store.moveToChangelist(["file"], "old-list");
  await vi.waitFor(() => expect(mocks.backend.changelistCreate).toHaveBeenCalledOnce());
  mocks.ws.repoPath = "B";
  await store.createChangelist("B-new");
  expect(store.changelists).toEqual(lists("B-new"));
  first.resolve(lists("A-new"));
  await Promise.all([a, move]);
  expect(mocks.backend.changelistMove).not.toHaveBeenCalled();
  expect(store.changelists).toEqual(lists("B-new"));
});

it("does not reintroduce changelists when staging mode is enabled during a read", async () => {
  const read = deferred<ChangelistsState>();
  mocks.backend.changelistList.mockReturnValue(read.promise);
  const store = useChangesStore();
  const pending = store.refreshChangelists();
  mocks.settings.settings.stagingMode = true;
  read.resolve(lists("old"));
  await pending;
  expect(store.changelists).toBeNull();
});

it.each([false, true])("ignores old status after navigation (path unchanged: %s)", async (unchanged) => {
  const pending = deferred(); mocks.backend.statusGet.mockReturnValueOnce(pending.promise);
  const store = useChangesStore(); const request = store.refresh();
  if (!unchanged) { mocks.ws.repoPath = "B"; mocks.ws.repoPath = "A"; }
  mocks.ws.generation++;
  pending.resolve(snapshot(10, "old")); await request;
  expect(store.snapshot).toBeNull(); expect(store.loading).toBe(false);
  expect(mocks.ws.setBranch).not.toHaveBeenCalled();
});

it("accepts a new repository's lower status version and clears old selection", async () => {
  mocks.backend.statusGet.mockResolvedValueOnce(snapshot(100, "A"));
  const store = useChangesStore(); await store.refresh();
  store.selectedPaths = ["A.txt"]; store.checkedPaths = ["A.txt"];
  mocks.ws.repoPath = "B"; mocks.ws.repoId = "B"; mocks.ws.generation++;
  expect(store.selectedPaths).toEqual([]); expect(store.checkedPaths).toEqual([]);
  mocks.backend.statusGet.mockResolvedValueOnce(snapshot(1, "B"));
  await store.refresh(); expect(store.snapshot?.branch).toEqual({ name: "B" });
});

it.each([false, true])("does not restart an obsolete refresh after settings load (navigation: %s)", async (navigate) => {
  mocks.settings.settings = null;
  const settings = deferred(); mocks.settings.load.mockReturnValueOnce(settings.promise);
  const store = useChangesStore(); const first = store.refresh();
  if (navigate) { mocks.ws.repoPath = "B"; mocks.ws.repoId = "B"; mocks.ws.generation++; }
  mocks.settings.settings = { stagingMode: false };
  mocks.backend.statusGet.mockResolvedValue(snapshot(1, "new"));
  await store.refresh(); settings.resolve(); await first;
  expect(mocks.backend.statusGet).toHaveBeenCalledOnce();
  expect(store.snapshot?.branch).toEqual({ name: "new" });
});

it("does not apply an old changelist read after a new navigation starts", async () => {
  const pending = deferred(); mocks.backend.changelistList.mockReturnValueOnce(pending.promise);
  const store = useChangesStore(); const first = store.refreshChangelists();
  mocks.ws.generation++;
  pending.resolve(lists("old")); await first; expect(store.changelists).toBeNull();
});

it("cancels obsolete queued writes and releases read suppression even if navigation keeps the path", async () => {
  const first = deferred(); mocks.backend.changelistCreate.mockReturnValueOnce(first.promise);
  const store = useChangesStore(); const a = store.createChangelist("old");
  const b = store.moveToChangelist(["old.txt"], "old");
  await vi.waitFor(() => expect(mocks.backend.changelistCreate).toHaveBeenCalledOnce());
  mocks.ws.generation++;
  first.resolve(lists("old")); await Promise.all([a,b]);
  expect(mocks.backend.changelistMove).not.toHaveBeenCalled();
  expect(store.changelists).toBeNull();
  mocks.backend.changelistList.mockResolvedValueOnce(lists("current"));
  await store.refreshChangelists(); expect(store.changelists).toEqual(lists("current"));
});
