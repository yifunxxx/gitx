import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { nextTick, reactive } from "vue";
import type { ChangelistsState, StatusSnapshot } from "@/lib/backend";
import { useChangesStore } from "@/stores/changesStore";
import VirtualList from "@/components/common/VirtualList.vue";
import ChangesTree from "./ChangesTree.vue";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  settings: {} as any,
  backend: { statusGet: vi.fn(), changelistList: vi.fn() },
  builds: [] as number[],
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/path-tree/buildPathTree", async (original) => {
  const real = await original<typeof import("@/lib/path-tree/buildPathTree")>();
  return {
    ...real,
    buildPathTree: (...args: Parameters<typeof real.buildPathTree>) => {
      mocks.builds.push(args[0].length);
      return real.buildPathTree(...args);
    },
  };
});
enableAutoUnmount(afterEach);
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.builds = [];
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.workspace = reactive({
    repoPath: "fixture",
    repoId: "fixture",
    isRepo: true,
    navigationToken: () => 1,
    setBranch: vi.fn(),
  });
  mocks.settings = reactive({ settings: { stagingMode: false, git: { changesListMode: "tree" } } });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
});

function snapshot(count = 3): StatusSnapshot {
  return {
    repoId: "fixture",
    version: 1,
    branch: { head: "main", upstream: null, ahead: 0, behind: 0, detached: false },
    files: Array.from({ length: count }, (_, i) => ({
      path: `src/file-${String(i).padStart(5, "0")}.txt`,
      origPath: null,
      indexStatus: "M",
      worktreeStatus: "M",
      kind: "modified",
    })),
  };
}
function state(files: StatusSnapshot, token = "reviewed"): ChangelistsState {
  const path = files.files[0]!.path;
  const anchor = {
    before: [],
    after: [],
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    changeHash: token,
  };
  return {
    lists: [
      { id: "default", name: "Changes", active: true, comment: "" },
      { id: "other", name: "Other", active: false, comment: "" },
    ],
    assignments: [{ path, listId: "other", hunkRanges: [anchor] }],
    partialFiles: [
      {
        path,
        contentToken: token,
        problem: null,
        hunks: [{ index: 0, listId: "other", anchor }],
        previewHunks: [
          {
            index: 0,
            header: "@@ -1 +1 @@",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ["-old", `+${token}`],
          },
        ],
      },
    ],
    warnings: [],
  };
}
async function fixture(count = 3) {
  const files = snapshot(count);
  mocks.backend.statusGet.mockImplementation(async () => structuredClone(files));
  mocks.backend.changelistList.mockResolvedValue(state(files));
  const store = useChangesStore();
  await store.refresh();
  const wrapper = mount(ChangesTree);
  const list = wrapper.getComponent(VirtualList);
  const rows = () => (wrapper.getComponent(VirtualList).props() as { items: any[] }).items;
  return { files, store, wrapper, list, rows };
}

it.each(["tree", "flat"])(
  "keeps %s rows, focus and frozen checks while publishing new partial content",
  async (mode) => {
    mocks.settings.settings.git.changesListMode = mode;
    const { files, store, wrapper, rows } = await fixture();
    const path = files.files[0]!.path;
    await wrapper.get(`[data-path="${path}"]`).trigger("click");
    store.setChecked([path], "changelist:other");
    await nextTick();
    const before = rows();
    const active = wrapper.get('[role="tree"]').attributes("aria-activedescendant");
    mocks.builds = [];
    const updated = state(files, "changed");
    mocks.backend.changelistList.mockResolvedValue(updated);
    await store.refresh(true);
    await nextTick();
    expect(store.partialForPath(path)).toEqual(updated.partialFiles![0]);
    expect(store.checkedCommitSelection()).toEqual([
      { path, listIds: ["other"], expectedToken: "reviewed" },
    ]);
    expect(store.selectedPaths).toEqual([path]);
    expect(wrapper.get('[role="tree"]').attributes("aria-activedescendant")).toBe(active);
    expect(rows()).toBe(before);
    expect(mocks.builds).toEqual([]);
  },
);

it("updates renamed headers without rebuilding unchanged directory models", async () => {
  const { files, store, wrapper, rows } = await fixture();
  const nodes = rows()
    .filter((row) => row.kind === "file")
    .map((row) => row.node);
  mocks.builds = [];
  const renamed = state(files);
  renamed.lists[1]!.name = "Renamed";
  mocks.backend.changelistList.mockResolvedValue(renamed);
  await store.refresh(true);
  await nextTick();
  expect(wrapper.find('[aria-label="Renamed (1)"]').exists()).toBe(true);
  expect(
    rows()
      .filter((row) => row.kind === "file")
      .map((row) => row.node),
  ).toEqual(nodes);
  expect(mocks.builds).toEqual([]);
});

it("applies real ownership changes and prunes unavailable list checks", async () => {
  const { files, store, wrapper } = await fixture();
  const path = files.files[0]!.path;
  store.setChecked([path], "changelist:other");
  const moved = state(files, "moved");
  moved.partialFiles![0]!.hunks[0]!.listId = "default";
  mocks.backend.changelistList.mockResolvedValue(moved);
  await store.refresh(true);
  await nextTick();
  expect(wrapper.find(`[data-path="${path}"][data-section="changelist:other"]`).exists()).toBe(
    false,
  );
  expect(wrapper.find(`[data-path="${path}"][data-section="changelist:default"]`).exists()).toBe(
    true,
  );
  expect(store.checkedCommitSelection()).toEqual([]);
});

it("publishes read problems and current tokens without renewing the checked snapshot", async () => {
  const { files, store, rows } = await fixture();
  const path = files.files[0]!.path;
  store.setChecked([path], "changelist:other");
  const before = rows();
  const failed = state(files, "");
  failed.partialFiles![0]!.problem = "Read failed";
  failed.partialFiles![0]!.hunks = [];
  failed.warnings = ["Read failed"];
  mocks.backend.changelistList.mockResolvedValue(failed);
  await store.refresh(true);
  await nextTick();
  expect(store.partialForPath(path)?.problem).toBe("Read failed");
  expect(store.partialForPath(path)?.contentToken).toBe("");
  expect(store.checkedCommitSelection()[0]!.expectedToken).toBe("reviewed");
  expect(rows()).toBe(before);
});

it("keeps a collapsed renamed section lazy and expands its latest status", async () => {
  const { files, store, wrapper } = await fixture();
  await wrapper.get('[aria-label="Changes (2)"]').get("button").trigger("click");
  mocks.builds = [];
  files.files.push({ ...files.files[1]!, path: "src/added.txt" });
  const renamed = state(files, "changed");
  renamed.lists[0]!.name = "Updated";
  mocks.backend.changelistList.mockResolvedValue(renamed);
  await store.refresh(true);
  await nextTick();
  expect(wrapper.get('[aria-label="Updated (3)"]').attributes("aria-expanded")).toBe("false");
  expect(mocks.builds).not.toContain(3);
  expect(wrapper.find('[data-path="src/added.txt"]').exists()).toBe(false);
  await wrapper.get('[aria-label="Updated (3)"]').get("button").trigger("click");
  expect(wrapper.find('[data-path="src/added.txt"]').exists()).toBe(true);
  expect(mocks.builds).toContain(3);
});

it("changes untracked membership and updates file status after a reused refresh", async () => {
  const { files, store, wrapper, rows } = await fixture();
  const path = files.files[0]!.path;
  mocks.backend.changelistList.mockResolvedValue(state(files, "changed"));
  await store.refresh(true);
  await nextTick();
  const before = rows();
  files.files[0] = { ...files.files[0]!, indexStatus: "?", worktreeStatus: "?", kind: "untracked" };
  const whole = state(files, "whole");
  whole.assignments = [];
  whole.partialFiles = [];
  mocks.backend.changelistList.mockResolvedValue(whole);
  await store.refresh(true);
  await nextTick();
  expect(rows()).not.toBe(before);
  expect(store.unversioned.map((file) => file.path)).toEqual([path]);
  expect(wrapper.find(`[data-path="${path}"][data-section="unversioned"]`).exists()).toBe(true);
  expect(wrapper.find(`[data-path="${path}"][data-section="changelist:other"]`).exists()).toBe(
    false,
  );
  mocks.backend.changelistList.mockResolvedValue(state(files, "assigned-new"));
  await store.refresh(true);
  await nextTick();
  expect(store.unversioned).toEqual([]);
  const item = wrapper.get(`[data-path="${path}"][data-section="changelist:other"]`);
  expect(item.attributes("data-section")).toBe("changelist:other");
  expect(rows().find((row) => row.node?.file?.path === path)?.node.file.change.kind).toBe(
    "untracked",
  );
});

it("updates list order and removes deleted groups without retaining their rows", async () => {
  const { files, store, rows } = await fixture();
  const reverse = state(files);
  reverse.lists.reverse();
  mocks.backend.changelistList.mockResolvedValue(reverse);
  await store.refresh(true);
  await nextTick();
  expect(
    rows()
      .filter((row) => row.kind === "header")
      .map((row) => row.section),
  ).toEqual(["changelist:other", "changelist:default", "unversioned"]);
  const removed = state(files);
  removed.lists.splice(1, 1);
  removed.assignments[0]!.listId = "default";
  removed.partialFiles![0]!.hunks[0]!.listId = "default";
  removed.partialFiles![0]!.contentToken = "deleted-list";
  mocks.backend.changelistList.mockResolvedValue(removed);
  await store.refresh(true);
  await nextTick();
  expect(rows().some((row) => row.section === "changelist:other")).toBe(false);
  expect(store.filesForChangelist("default")).toHaveLength(3);
});

it("does not reuse prior repository rows, checks or collapsed sections after navigation", async () => {
  const { files, store, wrapper, rows } = await fixture();
  store.setChecked([files.files[0]!.path], "changelist:other");
  await wrapper.get('[aria-label="Changes (2)"]').get("button").trigger("click");
  const before = rows();
  mocks.workspace.repoPath = "other-repository";
  mocks.workspace.repoId = "other-repository";
  files.repoId = "other-repository";
  await store.refresh();
  await nextTick();
  expect(rows()).not.toBe(before);
  expect(store.checkedCommitSelection()).toEqual([]);
  expect(wrapper.get('[aria-label="Changes (2)"]').attributes("aria-expanded")).toBe("true");
  expect(
    rows()
      .filter((row) => row.kind === "file")
      .every((row) => !before.includes(row)),
  ).toBe(true);
});

it.runIf(!!process.env.GITX_QA_TREE_COST)(
  "measures repeated partial content refresh with the real virtual tree",
  async () => {
    const { files, store, rows } = await fixture(20_000);
    const samples = [];
    for (let round = 0; round < 5; round++) {
      const before = rows();
      mocks.builds = [];
      mocks.backend.changelistList.mockResolvedValue(state(files, `update-${round}`));
      const start = performance.now();
      await store.refresh(true);
      await nextTick();
      samples.push({
        round,
        elapsedMs: performance.now() - start,
        builds: [...mocks.builds],
        rows: rows().length,
        sameRows: rows() === before,
      });
    }
    console.log("QA_TREE_COST", JSON.stringify(samples));
  },
);
