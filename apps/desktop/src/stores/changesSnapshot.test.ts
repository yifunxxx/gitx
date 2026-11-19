import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import type { BranchInfo, FileChange, StatusSnapshot } from "@/lib/backend";
import { useChangesStore } from "./changesStore";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  settings: {} as any,
  backend: { statusGet: vi.fn(), changelistList: vi.fn() },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => mocks.settings }));

function snapshot(version: number, branch: Partial<BranchInfo> = {}): StatusSnapshot {
  return {
    repoId: "fixture",
    version,
    branch: {
      head: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      detached: false,
      ...branch,
    },
    files: [
      { path: "src/a.ts", origPath: null, indexStatus: "M", worktreeStatus: "M", kind: "modified" },
      { path: "new.txt", origPath: null, indexStatus: "?", worktreeStatus: "?", kind: "untracked" },
      { path: "ignored/", origPath: null, indexStatus: "!", worktreeStatus: "!", kind: "ignored" },
    ],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.workspace = reactive({
    repoPath: "fixture",
    repoId: "fixture",
    isRepo: true,
    navigationToken: () => 1,
    setBranch: vi.fn(),
  });
  mocks.settings = reactive({ settings: { stagingMode: false, showIgnoredFiles: true } });
  mocks.backend.changelistList.mockResolvedValue({
    lists: [{ id: "default", name: "Changes", comment: "", active: true }],
    assignments: [],
  });
});

it.each<Partial<BranchInfo>>([
  { head: "feature" },
  { upstream: null },
  { ahead: 2 },
  { behind: 3 },
  { detached: true },
])("updates branch metadata without invalidating unchanged file models: %j", async (branch) => {
  const initial = snapshot(1);
  const next = snapshot(2, branch);
  mocks.backend.statusGet.mockResolvedValueOnce(initial).mockResolvedValueOnce(next);
  const store = useChangesStore();
  await store.refresh();
  store.checkedPaths = ["src/a.ts", "new.txt"];
  const models = [store.staged, store.unstaged, store.changed, store.unversioned, store.ignored];
  const listFiles = store.filesForChangelist("default");
  const checked = store.checkedPaths;
  await store.refresh(true);
  expect(store.snapshot?.branch).toEqual(next.branch);
  expect(mocks.workspace.setBranch).toHaveBeenLastCalledWith(next.branch);
  expect(store.snapshot?.files).toBe(initial.files);
  const updated = [store.staged, store.unstaged, store.changed, store.unversioned, store.ignored];
  updated.forEach((files, index) => expect(files).toBe(models[index]));
  expect(store.filesForChangelist("default")).toBe(listFiles);
  expect(store.checkedPaths).toBe(checked);
  expect(store.checkStateForSection("changelist:default")).toBe("all");
  expect(store.checkStateForSection("unversioned")).toBe("all");
  store.checkedPaths = [];
  expect(store.checkStateForSection("changelist:default")).toBe("none");
  store.toggleCheckSection("changelist:default");
  expect(store.checkedPaths).toEqual(["src/a.ts"]);
  // Snapshot sharing must not mutate the backend result object.
  expect(next.files).not.toBe(initial.files);
});

it.each<Partial<FileChange>>([
  { path: "renamed.ts" },
  { origPath: "previous.ts" },
  { indexStatus: "." },
  { worktreeStatus: "." },
  { kind: "ignored" },
])("applies real file changes after a branch-only refresh: %j", async (change) => {
  const initial = snapshot(1);
  const branchOnly = snapshot(2, { behind: 1 });
  const next = snapshot(3, { behind: 1 });
  Object.assign(next.files[0]!, change);
  mocks.backend.statusGet
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(branchOnly)
    .mockResolvedValueOnce(next);
  const store = useChangesStore();
  await store.refresh();
  await store.refresh(true);
  store.checkedPaths = ["src/a.ts", "new.txt"];
  await store.refresh(true);
  expect(store.snapshot?.files).toBe(next.files);
  expect(store.snapshot?.files[0]).toMatchObject(change);
  if (change.path) expect(store.checkedPaths).toEqual(["new.txt"]);
  if (change.indexStatus === "." || change.kind === "ignored") expect(store.staged).toEqual([]);
  if (change.worktreeStatus === "." || change.kind === "ignored")
    expect(store.unstaged).toEqual([]);
  if (change.kind === "ignored") expect(store.changed).toEqual([]);
  else expect(store.filesForChangelist("default")[0]).toMatchObject(change);
});

it.each(["remove", "reorder"])(
  "applies a file array %s after branch-only refresh",
  async (kind) => {
    const initial = snapshot(1);
    const branchOnly = snapshot(2, { ahead: 1 });
    const next = snapshot(3, { ahead: 1 });
    if (kind === "remove") next.files.splice(0, 1);
    else next.files.reverse();
    mocks.backend.statusGet
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(branchOnly)
      .mockResolvedValueOnce(next);
    const store = useChangesStore();
    await store.refresh();
    await store.refresh(true);
    store.checkedPaths = ["src/a.ts", "new.txt"];
    await store.refresh(true);
    expect(store.snapshot?.files).toBe(next.files);
    expect(store.snapshot?.files.map((file) => file.path)).toEqual(
      next.files.map((file) => file.path),
    );
    expect(store.checkedPaths).toEqual(kind === "remove" ? ["new.txt"] : ["src/a.ts", "new.txt"]);
  },
);

it("refreshes changelist assignments while reusing unchanged files", async () => {
  mocks.backend.statusGet
    .mockResolvedValueOnce(snapshot(1))
    .mockResolvedValueOnce(snapshot(2, { behind: 1 }));
  const store = useChangesStore();
  await store.refresh();
  const initialFiles = store.changed;
  store.checkedPaths = ["src/a.ts"];
  expect(store.checkStateForSection("changelist:default")).toBe("all");
  mocks.backend.changelistList.mockResolvedValue({
    lists: [
      { id: "default", name: "Changes", comment: "", active: true },
      { id: "other", name: "Other", comment: "", active: false },
    ],
    assignments: [{ path: "src/a.ts", listId: "other", hunkRanges: [] }],
  });
  await store.refresh(true);
  expect(store.changed).toBe(initialFiles);
  expect(store.filesForChangelist("default")).toEqual([]);
  expect(store.filesForChangelist("other")).toEqual(initialFiles);
  expect(store.checkStateForSection("changelist:default")).toBe("none");
  expect(store.checkStateForSection("changelist:other")).toBe("all");
});

it("does not reuse file models or checks across repository navigation", async () => {
  const initial = snapshot(1);
  const other = { ...snapshot(1), repoId: "other" };
  mocks.backend.statusGet.mockResolvedValueOnce(initial).mockResolvedValueOnce(other);
  const store = useChangesStore();
  await store.refresh();
  const files = store.changed;
  store.checkedPaths = ["src/a.ts"];
  store.selectedPaths = ["src/a.ts"];
  mocks.workspace.repoPath = "other";
  mocks.workspace.repoId = "other";
  await store.refresh();
  expect(store.changed).not.toBe(files);
  expect(store.snapshot?.files).toBe(other.files);
  expect(store.checkedPaths).toEqual([]);
  expect(store.selectedPaths).toEqual([]);
});

it("keeps rejecting an older file response after a reused file snapshot", async () => {
  const initial = snapshot(1);
  const newer = snapshot(5, { behind: 2 });
  const stale = snapshot(4);
  stale.files = [];
  mocks.backend.statusGet
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(newer)
    .mockResolvedValueOnce(stale);
  const store = useChangesStore();
  await store.refresh();
  await store.refresh(true);
  await store.refresh(true);
  expect(store.snapshot?.branch).toEqual(newer.branch);
  expect(store.changed.map((file) => file.path)).toEqual(["src/a.ts"]);
  expect(mocks.workspace.setBranch).toHaveBeenCalledTimes(2);
});
