import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
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
}));
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
  mocks.workspace = reactive({ repoPath: "fixture", folderPath: "fixture" });
  mocks.layout = reactive({ activeEditorKind: "diff" });
  mocks.diff = store("diff", ["shared", "d2"]);
  mocks.history = store("history", ["shared"]);
  mocks.compare = store("compare", ["c"]);
  mocks.repoAtRev = store("repoAtRev", ["r"]);
  mocks.file = store("file", ["f"]);
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
