import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useChangesStore } from "./changesStore";
import { useCommitStore } from "./commitStore";
import type { ChangelistsState, StatusSnapshot } from "@/lib/backend";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  settings: {} as any,
  backend: {
    statusGet: vi.fn(),
    changelistList: vi.fn(),
    changelistMove: vi.fn(),
    commitCreate: vi.fn(),
  },
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("./rewriteStore", () => ({
  useRewriteStore: () => ({ busy: false, refreshOpState: vi.fn() }),
}));
vi.mock("./branchesStore", () => ({ useBranchesStore: () => ({ refresh: vi.fn() }) }));
vi.mock("./logStore", () => ({ useLogStore: () => ({ load: vi.fn() }) }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));

const path = "src/file.txt";
const anchor = (line: number) => ({
  before: [],
  after: [],
  changeHash: String(line),
  oldStart: line,
  oldLines: 1,
  newStart: line,
  newLines: 1,
});
const state = (token = "reviewed"): ChangelistsState => ({
  lists: [
    { id: "default", name: "Changes", comment: "", active: true },
    { id: "other", name: "Other", comment: "", active: false },
  ],
  assignments: [
    { path, listId: "default", hunkRanges: [anchor(1)] },
    { path, listId: "other", hunkRanges: [anchor(30)] },
  ],
  partialFiles: [
    {
      path,
      contentToken: token,
      problem: null,
      previewHunks: [],
      hunks: [
        { index: 0, listId: "default", anchor: anchor(1) },
        { index: 1, listId: "other", anchor: anchor(30) },
      ],
    },
  ],
  warnings: [],
});
const snapshot = (): StatusSnapshot => ({
  repoId: "repo",
  version: 1,
  branch: { head: "main", detached: false, upstream: null, ahead: null, behind: null },
  files: [{ path, kind: "modified", origPath: null, indexStatus: "M", worktreeStatus: "M" }],
});
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.workspace = reactive({
    repoPath: "repo",
    repoId: "repo",
    isRepo: true,
    navigationToken: () => 1,
    setBranch: vi.fn(),
  });
  mocks.settings = reactive({
    settings: { stagingMode: false, git: { allowPerHunkChangelists: true } },
  });
  mocks.backend.statusGet.mockResolvedValue(snapshot());
  mocks.backend.changelistList.mockResolvedValue(state());
  mocks.backend.commitCreate.mockResolvedValue({ sha: "abc", subject: "selected", amended: false });
  const changes = useChangesStore();
  changes.snapshot = snapshot();
  changes.changelists = state();
});
afterEach(() => disposePinia(pinia));

it("groups one file in two lists and keeps each list's checks independent", () => {
  const changes = useChangesStore();
  expect(changes.filesForChangelist("default")).toHaveLength(1);
  expect(changes.filesForChangelist("other")).toHaveLength(1);
  changes.toggleCheckSection("changelist:other");
  expect(changes.checkStateForSection("changelist:default")).toBe("none");
  expect(changes.checkStateForSection("changelist:other")).toBe("all");
  changes.toggleCheckSection("changelist:default");
  changes.uncheckAllInList("other");
  expect(changes.checkedCommitSelection()).toEqual([
    { path, listIds: ["default"], expectedToken: "reviewed" },
  ]);
});

it("does not renew another list's old token when checking after a background update", async () => {
  const changes = useChangesStore();
  changes.toggleChecked(path, "changelist:default");
  mocks.backend.changelistList.mockResolvedValue(state("changed"));
  await changes.refresh(true);
  changes.toggleChecked(path, "changelist:other");
  expect(changes.checkedCommitSelection()[0]!.expectedToken).toBe("reviewed");
  const commit = useCommitStore();
  commit.message = "old selection";
  await commit.commit();
  expect(mocks.backend.commitCreate.mock.calls[0]![0].changelistFiles[0].expectedToken).toBe(
    "reviewed",
  );
});

it("keeps a checked partial selection when the file is later moved whole and the setting is disabled", async () => {
  const changes = useChangesStore();
  changes.setChecked([path], "changelist:other");
  changes.changelists = {
    ...state(),
    partialFiles: [],
    assignments: [{ path, listId: "other", hunkRanges: [] }],
  };
  mocks.settings.settings.git.allowPerHunkChangelists = false;
  const commit = useCommitStore();
  commit.message = "frozen scope";
  await commit.commit();
  const req = mocks.backend.commitCreate.mock.calls[0]![0];
  expect(req.paths).toBeUndefined();
  expect(req.changelistFiles).toEqual([{ path, listIds: ["other"], expectedToken: "reviewed" }]);
});

it("sends an originally whole selection through ownership validation after it becomes partial", async () => {
  const changes = useChangesStore();
  changes.changelists = { ...state(), assignments: [], partialFiles: [] };
  changes.setChecked([path], "changelist:default");
  changes.changelists = state();
  const commit = useCommitStore();
  commit.message = "whole at review";
  await commit.commit();
  expect(mocks.backend.commitCreate.mock.calls[0]![0].changelistFiles).toEqual([
    { path, listIds: ["default"] },
  ]);
});

it("retains a safe partial marker if a successful metadata write's derived read fails", async () => {
  const changes = useChangesStore();
  mocks.backend.changelistMove.mockResolvedValue({ ...state(), partialFiles: [] });
  mocks.backend.changelistList.mockRejectedValue(new Error("read unavailable"));
  expect(await changes.moveToChangelist(["other.txt"], "other")).not.toBeNull();
  expect(changes.partialForPath(path)?.contentToken).toBe("");
  expect(changes.partialForPath(path)?.problem).toBeTruthy();
  changes.setChecked([path], "changelist:default");
  expect(changes.checkedCommitSelection()[0]!.expectedToken).toBe("");
  expect(changes.error).toBe("read unavailable");
});

it("clears removed file selections and returns detached payload copies", async () => {
  const changes = useChangesStore();
  changes.setChecked([path], "changelist:default");
  const payload = changes.checkedCommitSelection();
  payload[0]!.listIds.push("other");
  expect(changes.checkedCommitSelection()[0]!.listIds).toEqual(["default"]);
  mocks.backend.statusGet.mockResolvedValue({ ...snapshot(), files: [] });
  await changes.refresh();
  expect(changes.checkedPaths).toEqual([]);
  expect(changes.checkedSelections).toEqual({});
});

it("uses list ownership for new files but leaves staging mode's unversioned display intact", () => {
  const changes = useChangesStore();
  changes.snapshot = {
    ...snapshot(),
    files: [{ ...snapshot().files[0]!, indexStatus: "?", worktreeStatus: "?", kind: "untracked" }],
  };
  expect(changes.unversioned).toEqual([]);
  expect(changes.filesForChangelist("other")).toHaveLength(1);
  mocks.settings.settings.stagingMode = true;
  expect(changes.unversioned).toHaveLength(1);
});

it("does not commit the entire index implicitly with no checks while partial assignments exist", async () => {
  const commit = useCommitStore();
  commit.message = "no checks";
  await commit.commit();
  expect(mocks.backend.commitCreate).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledWith({ title: "changelist.selectBeforeCommit" });
});
