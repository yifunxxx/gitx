import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive } from "vue";
import CommitToolWindow from "./CommitToolWindow.vue";
import { useChangesStore } from "@/stores/changesStore";
import type { FileChange } from "@/lib/backend";

const m = vi.hoisted(() => ({
  workspace: {} as any,
  settings: {} as any,
  addPaths: vi.fn(),
  statusGet: vi.fn(),
  changelistList: vi.fn(),
  openDiff: vi.fn(),
  openFile: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => m.workspace }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => m.settings }));
vi.mock("@/stores/layoutStore", () => ({
  useLayoutStore: () => ({ commitTwMode: "docked", commitControlsHidden: true }),
}));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => ({ refreshOpState: vi.fn() }) }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => ({}) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({ open: m.openFile }) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/composables/useWorkspaceOpen", () => ({
  useWorkspaceOpen: () => ({ pending: false, enableVcs: vi.fn() }),
}));
vi.mock("@/composables/workspaceOpenState", () => ({ ownsWorkspaceInitialReads: () => true }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/features/commit/openChangeDiff", () => ({ openChangeDiff: m.openDiff }));
vi.mock("@/actions", () => ({ runAction: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => m }));

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  m.workspace = reactive({
    repoPath: "fixture",
    repoId: "fixture",
    folderPath: "fixture",
    isRepo: true,
    generation: 1,
    navigationToken() {
      return this.generation;
    },
    setBranch: vi.fn(),
  });
  m.settings = reactive({
    settings: { stagingMode: false, showIgnoredFiles: true, git: { changesListMode: "tree" } },
  });
  m.statusGet.mockImplementation(async () => useChangesStore().snapshot);
  m.changelistList.mockImplementation(async () => useChangesStore().changelists);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function change(path: string, kind: FileChange["kind"] = "untracked"): FileChange {
  const status = kind === "untracked" ? "?" : kind === "ignored" ? "!" : "M";
  return { path, kind, origPath: null, indexStatus: status, worktreeStatus: status };
}

function fixture(files = [change("a.txt"), change("b.txt"), change("c.txt")]) {
  const store = useChangesStore();
  store.snapshot = {
    repoId: "fixture",
    version: 1,
    branch: { head: "main", upstream: null, ahead: null, behind: null, detached: false },
    files,
  };
  store.changelists = {
    lists: [{ id: "default", name: "Changes", comment: "", active: true }],
    assignments: [],
  };
  const wrapper = mount(CommitToolWindow, {
    attachTo: document.body,
    global: {
      stubs: {
        RepoStateBanner: true,
        CommitMessageEditor: true,
        Tip: { template: "<div><slot /></div>" },
        ContextMenuSurface: {
          props: ["open"],
          template: '<div data-menu v-if="open"><slot /></div>',
        },
      },
    },
  });
  const file = (path: string, section = "unversioned") =>
    wrapper.get(`[data-path="${path}"][data-section="${section}"]`);
  async function clickAdd() {
    const action = wrapper
      .findAll("[data-menu] button")
      .find((button) => button.text().startsWith("actions.addToVcs"));
    expect(action).toBeDefined();
    await action!.trigger("click");
    await flushPromises();
  }
  async function addFrom(path: string) {
    await file(path).trigger("contextmenu");
    await flushPromises();
    await clickAdd();
  }
  return { wrapper, store, file, addFrom, clickAdd };
}

function expectAdded(paths: string[]) {
  expect(m.addPaths).toHaveBeenCalledExactlyOnceWith({
    repoId: "fixture",
    path: "fixture",
    paths,
    force: false,
  });
}

it.each(["tree", "flat"])(
  "adds checked unversioned files from a checked row in %s mode",
  async (mode) => {
    m.settings.settings.git.changesListMode = mode;
    const { store, file, addFrom } = fixture();
    await file("a.txt").get("input").setValue(true);
    await file("b.txt").get("input").setValue(true);
    expect(store.checkedPaths).toEqual(["a.txt", "b.txt"]);
    expect(store.selectedPaths).toEqual([]);
    await addFrom("b.txt");
    expectAdded(["a.txt", "b.txt"]);
    expect(store.checkedPaths).toEqual(["a.txt", "b.txt"]);
  },
);

it.each([
  { mode: "tree", staging: false, modifier: "ctrlKey" },
  { mode: "flat", staging: false, modifier: "shiftKey" },
  { mode: "tree", staging: true, modifier: "shiftKey" },
  { mode: "flat", staging: true, modifier: "ctrlKey" },
])(
  "preserves $modifier row selection with $mode and staging=$staging",
  async ({ mode, staging, modifier }) => {
    m.settings.settings.git.changesListMode = mode;
    m.settings.settings.stagingMode = staging;
    const { store, file, addFrom } = fixture();
    if (!staging) await file("c.txt").get("input").setValue(true);
    await file("a.txt").trigger("click");
    await file("b.txt").trigger("click", { [modifier]: true });
    expect(store.selectedPaths).toEqual(["a.txt", "b.txt"]);
    await addFrom("a.txt");
    expectAdded(["a.txt", "b.txt"]);
    expect(store.checkedPaths).toEqual(staging ? [] : ["c.txt"]);
  },
);

it("limits an unchecked context row to that file even when other files are checked", async () => {
  const { file, addFrom } = fixture();
  await file("a.txt").get("input").setValue(true);
  await file("b.txt").get("input").setValue(true);
  await addFrom("c.txt");
  expectAdded(["c.txt"]);
});

it("filters checked tracked, ignored and stale paths from the Add operation", async () => {
  const { store, file, addFrom } = fixture([
    change("a.txt"),
    change("b.txt"),
    change("tracked.txt", "modified"),
    change("ignored.txt", "ignored"),
  ]);
  await file("a.txt").get("input").setValue(true);
  await file("b.txt").get("input").setValue(true);
  await file("tracked.txt", "changelist:default").get("input").setValue(true);
  store.checkedPaths = [...store.checkedPaths, "ignored.txt", "removed.txt"];
  await addFrom("b.txt");
  expectAdded(["a.txt", "b.txt"]);
});

it("adds every checked descendant after a directory checkbox is selected", async () => {
  const { wrapper, store, addFrom } = fixture([
    change("new/a.txt"),
    change("new/nested/b.txt"),
    change("new-other/c.txt"),
  ]);
  await wrapper
    .get('[role="treeitem"][aria-label="new"][data-section="unversioned"]')
    .get("input")
    .setValue(true);
  expect([...store.checkedPaths].sort()).toEqual(["new/a.txt", "new/nested/b.txt"]);
  await addFrom("new/nested/b.txt");
  expect(m.addPaths).toHaveBeenCalledOnce();
  expect([...m.addPaths.mock.calls[0]![0].paths].sort()).toEqual(["new/a.txt", "new/nested/b.txt"]);
});

it("uses checked files with Shift+F10 on a checked unversioned row", async () => {
  const { wrapper, file, clickAdd } = fixture();
  await file("a.txt").get("input").setValue(true);
  await file("b.txt").get("input").setValue(true);
  await wrapper.get('[role="tree"]').trigger("keydown", { key: "F10", shiftKey: true });
  await clickAdd();
  expectAdded(["a.txt", "b.txt"]);
});

it("ignores old checkbox state in staging mode", async () => {
  m.settings.settings.stagingMode = true;
  const { store, wrapper, addFrom } = fixture();
  store.checkedPaths = ["a.txt", "b.txt"];
  expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
  await addFrom("b.txt");
  expectAdded(["b.txt"]);
});

it("closes a captured checked-file Add menu when background status removes a target", async () => {
  const { wrapper, store, file } = fixture();
  await file("a.txt").get("input").setValue(true);
  await file("b.txt").get("input").setValue(true);
  await file("b.txt").trigger("contextmenu");
  expect(wrapper.find("[data-menu]").exists()).toBe(true);
  store.snapshot = {
    ...store.snapshot!,
    version: 2,
    files: store.snapshot!.files.filter((file) => file.path !== "a.txt"),
  };
  await nextTick();
  expect(wrapper.find("[data-menu]").exists()).toBe(false);
  expect(m.addPaths).not.toHaveBeenCalled();
});

it("closes a checked-file Add menu after repository navigation", async () => {
  const { wrapper, file } = fixture();
  await file("a.txt").get("input").setValue(true);
  await file("b.txt").get("input").setValue(true);
  await file("b.txt").trigger("contextmenu");
  expect(wrapper.find("[data-menu]").exists()).toBe(true);
  m.workspace.generation++;
  await nextTick();
  expect(wrapper.find("[data-menu]").exists()).toBe(false);
  expect(m.addPaths).not.toHaveBeenCalled();
});

it("invalidates a checked-file menu synchronously when the checks change", async () => {
  const { wrapper, store, file } = fixture();
  await file("a.txt").get("input").setValue(true);
  await file("b.txt").get("input").setValue(true);
  await file("b.txt").trigger("contextmenu");
  const oldAction = wrapper
    .findAll("[data-menu] button")
    .find((button) => button.text().startsWith("actions.addToVcs"))!;
  expect(oldAction).toBeDefined();
  store.checkedPaths = ["b.txt", "c.txt"];
  // Dispatch before Vue removes the stale menu from the DOM. The handler must
  // already reject the old action and must not silently retarget to b/c.
  await oldAction.trigger("click");
  expect(wrapper.find("[data-menu]").exists()).toBe(false);
  expect(m.addPaths).not.toHaveBeenCalled();
});

it("prefers explicit row selection even when the clicked row belongs to a different checked set", async () => {
  const { store, file, addFrom } = fixture();
  await file("a.txt").get("input").setValue(true);
  await file("c.txt").get("input").setValue(true);
  await file("a.txt").trigger("click");
  await file("b.txt").trigger("click", { ctrlKey: true });
  expect(store.checkedPaths).toEqual(["a.txt", "c.txt"]);
  expect(store.selectedPaths).toEqual(["a.txt", "b.txt"]);
  await addFrom("a.txt");
  expectAdded(["a.txt", "b.txt"]);
});

it("keeps Open File scoped to the context row when Add would include several checked files", async () => {
  const { wrapper, file } = fixture();
  await file("a.txt").get("input").setValue(true);
  await file("b.txt").get("input").setValue(true);
  await file("b.txt").trigger("contextmenu");
  const open = wrapper
    .findAll("[data-menu] button")
    .find((button) => button.text() === "commitTw.openFile")!;
  await open.trigger("click");
  await flushPromises();
  expect(m.openFile).toHaveBeenCalledExactlyOnceWith("b.txt");
  expect(m.addPaths).not.toHaveBeenCalled();
});

it("rejects a captured Add range when metadata moves a target out of unversioned files", async () => {
  const { wrapper, store, file } = fixture();
  await file("a.txt").get("input").setValue(true);
  await file("b.txt").get("input").setValue(true);
  await file("b.txt").trigger("contextmenu");
  const oldAction = wrapper
    .findAll("[data-menu] button")
    .find((button) => button.text().startsWith("actions.addToVcs"))!;
  expect(oldAction).toBeDefined();
  const snapshot = store.snapshot;
  const checkedPaths = store.checkedPaths;

  // Changelist previews can arrive without a new status snapshot. This file
  // now belongs to a partial changelist and must not be added as a whole file.
  store.changelists = {
    ...store.changelists!,
    partialFiles: [
      { path: "a.txt", contentToken: "partial-a", hunks: [], previewHunks: [], problem: null },
    ],
  };
  expect(store.snapshot).toBe(snapshot);
  expect(store.checkedPaths).toBe(checkedPaths);
  expect(store.unversioned.map((entry) => entry.path)).toEqual(["b.txt", "c.txt"]);
  await oldAction.trigger("click");
  await flushPromises();
  expect(m.addPaths).not.toHaveBeenCalled();
  expect(wrapper.find("[data-menu]").exists()).toBe(false);
});
