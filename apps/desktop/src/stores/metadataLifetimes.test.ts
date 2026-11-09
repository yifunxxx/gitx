import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useChangesStore } from "./changesStore";
import { useBranchesStore } from "./branchesStore";
import type { ChangelistsState, RefEntry, RefsList } from "@/lib/backend";

const mocks = vi.hoisted(() => ({
  ws: {} as { repoPath: string; repoId: string; gitDir: string; isRepo: boolean; navigationToken: () => number },
  settings: { settings: { stagingMode: false } },
  backend: {
    refsList: vi.fn(),
    remoteList: vi.fn(),
    favoritesSet: vi.fn(),
    favoritesToggle: vi.fn(),
    changelistList: vi.fn(),
    changelistCreate: vi.fn(),
    changelistMove: vi.fn(),
    changelistSetActive: vi.fn(),
  },
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const lists = (name: string): ChangelistsState => ({
  lists: [{ id: name, name, comment: "", active: true }],
  assignments: [],
});
const branch = (name: string, saved: Set<string>): RefEntry => ({
  name,
  fullName: `refs/heads/${name}`,
  kind: "localBranch",
  sha: "a",
  upstream: null,
  ahead: null,
  behind: null,
  isHead: false,
  subject: "",
  committerTime: 0,
  peeledSha: null,
  isFavorite: saved.has(`refs/heads/${name}`),
});
const refs = (saved: Set<string>): RefsList => ({
  local: [branch("one", saved), branch("two", saved)],
  remote: [],
  tags: [],
  recent: [],
  current: "one",
  detached: false,
});

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.ws = reactive({ navigationToken: () => 0, repoPath: "A", repoId: "A", gitDir: "A/.git", isRepo: true });
  mocks.settings.settings = reactive({ stagingMode: false });
  mocks.backend.remoteList.mockResolvedValue([]);
});

async function favoriteFixture() {
  const saved = new Set<string>(["refs/heads/hidden"]);
  const gate = deferred<void>();
  mocks.backend.refsList.mockImplementation(async () => refs(saved));
  mocks.backend.favoritesSet.mockImplementation(async ({ favorites }: { favorites: string[] }) => {
    await gate.promise;
    saved.clear();
    for (const name of favorites) saved.add(name);
  });
  mocks.backend.favoritesToggle.mockImplementation(async ({ fullName }: { fullName: string }) => {
    await gate.promise;
    if (saved.has(fullName)) saved.delete(fullName);
    else saved.add(fullName);
  });
  const store = useBranchesStore();
  await store.refresh();
  return { saved, gate, store };
}

it("preserves two quick favorite toggles and favorites absent from the current ref view", async () => {
  const { saved, gate, store } = await favoriteFixture();
  const first = store.toggleFavorite(store.refs!.local[0]!);
  const second = store.toggleFavorite(store.refs!.local[1]!);
  gate.resolve();
  await Promise.all([first, second]);
  expect([...saved].sort()).toEqual(["refs/heads/hidden", "refs/heads/one", "refs/heads/two"]);
  expect(store.refs!.local.every((r) => r.isFavorite)).toBe(true);
});

it("applies two quick toggles of one star as two changes", async () => {
  const { saved, gate, store } = await favoriteFixture();
  const entry = store.refs!.local[0]!;
  const first = store.toggleFavorite(entry);
  const second = store.toggleFavorite(entry);
  gate.resolve();
  await Promise.all([first, second]);
  expect(saved.has(entry.fullName)).toBe(false);
  expect(store.refs!.local[0]!.isFavorite).toBe(false);
});

it("does not refresh a different repository when a favorite write finishes", async () => {
  const { gate, store } = await favoriteFixture();
  const pending = store.toggleFavorite(store.refs!.local[0]!);
  mocks.ws.repoPath = "B";
  mocks.backend.refsList.mockClear();
  gate.resolve();
  await pending;
  expect(mocks.backend.refsList).not.toHaveBeenCalled();
  expect(store.refs).toBeNull();
});

it("shows favorite save errors and permits a retry without unhandled rejections", async () => {
  const { gate, store, saved } = await favoriteFixture();
  gate.resolve();
  mocks.backend.favoritesSet.mockRejectedValueOnce(new Error("disk full"));
  mocks.backend.favoritesToggle.mockRejectedValueOnce(new Error("disk full"));
  const first = store.toggleFavorite(store.refs!.local[0]!);
  await expect(first).resolves.toBeUndefined();
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      persistent: true,
      description: expect.stringContaining("disk full"),
    }),
  );
  expect(store.refs!.local[0]!.isFavorite).toBe(false);
  await store.toggleFavorite(store.refs!.local[0]!);
  expect(saved.has("refs/heads/one")).toBe(true);
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

it("ignores a stale ref refresh while optimistic favorite changes are pending", async () => {
  const { gate, store } = await favoriteFixture();
  const old = deferred<RefsList>();
  mocks.backend.refsList.mockReturnValueOnce(old.promise);
  const refresh = store.refresh();
  const save = store.toggleFavorite(store.refs!.local[0]!);
  expect(store.refs!.local[0]!.isFavorite).toBe(true);
  old.resolve(refs(new Set()));
  await refresh;
  expect(store.refs!.local[0]!.isFavorite).toBe(true);
  gate.resolve();
  await save;
  expect(store.loading).toBe(false);
  expect(store.refs!.local[0]!.isFavorite).toBe(true);
});

it("rolls back an optimistic star even if reloading the damaged metadata also fails", async () => {
  const { store } = await favoriteFixture();
  mocks.backend.favoritesToggle.mockRejectedValueOnce(new Error("invalid favorites JSON"));
  mocks.backend.refsList.mockRejectedValueOnce(new Error("invalid favorites JSON"));
  await store.toggleFavorite(store.refs!.local[0]!);
  expect(store.refs!.local[0]!.isFavorite).toBe(false);
  expect(store.error).toContain("invalid favorites JSON");
  expect(mocks.toast).toHaveBeenCalledOnce();
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
