import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useDiffStore } from "./diffStore";

const mocks = vi.hoisted(() => ({ diffFile: vi.fn(), diffFileAt: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("./workspaceStore", () => ({
  useWorkspaceStore: () => ({ repoPath: "repo", repoId: "repo" }),
}));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => ({ activeEditorKind: "welcome" }) }));

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  const result = {
    path: "new.txt",
    leftText: null,
    rightText: null,
    hunks: [],
    binary: false,
    tooLarge: false,
  };
  mocks.diffFile.mockResolvedValue(result);
  mocks.diffFileAt.mockResolvedValue(result);
});

it("keeps the original staged path when expanding and changing whitespace settings", async () => {
  const store = useDiffStore();
  await store.openFileDiff("new.txt", "head", "index", { leftPath: "旧 name.txt" });
  const id = store.activeId!;
  expect(mocks.diffFile).not.toHaveBeenCalled();
  expect(mocks.diffFileAt).toHaveBeenLastCalledWith(
    expect.objectContaining({
      filePath: "new.txt",
      leftPath: "旧 name.txt",
      leftRev: "HEAD",
      rightRev: "INDEX",
      includeTexts: false,
    }),
  );
  await store.setCollapseUnchanged(id, false);
  expect(mocks.diffFileAt).toHaveBeenLastCalledWith(
    expect.objectContaining({
      leftPath: "旧 name.txt",
      includeTexts: true,
    }),
  );
  await store.setIgnoreWhitespace(id, "all");
  expect(mocks.diffFileAt).toHaveBeenLastCalledWith(
    expect.objectContaining({
      leftPath: "旧 name.txt",
      ignoreWhitespace: "all",
      includeTexts: true,
    }),
  );
  expect(store.tabs[0]).toMatchObject({ left: "head", right: "index", kind: "file" });
});

it("does not reuse a cached comparison with a different original path", async () => {
  const store = useDiffStore();
  await store.openFileDiff("new.txt", "head", "index");
  const normal = store.activeId;
  await store.openFileDiff("new.txt", "head", "index", { leftPath: "first.txt" });
  const first = store.activeId;
  await store.openFileDiff("new.txt", "head", "index", { leftPath: "second.txt" });
  expect(new Set([normal, first, store.activeId]).size).toBe(3);
  expect(mocks.diffFileAt).toHaveBeenLastCalledWith(
    expect.objectContaining({ leftPath: "second.txt" }),
  );
});

it("retains a historical rename's original path on a later refresh", async () => {
  const store = useDiffStore();
  await store.openRevDiff("new.txt", "before", "after", "original.txt");
  await store.setCollapseUnchanged(store.activeId!, false);
  expect(mocks.diffFileAt).toHaveBeenLastCalledWith(
    expect.objectContaining({
      leftPath: "original.txt",
      leftRev: "before",
      rightRev: "after",
      includeTexts: true,
    }),
  );
});
