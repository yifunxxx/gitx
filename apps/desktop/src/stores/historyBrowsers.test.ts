import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { nextTick, reactive, watchEffect } from "vue";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { useHistoryStore } from "./historyStore";
import { useRepoAtRevStore } from "./repoAtRevStore";
import FileHistoryView from "@/features/history/FileHistoryView.vue";
import RepoAtRevisionView from "@/features/history/RepoAtRevisionView.vue";

const m = vi.hoisted(() => ({
  ws: {} as any,
  fileHistory: vi.fn(),
  diffFileAt: vi.fn(),
  treeList: vi.fn(),
  blobRead: vi.fn(),
  openRevDiff: vi.fn(),
  checkoutPathFromRev: vi.fn(),
  confirm: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  layout: { activeEditorKind: "welcome" },
  changes: { error: null as string | null },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => m.ws }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => m.layout }));
vi.mock("./diffStore", () => ({ useDiffStore: () => ({ openRevDiff: m.openRevDiff }) }));
vi.mock("./changesStore", () => ({
  useChangesStore: () => ({
    refresh: m.refresh,
    get error() {
      return m.changes.error;
    },
  }),
}));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: m.confirm }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
enableAutoUnmount(afterEach);
const viewOptions = {
  global: {
    stubs: {
      Splitpanes: { template: "<div><slot /></div>" },
      Pane: { template: "<div><slot /></div>" },
      CodeMirrorDiff: true,
      TextViewport: true,
    },
  },
};

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const commit = (sha = "one", path = "new.txt", parents = ["parent"]) => ({
  sha,
  shortSha: sha,
  parents,
  subject: sha,
  author: "Author",
  authorEmail: "qa@example.test",
  authorTime: 0,
  pathAtCommit: path,
  origPath: null,
  status: "M",
});
const page = (sha = "one", truncated = false, nextOffset = 1) => ({
  commits: [commit(sha)],
  truncated,
  nextOffset,
});
const diff = (path = "new.txt") => ({
  path,
  hunks: [],
  leftText: "before",
  rightText: path,
  binary: false,
  tooLarge: false,
});
const entry = (path: string, kind = "blob") => ({
  path,
  name: path.split("/").at(-1)!,
  kind,
  mode: "100644",
  sha: "blob-sha",
  size: 1,
});
const blob = (path: string) => ({
  path,
  rev: "rev",
  text: path,
  binary: false,
  tooLarge: false,
  size: path.length,
});
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  pinia = createPinia();
  setActivePinia(pinia);
  m.ws = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    generation: 0,
    navigationToken() {
      return this.generation;
    },
  });
  m.fileHistory.mockResolvedValue(page());
  m.diffFileAt.mockImplementation(async ({ filePath }) => diff(filePath));
  m.treeList.mockResolvedValue([
    entry("one"),
    entry("two"),
    entry("dir", "tree"),
    entry("module", "commit"),
  ]);
  m.blobRead.mockImplementation(async ({ filePath }) => blob(filePath));
  m.confirm.mockResolvedValue(true);
  m.changes.error = null;
});
afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
});

it.each(["history", "tree"])("reactively renders the first %s response", async (kind) => {
  const s = kind === "history" ? useHistoryStore() : useRepoAtRevStore();
  const response = deferred();
  (kind === "history" ? m.fileHistory : m.treeList).mockReturnValueOnce(response.promise);
  const opening =
    kind === "history"
      ? useHistoryStore().openFileHistory("new.txt")
      : useRepoAtRevStore().open("rev");
  let loading: boolean | undefined;
  const stop = watchEffect(() => {
    loading = s.tabs[0]?.loading;
  });
  await nextTick();
  expect(loading).toBe(true);
  response.resolve(kind === "history" ? page() : [entry("one")]);
  await opening;
  await nextTick();
  expect(loading).toBe(false);
  stop();
});

it.each(["path", "identity", "navigation", "notRepo", "dispose"])(
  "invalidates both browsers on %s",
  async (change) => {
    const h = useHistoryStore(),
      r = useRepoAtRevStore();
    const hp = deferred(),
      rp = deferred();
    m.fileHistory.mockReturnValueOnce(hp.promise);
    m.treeList.mockReturnValueOnce(rp.promise);
    const ho = h.openFileHistory("new.txt"),
      ro = r.open("rev");
    const ht = h.tabs[0]!,
      rt = r.tabs[0]!;
    if (change === "path") {
      m.ws.repoPath = "B";
      m.ws.repoPath = "A";
    } else if (change === "identity") m.ws.repoId = "another-A";
    else if (change === "navigation") ++m.ws.generation;
    else if (change === "notRepo") m.ws.isRepo = false;
    else {
      h.$dispose();
      r.$dispose();
    }
    hp.resolve(page());
    rp.resolve([entry("old")]);
    await Promise.all([ho, ro]);
    expect(ht.commits).toEqual([]);
    expect(rt.entries).toEqual([]);
    expect(m.diffFileAt).not.toHaveBeenCalled();
    await h.load(ht, true);
    await h.select(ht, "one");
    await r.loadDir(rt, "old");
    await r.openEntry(rt, entry("one"));
    expect(m.fileHistory).toHaveBeenCalledTimes(1);
    expect(m.treeList).toHaveBeenCalledTimes(1);
    expect(m.blobRead).not.toHaveBeenCalled();
    if (change !== "dispose") {
      expect(h.tabs).toEqual([]);
      expect(r.tabs).toEqual([]);
    }
  },
);

it("does not fill or auto-select a closed history tab after the same file is reopened", async () => {
  const s = useHistoryStore(),
    old = deferred();
  m.fileHistory.mockReturnValueOnce(old.promise);
  const opening = s.openFileHistory("new.txt"),
    previous = s.tabs[0]!;
  s.closeTab(previous.id);
  await s.openFileHistory("new.txt");
  old.resolve(page("stale"));
  await opening;
  expect(previous.commits).toEqual([]);
  expect(s.tabs[0]?.selectedSha).toBe("one");
  expect(m.diffFileAt).toHaveBeenCalledTimes(1);
});

it("keeps only the latest history diff, including error and loading state", async () => {
  const s = useHistoryStore();
  m.fileHistory.mockResolvedValue({
    ...page(),
    commits: [commit("one"), commit("two"), commit("three")],
  });
  await s.openFileHistory("new.txt");
  const tab = s.tabs[0]!;
  const old = deferred(),
    recent = deferred();
  m.diffFileAt.mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
  const first = s.select(tab, "two"),
    second = s.select(tab, "three");
  expect(tab.diff).toBeNull();
  old.reject(new Error("stale diff failure"));
  await first;
  expect(tab.diffError).toBeNull();
  expect(tab.diffLoading).toBe(true);
  recent.resolve(diff("three"));
  await second;
  expect(tab.diff?.path).toBe("three");
  expect(tab.diffLoading).toBe(false);
});

it("exposes history diff errors and retries the same selection", async () => {
  const s = useHistoryStore();
  m.diffFileAt.mockRejectedValueOnce(new Error("diff denied"));
  await s.openFileHistory("new.txt");
  const tab = s.tabs[0]!;
  expect(tab.diffError).toContain("diff denied");
  expect(tab.diffLoading).toBe(false);
  await s.select(tab, "one");
  expect(tab.diffError).toBeNull();
  expect(tab.diff).not.toBeNull();
});

it("deduplicates pagination, retains loaded rows on failure, and retries the same offset", async () => {
  const s = useHistoryStore();
  m.fileHistory.mockResolvedValueOnce(page("one", true, 100));
  await s.openFileHistory("new.txt");
  const tab = s.tabs[0]!,
    pending = deferred();
  m.fileHistory.mockReturnValueOnce(pending.promise);
  const a = s.load(tab, false),
    b = s.load(tab, false);
  expect(m.fileHistory).toHaveBeenCalledTimes(2);
  pending.reject(new Error("page denied"));
  await Promise.all([a, b]);
  expect(tab.commits.map((c) => c.sha)).toEqual(["one"]);
  expect(tab.nextOffset).toBe(100);
  m.fileHistory.mockResolvedValueOnce(page("two", false, 101));
  await s.load(tab, false);
  expect(m.fileHistory).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 100 }));
  expect(tab.commits.map((c) => c.sha)).toEqual(["one", "two"]);
  expect(tab.error).toBeNull();
  await s.load(tab, false);
  expect(m.fileHistory).toHaveBeenCalledTimes(3);
});

it("invalidates pending pages and selections when the history filter resets", async () => {
  const s = useHistoryStore();
  m.fileHistory.mockResolvedValueOnce(page("one", true));
  await s.openFileHistory("new.txt");
  const tab = s.tabs[0]!;
  const older = deferred(),
    latest = deferred();
  m.fileHistory.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise);
  const more = s.load(tab, false),
    reset = s.toggleAllBranches(tab.id);
  expect(tab.commits).toEqual([]);
  expect(tab.diff).toBeNull();
  expect(tab.selectedSha).toBeNull();
  older.resolve(page("old"));
  await more;
  expect(tab.loading).toBe(true);
  expect(tab.commits).toEqual([]);
  latest.resolve(page("all"));
  await reset;
  expect(tab.selectedSha).toBe("all");
});

it("compares a root commit with EMPTY and keeps rename source paths", async () => {
  const s = useHistoryStore();
  m.fileHistory.mockResolvedValueOnce({ ...page(), commits: [commit("root", "old.txt", [])] });
  await s.openFileHistory("new.txt");
  expect(m.diffFileAt).toHaveBeenLastCalledWith(
    expect.objectContaining({ leftRev: "EMPTY", filePath: "old.txt", leftPath: "old.txt" }),
  );
});

it("keeps existing history selection and reuses the right filter tab", async () => {
  const s = useHistoryStore();
  await s.openFileHistory("new.txt");
  const first = s.tabs[0]!;
  await s.openFileHistory("new.txt");
  expect(m.fileHistory).toHaveBeenCalledTimes(1);
  await s.toggleAllBranches(first.id);
  await s.openFileHistory("new.txt", true);
  expect(s.tabs).toHaveLength(1);
  expect(s.tabs[0]?.allBranches).toBe(true);
  expect(m.fileHistory).toHaveBeenCalledTimes(2);
  await s.openFileHistory("new.txt", false);
  expect(s.tabs).toHaveLength(2);
  await s.toggleAllBranches(s.activeId!);
  expect(s.tabs).toHaveLength(2);
  expect(s.activeId).toBe(first.id);
});

it("keeps only the latest directory response and clears the previous file immediately", async () => {
  const s = useRepoAtRevStore();
  await s.open("rev");
  const tab = s.tabs[0]!;
  await s.openEntry(tab, tab.entries[0]!);
  const old = deferred(),
    recent = deferred();
  m.treeList.mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
  const a = s.loadDir(tab, "dir"),
    b = s.loadDir(tab, "other");
  expect(tab.entries).toEqual([]);
  expect(tab.selectedPath).toBeNull();
  expect(tab.blob).toBeNull();
  old.reject(new Error("old dir"));
  await a;
  expect(tab.error).toBeNull();
  expect(tab.loading).toBe(true);
  recent.resolve([entry("other/file")]);
  await b;
  expect(tab.entries[0]?.path).toBe("other/file");
});

it("keeps only the latest blob and retains the directory on file failure", async () => {
  const s = useRepoAtRevStore();
  await s.open("rev");
  const tab = s.tabs[0]!,
    old = deferred(),
    recent = deferred();
  m.blobRead.mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
  const a = s.openEntry(tab, tab.entries[0]!),
    b = s.openEntry(tab, tab.entries[1]!);
  old.resolve(blob("one"));
  await a;
  expect(tab.blob).toBeNull();
  expect(tab.blobLoading).toBe(true);
  recent.reject(new Error("blob denied"));
  await b;
  expect(tab.error).toBeNull();
  expect(tab.entries).toHaveLength(4);
  expect(tab.blobError).toContain("blob denied");
  await s.openEntry(tab, tab.entries[1]!);
  expect(tab.blob?.path).toBe("two");
  expect(tab.blobError).toBeNull();
});

it("rejects old blobs after directory navigation or close/reopen", async () => {
  const s = useRepoAtRevStore();
  await s.open("rev");
  const tab = s.tabs[0]!,
    old = deferred();
  m.blobRead.mockReturnValueOnce(old.promise);
  const pending = s.openEntry(tab, tab.entries[0]!);
  await s.loadDir(tab, "dir");
  s.closeTab(tab.id);
  await s.open("rev");
  old.resolve(blob("one"));
  await pending;
  expect(tab.blob).toBeNull();
  expect(s.tabs[0]?.blob).toBeNull();
});

it("deduplicates repeated file activation and ignores unsupported or stale entries", async () => {
  const s = useRepoAtRevStore();
  await s.open("rev");
  const tab = s.tabs[0]!,
    pending = deferred();
  m.blobRead.mockReturnValueOnce(pending.promise);
  const a = s.openEntry(tab, tab.entries[0]!),
    b = s.openEntry(tab, tab.entries[0]!);
  expect(m.blobRead).toHaveBeenCalledTimes(1);
  pending.resolve(blob("one"));
  await Promise.all([a, b]);
  await s.openEntry(tab, tab.entries[0]!);
  expect(m.blobRead).toHaveBeenCalledTimes(1);
  await s.openEntry(tab, tab.entries[3]!);
  await s.openEntry(tab, entry("not-in-directory"));
  expect(m.blobRead).toHaveBeenCalledTimes(1);
});

it("reopening an existing revision preserves its directory and selected file", async () => {
  const s = useRepoAtRevStore();
  await s.open("rev");
  const tab = s.tabs[0]!;
  m.treeList.mockResolvedValueOnce([entry("dir/file")]);
  await s.loadDir(tab, "dir");
  await s.openEntry(tab, tab.entries[0]!);
  await s.open("rev");
  expect(tab.dir).toBe("dir");
  expect(tab.selectedPath).toBe("dir/file");
  expect(m.treeList).toHaveBeenCalledTimes(2);
});

it("compares local contents with the path before a rename without later stealing focus", async () => {
  const h = useHistoryStore(),
    r = useRepoAtRevStore();
  m.fileHistory.mockResolvedValueOnce({ ...page(), commits: [commit("root", "old.txt", [])] });
  await h.openFileHistory("new.txt");
  const pending = deferred();
  m.openRevDiff.mockReturnValueOnce(pending.promise);
  const work = h.compareLocal(h.tabs[0]!);
  m.layout.activeEditorKind = "file";
  pending.resolve(undefined);
  await work;
  expect(m.openRevDiff).toHaveBeenLastCalledWith("new.txt", "root", "WORKTREE", "old.txt");
  expect(m.layout.activeEditorKind).toBe("file");
  await r.open("rev");
  await r.openEntry(r.tabs[0]!, r.tabs[0]!.entries[0]!);
  await r.compareLocal(r.tabs[0]!);
  expect(m.openRevDiff).toHaveBeenLastCalledWith("one", "rev", "WORKTREE");
  const old = r.tabs[0]!;
  r.closeTab(old.id);
  await r.compareLocal(old);
  await r.showHistory(old);
  await r.restoreFile(old);
  expect(m.openRevDiff).toHaveBeenCalledTimes(2);
  expect(m.fileHistory).toHaveBeenCalledTimes(1);
  expect(m.checkoutPathFromRev).not.toHaveBeenCalled();
});

it("drops pending file and diff responses when the repository session ends", async () => {
  const h = useHistoryStore(),
    r = useRepoAtRevStore();
  const hd = deferred(),
    rb = deferred();
  m.diffFileAt.mockReturnValueOnce(hd.promise);
  const ho = h.openFileHistory("new.txt");
  await nextTick();
  await r.open("rev");
  const ht = h.tabs[0]!,
    rt = r.tabs[0]!;
  m.blobRead.mockReturnValueOnce(rb.promise);
  const ro = r.openEntry(rt, rt.entries[0]!);
  ++m.ws.generation;
  hd.resolve(diff("stale"));
  rb.reject(new Error("stale"));
  await Promise.all([ho, ro]);
  expect(ht.diff).toBeNull();
  expect(rt.blob).toBeNull();
  expect(rt.blobError).toBeNull();
});

it("ignores a queued diff response after a history filter reset", async () => {
  const h = useHistoryStore(),
    pending = deferred();
  m.diffFileAt.mockReturnValueOnce(pending.promise);
  const opening = h.openFileHistory("new.txt");
  await nextTick();
  const tab = h.tabs[0]!;
  m.fileHistory.mockResolvedValueOnce(page("new-filter"));
  await h.toggleAllBranches(tab.id);
  pending.resolve(diff("stale"));
  await opening;
  expect(tab.selectedSha).toBe("new-filter");
  expect(tab.diff?.path).toBe("new.txt");
});

it("retries failed initial directory and history loads", async () => {
  const h = useHistoryStore(),
    r = useRepoAtRevStore();
  m.fileHistory.mockRejectedValueOnce(new Error("history denied"));
  m.treeList.mockRejectedValueOnce(new Error("tree denied"));
  await h.openFileHistory("new.txt");
  await r.open("rev");
  expect(h.tabs[0]?.error).toContain("history denied");
  expect(r.tabs[0]?.error).toContain("tree denied");
  await h.load(h.tabs[0]!, true);
  await r.loadDir(r.tabs[0]!, "");
  expect(h.tabs[0]?.selectedSha).toBe("one");
  expect(r.tabs[0]?.entries).toHaveLength(4);
});

it.each(["cancel", "selection", "directory", "close", "navigation", "dispose", "editor"])(
  "does not restore after %s during confirmation",
  async (change) => {
    const s = useRepoAtRevStore();
    await s.open("rev");
    const tab = s.tabs[0]!;
    await s.openEntry(tab, tab.entries[0]!);
    const pending = deferred<boolean>();
    m.confirm.mockReturnValueOnce(pending.promise);
    const restore = s.restoreFile(tab);
    expect(s.busy).toBe(true);
    await s.restoreFile(tab);
    expect(m.confirm).toHaveBeenCalledTimes(1);
    if (change === "selection") await s.openEntry(tab, tab.entries[1]!);
    else if (change === "directory") await s.loadDir(tab, "dir");
    else if (change === "close") s.closeTab(tab.id);
    else if (change === "navigation") ++m.ws.generation;
    else if (change === "dispose") s.$dispose();
    else if (change === "editor") m.layout.activeEditorKind = "file";
    pending.resolve(change !== "cancel");
    expect(await restore).toBe(false);
    expect(m.checkoutPathFromRev).not.toHaveBeenCalled();
    expect(s.busy).toBe(false);
  },
);

it("holds a restore lock across navigation and never refreshes or notifies the new session", async () => {
  const s = useRepoAtRevStore();
  await s.open("rev");
  const tab = s.tabs[0]!;
  await s.openEntry(tab, tab.entries[0]!);
  const pending = deferred();
  m.checkoutPathFromRev.mockReturnValueOnce(pending.promise);
  const restore = s.restoreFile(tab);
  await nextTick();
  expect(m.checkoutPathFromRev).toHaveBeenCalledWith({
    repoId: "A",
    path: "A",
    rev: "rev",
    filePath: "one",
  });
  ++m.ws.generation;
  await s.open("rev");
  const fresh = s.tabs[0]!;
  await s.openEntry(fresh, fresh.entries[1]!);
  expect(s.busy).toBe(true);
  await s.restoreFile(fresh);
  expect(m.checkoutPathFromRev).toHaveBeenCalledTimes(1);
  pending.resolve(undefined);
  await restore;
  expect(s.busy).toBe(false);
  expect(m.refresh).not.toHaveBeenCalled();
  expect(m.toast).not.toHaveBeenCalled();
});

it("keeps restore failures visible and treats refresh failure as an already successful write", async () => {
  const s = useRepoAtRevStore();
  await s.open("rev");
  const tab = s.tabs[0]!;
  await s.openEntry(tab, tab.entries[0]!);
  m.checkoutPathFromRev.mockRejectedValueOnce(new Error("checkout denied"));
  expect(await s.restoreFile(tab)).toBe(false);
  expect(tab.restoreError).toContain("checkout denied");
  expect(m.refresh).not.toHaveBeenCalled();
  m.changes.error = "status denied";
  expect(await s.restoreFile(tab)).toBe(true);
  expect(tab.restoreError).toBeNull();
  expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "history.restored" }));
  expect(m.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "history.restoreRefreshFailed",
      description: "status denied",
    }),
  );
  expect(m.checkoutPathFromRev).toHaveBeenCalledTimes(2);
});

it("shows history progress and provides independent diff and page retry controls", async () => {
  const s = useHistoryStore(),
    pending = deferred();
  m.fileHistory.mockReturnValueOnce(pending.promise);
  const opening = s.openFileHistory("new.txt"),
    tab = s.tabs[0]!;
  const view = mount(FileHistoryView, { ...viewOptions, props: { tabId: tab.id } });
  expect(view.text()).toContain("common.loading");
  const compare = () =>
    view.findAll("button").find((b) => b.text() === "history.compareWithLocal")!;
  expect(compare().attributes("disabled")).toBeDefined();
  m.diffFileAt.mockRejectedValueOnce(new Error("diff denied"));
  pending.resolve(page("one", true, 100));
  await opening;
  await flushPromises();
  expect(view.text()).toContain("diff denied");
  await view
    .findAll("button")
    .find((b) => b.text() === "history.retry")!
    .trigger("click");
  await flushPromises();
  expect(view.text()).not.toContain("diff denied");
  const next = deferred();
  m.fileHistory.mockReturnValueOnce(next.promise);
  await view
    .findAll("button")
    .find((b) => b.text() === "log.loadMore")!
    .trigger("click");
  expect(
    view
      .findAll("button")
      .find((b) => b.text() === "common.loading")!
      .attributes("disabled"),
  ).toBeDefined();
  next.reject(new Error("page denied"));
  await flushPromises();
  expect(view.text()).toContain("one");
  expect(view.text()).toContain("page denied");
  m.fileHistory.mockResolvedValueOnce(page("two"));
  await view
    .findAll("button")
    .find((b) => b.text() === "history.retry")!
    .trigger("click");
  await flushPromises();
  expect(m.fileHistory).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 100 }));
  expect(view.text()).toContain("two");
});

it("shows file errors without hiding its directory and does not repeat activation on double-click", async () => {
  const s = useRepoAtRevStore();
  await s.open("rev");
  const tab = s.tabs[0]!;
  const view = mount(RepoAtRevisionView, { ...viewOptions, props: { tabId: tab.id } });
  const one = view.findAll("button").find((b) => b.text() === "one")!;
  const pending = deferred();
  m.blobRead.mockReturnValueOnce(pending.promise);
  await one.trigger("click");
  await one.trigger("click");
  await one.trigger("dblclick");
  expect(m.blobRead).toHaveBeenCalledTimes(1);
  expect(view.text()).toContain("common.loading");
  pending.reject(new Error("file denied"));
  await flushPromises();
  expect(view.text()).toContain("file denied");
  expect(view.text()).toContain("two");
  expect(
    view
      .findAll("button")
      .find((b) => b.text() === "module")!
      .attributes("disabled"),
  ).toBeDefined();
  await view
    .findAll("button")
    .find((b) => b.text() === "history.retry")!
    .trigger("click");
  await flushPromises();
  expect(tab.blob?.path).toBe("one");
  expect(view.text()).not.toContain("file denied");
});

it("shows initial history and directory failures with working retries", async () => {
  const h = useHistoryStore(),
    r = useRepoAtRevStore();
  m.fileHistory.mockRejectedValueOnce(new Error("history denied"));
  m.treeList.mockRejectedValueOnce(new Error("tree denied"));
  await h.openFileHistory("new.txt");
  await r.open("rev");
  const history = mount(FileHistoryView, { ...viewOptions, props: { tabId: h.tabs[0]!.id } });
  const tree = mount(RepoAtRevisionView, { ...viewOptions, props: { tabId: r.tabs[0]!.id } });
  expect(history.text()).toContain("history denied");
  expect(tree.text()).toContain("tree denied");
  for (const view of [history, tree])
    await view
      .findAll("button")
      .find((b) => b.text() === "history.retry")!
      .trigger("click");
  await flushPromises();
  expect(history.text()).toContain("one");
  expect(tree.text()).toContain("two");
});

it("labels binary history contents and disables Restore while confirmation is pending", async () => {
  const h = useHistoryStore(),
    r = useRepoAtRevStore();
  m.diffFileAt.mockResolvedValueOnce({ ...diff(), binary: true });
  await h.openFileHistory("binary");
  const history = mount(FileHistoryView, { ...viewOptions, props: { tabId: h.tabs[0]!.id } });
  expect(history.text()).toContain("history.binaryDiff");
  expect(history.text()).not.toContain("diff.noDifferences");
  await r.open("rev");
  await r.openEntry(r.tabs[0]!, r.tabs[0]!.entries[0]!);
  const tree = mount(RepoAtRevisionView, { ...viewOptions, props: { tabId: r.tabs[0]!.id } });
  const pending = deferred();
  m.confirm.mockReturnValueOnce(pending.promise);
  await tree
    .findAll("button")
    .find((b) => b.text() === "history.restore")!
    .trigger("click");
  expect(
    tree
      .findAll("button")
      .find((b) => b.text() === "common.loading")!
      .attributes("disabled"),
  ).toBeDefined();
  pending.resolve(false);
  await flushPromises();
  expect(m.checkoutPathFromRev).not.toHaveBeenCalled();
});
