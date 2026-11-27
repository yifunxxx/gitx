import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import EditorTabs from "./EditorTabs.vue";
import EditorTabButton from "./EditorTabButton.vue";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  layout: {} as any,
  diff: {} as any,
  history: {} as any,
  compare: {} as any,
  repoAtRev: {} as any,
  merge: {} as any,
  file: {} as any,
  confirm: vi.fn(),
  fsReadFile: vi.fn(),
  workspaceOpen: vi.fn(),
  workspaceRecent: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("vue-i18n", async (original) => ({
  ...(await original<typeof import("vue-i18n")>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: mocks.confirm }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => mocks.diff }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => mocks.history }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => mocks.compare }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => mocks.repoAtRev }));
vi.mock("@/stores/conflictsStore", () => ({ useConflictsStore: () => mocks.merge }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => mocks.file }));

function store(kind: string, ids: string[]) {
  const state: any = reactive({
    tabs: ids.map((id) => ({ id, title: `${kind} ${id}` })),
    activeId: ids[0] ?? null,
  });
  state.closeTab = vi.fn((id: string) => {
    state.tabs = state.tabs.filter((tab: any) => tab.id !== id);
    if (state.activeId === id) state.activeId = state.tabs.at(-1)?.id ?? null;
    // Existing file/merge stores may switch layout while a background tab closes.
    if (!state.activeId) mocks.layout.activeEditorKind = "welcome";
  });
  return state;
}

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  mocks.fsReadFile.mockResolvedValue("disk text\n");
  mocks.workspaceOpen.mockImplementation(({ path }) =>
    Promise.resolve({ path, isRepo: false, roots: [] }),
  );
  mocks.workspaceRecent.mockResolvedValue({ paths: [] });
  mocks.workspace = reactive({
    repoPath: "fixture",
    folderPath: "fixture",
    navigation: 1,
    applied: 1,
    navigationToken() {
      return this.navigation;
    },
    appliedOpenToken() {
      return this.applied;
    },
  });
  mocks.layout = reactive({ activeEditorKind: "diff" });
  mocks.diff = store("diff", ["shared", "d2"]);
  mocks.history = store("history", ["shared"]);
  mocks.compare = store("compare", ["c"]);
  mocks.repoAtRev = store("repoAtRev", ["r"]);
  mocks.file = store("file", ["f"]);
  mocks.file.tabs[0].dirty = false;
  mocks.merge = reactive({
    mergeTabs: [{ id: "m", title: "merge m" }],
    activeMergeId: "m",
    hasUnsavedMergeResult: vi.fn(() => false),
    closeMergeTab: vi.fn((id: string) => {
      mocks.merge.mergeTabs = mocks.merge.mergeTabs.filter((tab: any) => tab.id !== id);
      mocks.merge.activeMergeId = null;
      mocks.layout.activeEditorKind = "welcome";
    }),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const wrapper = mount(EditorTabs, {
    attachTo: document.body,
    global: {
      stubs: {
        WelcomeView: true,
        DiffViewer: true,
        FileHistoryView: true,
        RepoAtRevisionView: true,
        CompareView: true,
        MergeViewer: true,
        FileViewer: true,
        EmptyState: true,
      },
    },
  });
  const tab = (kind: string, id: string) =>
    wrapper
      .findAllComponents(EditorTabButton)
      .find((item) => item.props("tabKey") === JSON.stringify([kind, id]))!;
  const close = async (kind: string, id: string, scope: string) => {
    tab(kind, id).vm.$emit("close", scope);
    await flushPromises();
  };
  return { wrapper, tab, close };
}

describe("Editor tab closing", () => {
  it("closes a background target without confusing equal IDs or switching the active view", async () => {
    const { close } = setup();
    await close("history", "shared", "current");
    expect(mocks.history.closeTab).toHaveBeenCalledWith("shared");
    expect(mocks.diff.closeTab).not.toHaveBeenCalled();
    expect(mocks.layout.activeEditorKind).toBe("diff");
    expect(mocks.diff.activeId).toBe("shared");
  });

  it("closes others across all kinds and activates the retained target", async () => {
    const { wrapper, close } = setup();
    await close("history", "shared", "others");
    expect(wrapper.findAllComponents(EditorTabButton).map((item) => item.props("tabKey"))).toEqual([
      "workspace",
      JSON.stringify(["history", "shared"]),
    ]);
    expect(mocks.layout.activeEditorKind).toBe("history");
    expect(mocks.history.closeTab).not.toHaveBeenCalled();
    expect(mocks.merge.closeMergeTab).toHaveBeenCalledWith("m");
  });

  it("closes right according to visible order and keeps left-side tabs", async () => {
    const { wrapper, close } = setup();
    mocks.layout.activeEditorKind = "file";
    await close("history", "shared", "right");
    expect(wrapper.findAllComponents(EditorTabButton).map((item) => item.props("title"))).toEqual([
      "chrome.workspaceTab",
      "diff shared",
      "diff d2",
      "history shared",
    ]);
    expect(mocks.layout.activeEditorKind).toBe("history");
  });

  it("selects the adjacent surviving kind after closing the active tab", async () => {
    const { close } = setup();
    mocks.layout.activeEditorKind = "history";
    await close("history", "shared", "current");
    expect(mocks.layout.activeEditorKind).toBe("compare");
    expect(mocks.compare.activeId).toBe("c");
    expect((document.activeElement as HTMLElement).dataset.editorKey).toBe(
      JSON.stringify(["compare", "c"]),
    );
  });

  it("keeps Workspace after Close All and disables unavailable actions", async () => {
    const { wrapper, close } = setup();
    expect(wrapper.findAllComponents(EditorTabButton).at(-1)!.props("hasRight")).toBe(false);
    await close("diff", "d2", "all");
    expect(wrapper.findAllComponents(EditorTabButton)).toHaveLength(1);
    expect(mocks.layout.activeEditorKind).toBe("welcome");
    const workspace = wrapper.getComponent(EditorTabButton);
    expect(workspace.props("closable")).toBe(false);
    expect(workspace.props("hasTabs")).toBe(false);
  });

  it("cancels a dirty merge batch without closing any tab", async () => {
    const { close } = setup();
    mocks.merge.hasUnsavedMergeResult.mockReturnValue(true);
    mocks.confirm.mockResolvedValue(false);
    await close("diff", "shared", "all");
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.diff.closeTab).not.toHaveBeenCalled();
    expect(mocks.merge.closeMergeTab).not.toHaveBeenCalled();
  });

  it("shows a dirty mark on unsaved file tabs and confirms before closing them", async () => {
    const { wrapper, close, tab } = setup();
    mocks.file.tabs[0].dirty = true;
    await flushPromises();
    expect(tab("file", "f").props("dirty")).toBe(true);
    expect(wrapper.find('[aria-label="file f (unsaved)"]').exists()).toBe(true);
    mocks.confirm.mockResolvedValue(false);
    await close("file", "f", "current");
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.file.closeTab).not.toHaveBeenCalled();
  });

  it("invalidates an outstanding confirmation on A → B → A navigation", async () => {
    const { tab } = setup();
    mocks.merge.hasUnsavedMergeResult.mockReturnValue(true);
    let resolve!: (ok: boolean) => void;
    mocks.confirm.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    tab("diff", "shared").vm.$emit("close", "all");
    await flushPromises();
    mocks.workspace.repoPath = "other";
    mocks.workspace.repoPath = "fixture";
    resolve(true);
    await flushPromises();
    expect(mocks.diff.closeTab).not.toHaveBeenCalled();
    expect(mocks.merge.closeMergeTab).not.toHaveBeenCalled();
  });

  it("prevents duplicate confirmations and closes only the snapshotted targets", async () => {
    const { tab } = setup();
    mocks.merge.hasUnsavedMergeResult.mockReturnValue(true);
    let resolve!: (ok: boolean) => void;
    mocks.confirm.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    tab("diff", "shared").vm.$emit("close", "all");
    tab("diff", "shared").vm.$emit("close", "all");
    await flushPromises();
    mocks.file.tabs.push({ id: "new", title: "new" });
    resolve(true);
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.file.tabs.map((tab: any) => tab.id)).toEqual(["new"]);
  });

  it.each(["navigation", "applied"])(
    "invalidates an outstanding close when the same-path %s identity changes",
    async (identity) => {
      const { tab } = setup();
      mocks.file.tabs[0].dirty = true;
      let resolve!: (ok: boolean) => void;
      mocks.confirm.mockImplementation(() => new Promise((done) => (resolve = done)));
      tab("diff", "shared").vm.$emit("close", "all");
      await flushPromises();
      mocks.workspace[identity]++;
      mocks.file.tabs = [{ id: "f", title: "new file", dirty: true }];
      mocks.layout.activeEditorKind = "file";
      resolve(true);
      await flushPromises();
      expect(mocks.diff.closeTab).not.toHaveBeenCalled();
      expect(mocks.file.closeTab).not.toHaveBeenCalled();
      expect(mocks.file.tabs[0]).toMatchObject({ title: "new file", dirty: true });
      expect(mocks.layout.activeEditorKind).toBe("file");
    },
  );

  it.each(["file", "merge", "diff", "history", "compare", "repoAtRev"])(
    "keeps a replacement %s instance with the same ID outside the confirmed batch",
    async (kind) => {
      const { tab } = setup();
      mocks.merge.hasUnsavedMergeResult.mockReturnValue(true);
      let resolve!: (ok: boolean) => void;
      mocks.confirm.mockImplementation(() => new Promise((done) => (resolve = done)));
      tab("diff", "shared").vm.$emit("close", "all");
      await flushPromises();
      const state = mocks[kind as keyof typeof mocks] as any;
      const field = kind === "merge" ? "mergeTabs" : "tabs";
      const id = state[field][0].id;
      state[field] = [{ id, title: "replacement", dirty: true }];
      mocks.layout.activeEditorKind = kind;
      resolve(true);
      await flushPromises();
      expect(state[field]).toHaveLength(1);
      expect(state[field][0]).toMatchObject({ id, title: "replacement", dirty: true });
      expect(kind === "merge" ? state.closeMergeTab : state.closeTab).not.toHaveBeenCalled();
      expect(mocks.layout.activeEditorKind).toBe(kind);
    },
  );

  it("selects a live neighbor when the original adjacent tab disappears during confirmation", async () => {
    const { tab } = setup();
    mocks.merge.hasUnsavedMergeResult.mockReturnValue(true);
    mocks.layout.activeEditorKind = "merge";
    let resolve!: (ok: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise((done) => (resolve = done)));
    tab("merge", "m").vm.$emit("close", "current");
    await flushPromises();
    mocks.file.tabs = [];
    mocks.file.activeId = null;
    resolve(true);
    await flushPromises();
    expect(mocks.merge.closeMergeTab).toHaveBeenCalledWith("m");
    expect(mocks.layout.activeEditorKind).toBe("repoAtRev");
    expect(mocks.repoAtRev.activeId).toBe("r");
    expect(mocks.file.activeId).toBeNull();
    expect((document.activeElement as HTMLElement).dataset.editorKey).toBe(
      JSON.stringify(["repoAtRev", "r"]),
    );
  });

  it("abandons Close Others if the retained target was replaced during confirmation", async () => {
    const { tab } = setup();
    mocks.merge.hasUnsavedMergeResult.mockReturnValue(true);
    let resolve!: (ok: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise((done) => (resolve = done)));
    tab("history", "shared").vm.$emit("close", "others");
    await flushPromises();
    mocks.history.tabs = [{ id: "shared", title: "replacement history" }];
    resolve(true);
    await flushPromises();
    expect(mocks.diff.closeTab).not.toHaveBeenCalled();
    expect(mocks.merge.closeMergeTab).not.toHaveBeenCalled();
    expect(mocks.layout.activeEditorKind).toBe("diff");
  });

  it.each(["current", "others", "right"])(
    "abandons %s when its anchor disappears during confirmation",
    async (scope) => {
      const { tab } = setup();
      mocks.file.tabs[0].dirty = true;
      mocks.merge.hasUnsavedMergeResult.mockReturnValue(true);
      let resolve!: (ok: boolean) => void;
      mocks.confirm.mockImplementation(() => new Promise((done) => (resolve = done)));
      tab("merge", "m").vm.$emit("close", scope);
      await flushPromises();
      mocks.merge.mergeTabs = [];
      resolve(true);
      await flushPromises();
      expect(mocks.file.closeTab).not.toHaveBeenCalled();
      expect(mocks.diff.closeTab).not.toHaveBeenCalled();
      expect(mocks.merge.closeMergeTab).not.toHaveBeenCalled();
      expect(mocks.layout.activeEditorKind).toBe("diff");
    },
  );

  it("ignores a late confirmation after the component unmounts", async () => {
    const { wrapper, tab } = setup();
    mocks.file.tabs[0].dirty = true;
    let resolve!: (ok: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise((done) => (resolve = done)));
    tab("file", "f").vm.$emit("close", "all");
    await flushPromises();
    wrapper.unmount();
    resolve(true);
    await flushPromises();
    expect(mocks.file.closeTab).not.toHaveBeenCalled();
    expect(mocks.diff.closeTab).not.toHaveBeenCalled();
    expect(mocks.layout.activeEditorKind).toBe("diff");
  });

  it("keeps a newly activated tab and restores its focus after closing the old batch", async () => {
    const { tab } = setup();
    mocks.file.tabs[0].dirty = true;
    let resolve!: (ok: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise((done) => (resolve = done)));
    tab("file", "f").vm.$emit("close", "all");
    await flushPromises();
    mocks.file.tabs.push({ id: "new", title: "new draft", dirty: true });
    mocks.file.activeId = "new";
    mocks.layout.activeEditorKind = "file";
    resolve(true);
    await flushPromises();
    expect(mocks.file.tabs.map((item: any) => item.id)).toEqual(["new"]);
    expect(mocks.file.activeId).toBe("new");
    expect(mocks.layout.activeEditorKind).toBe("file");
    expect((document.activeElement as HTMLElement).dataset.editorKey).toBe(
      JSON.stringify(["file", "new"]),
    );
  });

  it("preserves a reopened file and its new draft using the real file store", async () => {
    const { useFileViewerStore } = await vi.importActual<typeof import("@/stores/fileViewerStore")>(
      "@/stores/fileViewerStore",
    );
    mocks.file = useFileViewerStore();
    await mocks.file.open("note.txt", { folderPath: "fixture" });
    const original = mocks.file.tabs[0];
    mocks.file.setDocument(original.id, "old draft");
    const { tab } = setup();
    let resolve!: (ok: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise((done) => (resolve = done)));
    tab("file", original.id).vm.$emit("close", "all");
    await flushPromises();
    mocks.file.closeTab(original.id);
    await mocks.file.open("note.txt", { folderPath: "fixture" });
    mocks.file.setDocument(original.id, "replacement draft");
    resolve(true);
    await flushPromises();
    expect(mocks.file.tabs).toHaveLength(1);
    expect(mocks.file.tabs[0]).not.toBe(original);
    expect(mocks.file.tabs[0]).toMatchObject({
      id: original.id,
      text: "replacement draft",
      dirty: true,
    });
    expect(mocks.layout.activeEditorKind).toBe("file");
    expect(mocks.file.activeId).toBe(original.id);
  });

  it("keeps confirmation valid when a real file instance is renamed", async () => {
    const { useFileViewerStore } = await vi.importActual<typeof import("@/stores/fileViewerStore")>(
      "@/stores/fileViewerStore",
    );
    mocks.file = useFileViewerStore();
    await mocks.file.open("note.txt", { folderPath: "fixture" });
    const original = mocks.file.tabs[0];
    mocks.file.setDocument(original.id, "draft");
    const { tab } = setup();
    let resolve!: (ok: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise((done) => (resolve = done)));
    tab("file", original.id).vm.$emit("close", "current");
    await flushPromises();
    mocks.file.applyFileMutation("fixture", "move", [
      { path: "note.txt", destination: "renamed.txt" },
    ]);
    expect(mocks.file.tabs[0]).toBe(original);
    expect(original.path).toBe("renamed.txt");
    resolve(true);
    await flushPromises();
    expect(mocks.file.tabs).toHaveLength(0);
    expect(mocks.layout.activeEditorKind).toBe("merge");
  });

  it("invalidates the close as soon as a real same-path navigation starts", async () => {
    const { useWorkspaceStore } =
      await vi.importActual<typeof import("@/stores/workspaceStore")>("@/stores/workspaceStore");
    const { useFileViewerStore } = await vi.importActual<typeof import("@/stores/fileViewerStore")>(
      "@/stores/fileViewerStore",
    );
    mocks.workspace = useWorkspaceStore();
    await mocks.workspace.openFolder("fixture");
    mocks.file = useFileViewerStore();
    await mocks.file.open("note.txt", { folderPath: "fixture" });
    mocks.file.setDocument(mocks.file.activeId, "draft");
    const { tab } = setup();
    let resolveClose!: (ok: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise((done) => (resolveClose = done)));
    tab("file", mocks.file.activeId).vm.$emit("close", "all");
    await flushPromises();
    let resolveOpen!: (value: any) => void;
    mocks.workspaceOpen.mockReturnValueOnce(new Promise((done) => (resolveOpen = done)));
    const opening = mocks.workspace.openFolder("fixture");
    resolveClose(true);
    await flushPromises();
    expect(mocks.file.tabs[0]).toMatchObject({ text: "draft", dirty: true });
    expect(mocks.diff.closeTab).not.toHaveBeenCalled();
    resolveOpen({ path: "fixture", isRepo: false, roots: [] });
    await opening;
    await mocks.file.open("note.txt", { folderPath: "fixture" });
    expect(mocks.file.tabs).toHaveLength(1);
    expect(mocks.file.tabs[0].text).toBe("disk text\n");
  });

  it("opens the real context menu without activating its background tab", async () => {
    const { tab } = setup();
    const button = tab("history", "shared").get("[data-editor-key]");
    await button.trigger("contextmenu", { clientX: 120, clientY: 24 });
    await flushPromises();
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(4);
    expect(mocks.layout.activeEditorKind).toBe("diff");
    (document.querySelector('[data-close-scope="others"]') as HTMLElement).click();
    await flushPromises();
    expect(mocks.layout.activeEditorKind).toBe("history");
    expect(mocks.diff.tabs).toHaveLength(0);
  });

  it("supports keyboard opening, Escape, disabled actions and repository dismissal", async () => {
    const { wrapper, tab } = setup();
    const button = tab("file", "f").get("[data-editor-key]");
    (button.element as HTMLElement).focus();
    await button.trigger("keydown", { key: "F10", shiftKey: true });
    await flushPromises();
    expect(
      document.querySelector('[data-close-scope="right"]')?.hasAttribute("data-disabled"),
    ).toBe(true);
    const menu = document.querySelector('[role="menu"]')!;
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button.element);
    await button.trigger("keydown", { key: "F10", shiftKey: true, ctrlKey: true });
    await flushPromises();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await button.trigger("keydown", { key: "ContextMenu" });
    await flushPromises();
    mocks.workspace.repoPath = "other";
    await flushPromises();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(wrapper.findAllComponents(EditorTabButton)).toHaveLength(8);
  });
});
