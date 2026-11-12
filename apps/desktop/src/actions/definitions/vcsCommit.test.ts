import { beforeEach, expect, it, vi } from "vitest";
import { registerVcsActions } from "./vcs";
import { getAction } from "../registry";
import type { ActionContext } from "../types";
const m = vi.hoisted(() => ({
  workspace: {} as any,
  changes: {} as any,
  commit: {} as any,
  layout: {} as any,
  toast: vi.fn(),
  load: vi.fn(),
  focusCommitUi: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => m.workspace }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => m.changes }));
vi.mock("@/stores/commitStore", () => ({ useCommitStore: () => m.commit }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => m.layout }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => ({ load: m.load }) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => ({}) }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => ({}) }));
vi.mock("@/features/commit/openChangeDiff", () => ({ openChangeDiff: vi.fn() }));
vi.mock("@/features/commit/focusCommitUi", () => ({ focusCommitUi: m.focusCommitUi }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/composables/useConfirm", () => ({ promptDialog: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({}) }));
const context: ActionContext = {
  repoIds: ["A"],
  source: "shortcut",
  place: "global",
  selection: {},
};
const run = () => getAction("CheckinProject")!.run(context);
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
  m.changes = { stagingMode: true, staged: [{}], checkedPaths: [] };
  m.commit = { message: "draft", amend: false, commit: vi.fn().mockResolvedValue({ sha: "new" }) };
  m.layout = { leftOpen: false, activeBottomTab: "console" };
  registerVcsActions();
});
it("opens Log only after a completed commit and leaves refresh ownership in the store", async () => {
  await run();
  expect(m.focusCommitUi).toHaveBeenCalledOnce();
  expect(m.commit.commit).toHaveBeenCalledOnce();
  expect(m.layout.activeBottomTab).toBe("log");
  expect(m.load).not.toHaveBeenCalled();
});
it("supports checked changelist files without requiring staged files", async () => {
  m.changes.stagingMode = false;
  m.changes.staged = [];
  m.changes.checkedPaths = ["chosen.txt"];
  await run();
  expect(m.focusCommitUi).toHaveBeenCalledOnce();
  expect(m.commit.commit).toHaveBeenCalledOnce();
});
it("focuses the Commit UI before reporting an empty message", async () => {
  m.commit.message = "";
  await run();
  expect(m.focusCommitUi).toHaveBeenCalledOnce();
  expect(m.commit.commit).not.toHaveBeenCalled();
  expect(m.toast).toHaveBeenCalledWith({ title: "Enter a commit message" });
});
it.each(["nothing", "empty message", "blocked", "failure"])(
  "does not switch panels for %s",
  async (reason) => {
    if (reason === "nothing") m.changes.staged = [];
    if (reason === "empty message") m.commit.message = "";
    if (reason === "blocked") m.commit.commit.mockResolvedValue(undefined);
    if (reason === "failure") m.commit.commit.mockRejectedValue(new Error("reported by store"));
    await run();
    expect(m.focusCommitUi).toHaveBeenCalledOnce();
    expect(m.layout.activeBottomTab).toBe("console");
    expect(m.load).not.toHaveBeenCalled();
  },
);
it.each(["navigation", "identity", "unavailable"])(
  "does not switch a newer session's panel after %s",
  async (change) => {
    let resolve!: (value: object) => void;
    m.commit.commit.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = run();
    if (change === "navigation") ++m.workspace.navigation;
    if (change === "identity") m.workspace.repoId = "new identity";
    if (change === "unavailable") m.workspace.isRepo = false;
    resolve({ sha: "old" });
    await pending;
    expect(m.layout.activeBottomTab).toBe("console");
    expect(m.load).not.toHaveBeenCalled();
  },
);
