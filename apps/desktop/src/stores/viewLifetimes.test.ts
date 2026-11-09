import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive, watchEffect } from "vue";
import { useHistoryStore } from "./historyStore";
import { useRepoAtRevStore } from "./repoAtRevStore";
import { useDiffStore } from "./diffStore";
import type { DiffFileResult } from "@/lib/backend";

const mocks = vi.hoisted(() => ({
  backend: {
    fileHistory: vi.fn(),
    diffFileAt: vi.fn(),
    treeList: vi.fn(),
    blobRead: vi.fn(),
    diffFile: vi.fn(),
  },
  ws: {} as { repoPath: string | null; repoId: string | null },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => ({ activeEditorKind: "welcome" }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function diff(text: string): DiffFileResult {
  return {
    path: "file.txt",
    leftLabel: "HEAD",
    rightLabel: "worktree",
    leftText: "old",
    rightText: text,
    binary: false,
    tooLarge: false,
    encoding: "utf-8",
    eolMismatch: false,
    hunks: [
      {
        index: 0,
        header: "@@ -1 +1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ["-old", `+${text}`],
      },
    ],
  };
}
const entry = (path: string) => ({
  path,
  name: path,
  kind: "blob",
  mode: "100644",
  size: 3,
  sha: "a",
});
const commit = (sha: string) => ({
  sha,
  shortSha: sha,
  parents: [],
  subject: sha,
  author: "QA",
  authorEmail: "qa@example.invalid",
  authorTime: 1,
  pathAtCommit: "file.txt",
  status: "A",
  origPath: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.ws = reactive({ repoPath: "A", repoId: "A" });
  mocks.backend.diffFileAt.mockResolvedValue(diff("new"));
  mocks.backend.fileHistory.mockResolvedValue({
    commits: [commit("root")],
    truncated: false,
    nextOffset: 1,
  });
  mocks.backend.treeList.mockResolvedValue([]);
});

describe("history and revision browsing", () => {
  it("publishes the first asynchronous history load to reactive consumers and compares a root with EMPTY", async () => {
    const history = useHistoryStore();
    let rendered = "";
    const stop = watchEffect(() => {
      rendered = history.tabs[0]?.commits[0]?.subject ?? "";
    });
    await history.openFileHistory("file.txt");
    await nextTick();
    expect(rendered).toBe("root");
    expect(history.tabs[0]?.loading).toBe(false);
    expect(mocks.backend.diffFileAt).toHaveBeenCalledWith(
      expect.objectContaining({ leftRev: "EMPTY" }),
    );
    stop();
  });

  it("does not replace a newer selection with a late diff, including A → B → A", async () => {
    const history = useHistoryStore();
    await history.openFileHistory("file.txt");
    const tab = history.tabs[0]!;
    const old = deferred<DiffFileResult>();
    mocks.backend.diffFileAt.mockReturnValueOnce(old.promise);
    const pending = history.select(tab, "a");
    expect(tab.diff).toBeNull();
    await history.select(tab, "b");
    await history.select(tab, "a");
    old.resolve(diff("old"));
    await pending;
    expect(tab.diff?.rightText).toBe("new");
  });

  it("never starts a diff against another repository after an old history load resolves", async () => {
    const history = useHistoryStore();
    const old = deferred<unknown>();
    mocks.backend.fileHistory.mockReturnValueOnce(old.promise);
    const pending = history.openFileHistory("file.txt");
    mocks.ws.repoPath = "B";
    old.resolve({ commits: [commit("old")], truncated: false, nextOffset: 1 });
    await pending;
    expect(history.tabs).toEqual([]);
    expect(mocks.backend.diffFileAt).not.toHaveBeenCalled();
  });

  it("publishes the first revision tree load and ignores an obsolete directory response", async () => {
    const browser = useRepoAtRevStore();
    mocks.backend.treeList.mockResolvedValueOnce([entry("root.txt")]);
    let rendered = "";
    const stop = watchEffect(() => {
      rendered = browser.tabs[0]?.entries[0]?.path ?? "";
    });
    await browser.open("HEAD");
    await nextTick();
    expect(rendered).toBe("root.txt");
    const tab = browser.tabs[0]!;
    const old = deferred<unknown>();
    mocks.backend.treeList.mockReturnValueOnce(old.promise);
    const pending = browser.loadDir(tab, "old");
    mocks.backend.treeList.mockResolvedValueOnce([entry("new/file.txt")]);
    await browser.loadDir(tab, "new");
    old.resolve([entry("old/file.txt")]);
    await pending;
    expect(tab.dir).toBe("new");
    expect(tab.entries[0]?.path).toBe("new/file.txt");
    stop();
  });

  it("clears an old blob when navigating and reports blob errors without rejecting the UI event", async () => {
    const browser = useRepoAtRevStore();
    await browser.open("HEAD");
    const tab = browser.tabs[0]!;
    const old = deferred<unknown>();
    mocks.backend.blobRead.mockReturnValueOnce(old.promise);
    const pending = browser.openEntry(tab, entry("old.txt"));
    await browser.loadDir(tab, "new");
    old.resolve({ text: "stale" });
    await pending;
    expect(tab.blob).toBeNull();
    mocks.backend.blobRead.mockRejectedValueOnce(new Error("missing object"));
    await browser.openEntry(tab, entry("missing.txt"));
    expect(tab.error).toContain("missing object");
  });
});

describe("diff cache lifetime", () => {
  it("updates a soft refresh when contents change but sizes and hunk headers are equal", async () => {
    const store = useDiffStore();
    mocks.backend.diffFile.mockResolvedValueOnce(diff("one"));
    await store.openFileDiff("file.txt");
    mocks.backend.diffFile.mockResolvedValueOnce(diff("two"));
    await store.reloadTab(store.activeId!, { soft: true });
    expect(store.tabs[0]?.result?.rightText).toBe("two");
    expect(mocks.backend.diffFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeTexts: true }),
    );
  });

  it("rejects a response from a closed tab after the same file is reopened", async () => {
    const store = useDiffStore();
    const old = deferred<DiffFileResult>();
    mocks.backend.diffFile.mockReturnValueOnce(old.promise);
    const pending = store.openFileDiff("file.txt");
    store.closeTab(store.activeId!);
    mocks.backend.diffFile.mockResolvedValueOnce(diff("new"));
    await store.openFileDiff("file.txt");
    old.resolve(diff("old"));
    await pending;
    expect(store.tabs[0]?.result?.rightText).toBe("new");
  });

  it("rejects a response across repository switches and clears cached content", async () => {
    const store = useDiffStore();
    const old = deferred<DiffFileResult>();
    mocks.backend.diffFile.mockReturnValueOnce(old.promise);
    const pending = store.openFileDiff("file.txt");
    mocks.ws.repoPath = "B";
    expect(store.tabs).toEqual([]);
    mocks.ws.repoPath = "A";
    mocks.backend.diffFile.mockResolvedValueOnce(diff("new"));
    await store.openFileDiff("file.txt");
    old.resolve(diff("old"));
    await pending;
    expect(store.tabs[0]?.result?.rightText).toBe("new");
  });

  it("keeps the renamed original path when loading full text later", async () => {
    const store = useDiffStore();
    mocks.backend.diffFileAt.mockResolvedValue({ ...diff("new"), leftText: null, rightText: null });
    await store.openRevDiff("new.txt", "a", "b", "old.txt");
    await store.setCollapseUnchanged(store.activeId!, false);
    expect(mocks.backend.diffFileAt).toHaveBeenLastCalledWith(
      expect.objectContaining({ leftPath: "old.txt", includeTexts: true }),
    );
  });
});
