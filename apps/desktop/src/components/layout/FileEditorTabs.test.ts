import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { reactive } from "vue";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { redo, undo } from "@codemirror/commands";
import { getSearchQuery, openSearchPanel, SearchQuery, setSearchQuery } from "@codemirror/search";
import EditorTabs from "./EditorTabs.vue";
import { useFileViewerStore } from "@/stores/fileViewerStore";
import { beginWorktreeRestore } from "@/stores/worktreeRestoreEditors";
import { fileViewConfig } from "@/features/file/fileEditorState";

const m = vi.hoisted(() => ({
  workspace: {} as any,
  layout: {} as any,
  fsReadFile: vi.fn(),
  diffFile: vi.fn(),
  fileWriteWorktree: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => m.workspace }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => m.layout }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: m.refresh }) }));
vi.mock("@/stores/diffStore", () => ({
  useDiffStore: () => reactive({ tabs: [{ id: "diff", title: "Difference" }], activeId: "diff" }),
}));
vi.mock("@/stores/repoAtRevStore", () => ({
  useRepoAtRevStore: () =>
    reactive({ tabs: [{ id: "revision", title: "Revision" }], activeId: "revision" }),
}));
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: () => reactive({ tabs: [], activeId: null }),
}));
vi.mock("@/stores/compareStore", () => ({
  useCompareStore: () => reactive({ tabs: [], activeId: null }),
}));
vi.mock("@/stores/conflictsStore", () => ({
  useConflictsStore: () => reactive({ mergeTabs: [], activeMergeId: null }),
}));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", async (original) => ({
  ...(await original<typeof import("vue-i18n")>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));

let pinia: Pinia;
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  m.workspace = reactive({
    repoPath: "C:/fixture",
    folderPath: "C:/fixture",
    repoId: "A",
    isRepo: true,
    roots: [],
    token: 1,
    navigationToken() {
      return this.token;
    },
    appliedOpenToken() {
      return this.token;
    },
  });
  m.layout = reactive({ activeEditorKind: "welcome" });
  m.fsReadFile.mockImplementation(async ({ filePath }) =>
    filePath === "a.txt" ? "one\r\ntwo\nthree\r" : "other\n",
  );
  m.diffFile.mockResolvedValue({ rightText: "", hunks: [] });
  m.fileWriteWorktree.mockResolvedValue(null);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
});

async function setup() {
  const files = useFileViewerStore();
  await files.open("a.txt");
  const a = files.tabs[0]!;
  await files.open("b.txt");
  const b = files.tabs[1]!;
  files.activeId = a.id;
  const wrapper = mount(EditorTabs, {
    attachTo: document.body,
    global: {
      stubs: {
        DiffViewer: true,
        FileHistoryView: true,
        RepoAtRevisionView: true,
        CompareView: true,
        MergeViewer: true,
        WelcomeView: true,
      },
    },
  });
  await flushPromises();
  const editor = () => EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;
  const activate = async (kind: string, id = "") => {
    const key = kind === "workspace" ? "workspace" : JSON.stringify([kind, id]);
    const button = wrapper
      .findAll("[data-editor-key]")
      .find((item) => item.attributes("data-editor-key") === key)!;
    await button.trigger("click");
    await flushPromises();
  };
  return { files, a, b, wrapper, editor, activate };
}

it.each(["file", "workspace", "repoAtRev", "diff"])(
  "preserves saved edits, selection and undo through actual %s tab navigation while releasing the hidden view",
  async (kind) => {
    const { files, a, b, wrapper, editor, activate } = await setup();
    const first = editor();
    first.dispatch({
      changes: { from: 0, to: 3, insert: "edited" },
      selection: { anchor: 2, head: 5 },
    });
    await files.save(a.id);
    const selection = first.state.selection;
    const destroy = vi.spyOn(first, "destroy");
    await activate(kind, kind === "file" ? b.id : kind === "repoAtRev" ? "revision" : "diff");
    expect(destroy).toHaveBeenCalledOnce();
    expect(first.dom.isConnected).toBe(false);
    expect(wrapper.findAll(".cm-editor")).toHaveLength(kind === "file" ? 1 : 0);
    await activate("file", a.id);
    const restored = editor();
    expect(restored).not.toBe(first);
    expect(restored.state.selection.eq(selection)).toBe(true);
    expect(undo(restored)).toBe(true);
    expect(a.text).toBe("one\r\ntwo\nthree\r");
    expect(a.dirty).toBe(true);
    expect(redo(restored)).toBe(true);
    expect(a.dirty).toBe(false);
  },
);

it("keeps independent undo and search state when returning between files", async () => {
  const { a, b, editor, activate } = await setup();
  editor().dispatch({
    changes: { from: 0, insert: "A " },
    effects: setSearchQuery.of(new SearchQuery({ search: "two", caseSensitive: true })),
  });
  openSearchPanel(editor());
  await activate("file", b.id);
  editor().dispatch({ changes: { from: 0, insert: "B " } });
  await activate("file", a.id);
  expect(getSearchQuery(editor().state).search).toBe("two");
  expect(getSearchQuery(editor().state).caseSensitive).toBe(true);
  expect(undo(editor())).toBe(true);
  expect(a.text).toBe("one\r\ntwo\nthree\r");
  expect(b.text).toBe("B other\n");
  await activate("file", b.id);
  expect(getSearchQuery(editor().state).search).toBe("");
  expect(undo(editor())).toBe(true);
  expect(b.text).toBe("other\n");
});

it("consumes a search reveal once and honors a new target after restoring a tab", async () => {
  const { files, a, b, editor, activate } = await setup();
  await files.open("a.txt", { folderPath: "C:/fixture", line: 2, column: 2 });
  await flushPromises();
  expect(editor().state.selection.main.head).toBe(5);
  // happy-dom emits selectionchange synchronously during CodeMirror updates.
  editor().contentDOM.blur();
  editor().dispatch({ selection: { anchor: 1 } });
  await activate("file", b.id);
  await activate("file", a.id);
  expect(editor().state.selection.main.head).toBe(1);
  await activate("workspace");
  await files.open("a.txt", { folderPath: "C:/fixture", line: 3, column: 3 });
  await flushPromises();
  expect(editor().state.selection.main.head).toBe(10);
});

it("does not recover a closed tab's old undo stack when the same path and id reopen", async () => {
  const { files, a, b, editor, activate } = await setup();
  editor().dispatch({ changes: { from: 0, insert: "old " } });
  await activate("file", b.id);
  files.closeTab(a.id);
  m.fsReadFile.mockResolvedValueOnce("reopened\n");
  await files.open("a.txt");
  await flushPromises();
  expect(files.activeId).toBe(a.id);
  expect(editor().state.doc.toString()).toBe("reopened\n");
  expect(undo(editor())).toBe(false);
});

it("uses new externally supplied text instead of restoring stale history", async () => {
  const { files, a, editor, activate } = await setup();
  editor().dispatch({ changes: { from: 0, insert: "old " } });
  await activate("workspace");
  files.setDocument(a.id, "external replacement\n");
  await activate("file", a.id);
  expect(editor().state.doc.toString()).toBe("external replacement\n");
  expect(undo(editor())).toBe(false);
});

it("retains the original editor while another file is still loading", async () => {
  const { files, a, wrapper, editor, activate } = await setup();
  editor().dispatch({ changes: { from: 0, insert: "draft " }, selection: { anchor: 4 } });
  let finish!: (value: string) => void;
  m.fsReadFile.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  const opening = files.open("loading.txt");
  await flushPromises();
  expect(wrapper.findAll(".cm-editor")).toHaveLength(0);
  await activate("file", a.id);
  expect(editor().state.selection.main.head).toBe(4);
  expect(undo(editor())).toBe(true);
  finish("loaded\n");
  await opening;
  await flushPromises();
  expect(files.activeId).toBe(a.id);
  expect(editor().state.doc.toString()).toBe("one\ntwo\nthree\n");
});

it("keeps undo relative to the completed save when saving finishes in a hidden tab", async () => {
  const { files, a, editor, activate } = await setup();
  editor().dispatch({ changes: { from: 0, insert: "saved " } });
  let finish!: () => void;
  m.fileWriteWorktree.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const saving = files.save(a.id);
  await activate("workspace");
  finish();
  await saving;
  await activate("file", a.id);
  expect(a.dirty).toBe(false);
  expect(undo(editor())).toBe(true);
  expect(a.dirty).toBe(true);
  expect(a.text).toBe("one\r\ntwo\nthree\r");
});

it("preserves a renamed hidden file's history and saves to its new destination", async () => {
  const { files, a, editor, activate } = await setup();
  editor().dispatch({ changes: { from: 0, insert: "draft " } });
  await activate("workspace");
  files.applyFileMutation("C:/fixture", "rename", [{ path: "a.txt", destination: "renamed.txt" }]);
  await activate("file", a.id);
  expect(undo(editor())).toBe(true);
  expect(a.dirty).toBe(false);
  expect(redo(editor())).toBe(true);
  await files.save(a.id);
  expect(m.fileWriteWorktree).toHaveBeenCalledWith(
    expect.objectContaining({ filePath: "renamed.txt", content: "draft one\r\ntwo\nthree\r" }),
  );
});

it("reapplies temporary write protection when returning to a cached editor", async () => {
  const { files, a, editor, activate } = await setup();
  editor().dispatch({ changes: { from: 0, insert: "saved " } });
  await files.save(a.id);
  await activate("workspace");
  const restore = beginWorktreeRestore("C:/fixture", ["a.txt"]);
  await activate("file", a.id);
  expect(editor().state.facet(EditorState.readOnly)).toBe(true);
  expect(undo(editor())).toBe(false);
  restore.release();
  expect(editor().state.facet(EditorState.readOnly)).toBe(false);
  expect(undo(editor())).toBe(true);
});

it.each(["generation", "navigation", "disposal"])(
  "invalidates hidden state after %s",
  async (kind) => {
    const { files, a, editor, activate } = await setup();
    editor().dispatch({ changes: { from: 0, insert: "draft " } });
    await activate("workspace");
    if (kind === "generation") a.loadGeneration++;
    if (kind === "navigation") m.workspace.token++;
    if (kind === "disposal") disposePinia(pinia);
    expect(files.takeEditorSnapshot(a)).toBeUndefined();
  },
);

it("drops component callbacks from hidden state and releases it when its tab closes", async () => {
  const { files, a, wrapper, editor, activate } = await setup();
  const destroy = vi.spyOn(editor(), "destroy");
  await activate("workspace");
  const snapshot = files.takeEditorSnapshot(a)!;
  expect(snapshot).toBeTruthy();
  expect(fileViewConfig.get(snapshot.state)).toEqual([]);
  expect(snapshot.state.facet(EditorView.updateListener)).toEqual([]);
  expect(destroy).toHaveBeenCalledOnce();
  expect(wrapper.findAll(".cm-editor")).toHaveLength(0);
  files.cacheEditorSnapshot(a, snapshot);
  files.closeTab(a.id);
  expect(files.takeEditorSnapshot(a)).toBeUndefined();
  files.cacheEditorSnapshot(a, snapshot);
  expect(files.takeEditorSnapshot(a)).toBeUndefined();
});
