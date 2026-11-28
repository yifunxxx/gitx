import { beforeEach, expect, it, vi } from "vitest";
import { registerVcsActions } from "./vcs";
import { getAction, isEnabled } from "../registry";
import type { ActionContext } from "../types";

const m = vi.hoisted(() => ({
  workspace: {} as any,
  changes: {} as any,
  toast: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => m.workspace }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => m.changes }));
vi.mock("@/stores/commitStore", () => ({ useCommitStore: () => ({}) }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({}) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({}) }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => ({}) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => ({}) }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => ({}) }));
vi.mock("@/features/commit/openChangeDiff", () => ({ openChangeDiff: vi.fn() }));
vi.mock("@/features/commit/focusCommitUi", () => ({ focusCommitUi: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/composables/useConfirm", () => ({ promptDialog: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({}) }));

const context: ActionContext = {
  repoIds: ["A"],
  source: "shortcut",
  place: "changes",
  selection: {},
};
const run = () => getAction("Git.Add")!.run(context);
const enabled = () => isEnabled(getAction("Git.Add")!, context);

beforeEach(() => {
  vi.resetAllMocks();
  m.workspace = {
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    navigation: 1,
    navigationToken() {
      return this.navigation;
    },
  };
  m.changes = {
    stagingMode: false,
    selectedPaths: [],
    selectedSection: null,
    checkedPaths: [],
    unversioned: ["a.txt", "b.txt", "c.txt"].map((path) => ({ path })),
    add: vi.fn().mockResolvedValue(undefined),
  };
  registerVcsActions();
});

it("adds checked unversioned files without requiring a highlighted row", async () => {
  m.changes.checkedPaths = ["a.txt", "b.txt"];
  expect(enabled()).toBe(true);
  await run();
  expect(m.changes.add).toHaveBeenCalledExactlyOnceWith(["a.txt", "b.txt"]);
  expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "2" }));
});

it("uses checked files when the single highlighted unversioned row is checked", async () => {
  m.changes.selectedSection = "unversioned";
  m.changes.selectedPaths = ["b.txt"];
  m.changes.checkedPaths = ["a.txt", "b.txt"];
  await run();
  expect(m.changes.add).toHaveBeenCalledExactlyOnceWith(["a.txt", "b.txt"]);
});

it("prefers an explicit row multiselection over different checked files", async () => {
  m.changes.selectedSection = "unversioned";
  m.changes.selectedPaths = ["a.txt", "b.txt"];
  m.changes.checkedPaths = ["b.txt", "c.txt"];
  await run();
  expect(m.changes.add).toHaveBeenCalledExactlyOnceWith(["a.txt", "b.txt"]);
});

it("adds only the single unchecked highlighted file", async () => {
  m.changes.selectedSection = "unversioned";
  m.changes.selectedPaths = ["c.txt"];
  m.changes.checkedPaths = ["a.txt", "b.txt"];
  await run();
  expect(m.changes.add).toHaveBeenCalledExactlyOnceWith(["c.txt"]);
});

it("filters stale and tracked checked paths without using a tracked row selection", async () => {
  m.changes.selectedSection = "changelist:default";
  m.changes.selectedPaths = ["tracked.txt"];
  m.changes.checkedPaths = ["tracked.txt", "a.txt", "a.txt", "removed.txt", "b.txt"];
  await run();
  expect(m.changes.add).toHaveBeenCalledExactlyOnceWith(["a.txt", "b.txt"]);
});

it("filters and deduplicates stale paths in a highlighted unversioned selection", async () => {
  m.changes.selectedSection = "unversioned";
  m.changes.selectedPaths = ["a.txt", "a.txt", "gone.txt", "b.txt"];
  await run();
  expect(m.changes.add).toHaveBeenCalledExactlyOnceWith(["a.txt", "b.txt"]);
});

it("ignores hidden commit checks in staging mode while keeping row multiselection", async () => {
  m.changes.stagingMode = true;
  m.changes.selectedSection = "unversioned";
  m.changes.selectedPaths = ["a.txt", "b.txt"];
  m.changes.checkedPaths = ["b.txt", "c.txt"];
  await run();
  expect(m.changes.add).toHaveBeenCalledExactlyOnceWith(["a.txt", "b.txt"]);
});

it.each(["empty", "tracked", "stale", "hidden checks"])(
  "disables Add and performs no write for %s targets",
  async (kind) => {
    if (kind === "tracked") {
      m.changes.selectedSection = "changelist:default";
      m.changes.selectedPaths = ["tracked.txt"];
      m.changes.checkedPaths = ["tracked.txt"];
    }
    if (kind === "stale") {
      m.changes.selectedSection = "unversioned";
      m.changes.selectedPaths = ["gone.txt"];
      m.changes.checkedPaths = ["gone.txt"];
    }
    if (kind === "hidden checks") {
      m.changes.stagingMode = true;
      m.changes.checkedPaths = ["a.txt", "b.txt"];
    }
    expect(enabled()).toBe(false);
    await run();
    expect(m.changes.add).not.toHaveBeenCalled();
    expect(m.toast).not.toHaveBeenCalled();
  },
);

it("does not announce successful addition after a failed write", async () => {
  m.changes.selectedSection = "unversioned";
  m.changes.selectedPaths = ["a.txt"];
  m.changes.add.mockRejectedValue(new Error("index.lock exists"));
  await expect(run()).rejects.toThrow("index.lock exists");
  expect(m.toast).not.toHaveBeenCalled();
});

it.each(["path", "identity", "navigation", "unavailable"])(
  "does not show the old result after repository %s changes",
  async (kind) => {
    m.changes.selectedSection = "unversioned";
    m.changes.selectedPaths = ["a.txt", "b.txt"];
    let resolve!: () => void;
    m.changes.add.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const pending = run();
    if (kind === "path") m.workspace.repoPath = "B";
    if (kind === "identity") m.workspace.repoId = "B";
    if (kind === "navigation") m.workspace.navigation++;
    if (kind === "unavailable") m.workspace.isRepo = false;
    resolve();
    await pending;
    expect(m.changes.add).toHaveBeenCalledExactlyOnceWith(["a.txt", "b.txt"]);
    expect(m.toast).not.toHaveBeenCalled();
  },
);

it("freezes the paths before an asynchronous Add yields", async () => {
  m.changes.selectedSection = "unversioned";
  m.changes.selectedPaths = ["a.txt", "b.txt"];
  let resolve!: () => void;
  m.changes.add.mockReturnValue(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  const pending = run();
  m.changes.selectedPaths.splice(0, 2, "c.txt");
  resolve();
  await pending;
  expect(m.changes.add).toHaveBeenCalledExactlyOnceWith(["a.txt", "b.txt"]);
  expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "2" }));
});
