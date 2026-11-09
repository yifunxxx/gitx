import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
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
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.ws = reactive({ repoPath: "A", repoId: "A" });
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
