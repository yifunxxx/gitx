import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive } from "vue";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { redo, undo } from "@codemirror/commands";
import { SearchQuery, replaceAll, setSearchQuery } from "@codemirror/search";
import FileViewer from "./FileViewer.vue";
import { useFileViewerStore } from "@/stores/fileViewerStore";
import { beginWorktreeRestore } from "@/stores/worktreeRestoreEditors";

const mocks = vi.hoisted(() => ({
  diffFile: vi.fn(),
  fileWriteWorktree: vi.fn(),
  fsReadFile: vi.fn(),
  fsWriteFile: vi.fn(),
  workspace: {} as any,
  layout: {} as any,
  changes: { refresh: vi.fn() },
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/conflictsStore", () => ({
  useConflictsStore: () => ({ busy: false, mergeTabs: [] }),
}));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", async (original) => ({
  ...(await original<typeof import("vue-i18n")>()),
  useI18n: () => ({ t: (key: string) => key }),
}));

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.workspace = reactive({
    repoPath: "repo-A",
    repoId: "repo-A",
    isRepo: true,
    navigationToken: () => 1,
  });
  mocks.layout = reactive({ activeEditorKind: "welcome" });
  mocks.fileWriteWorktree.mockResolvedValue(null);
  mocks.fsWriteFile.mockResolvedValue(null);
  mocks.fsReadFile.mockResolvedValue("base\n");
  mocks.diffFile.mockResolvedValue({ rightText: "base\n", hunks: [] });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      readText: vi.fn(async () => "pasted"),
      writeText: vi.fn(async () => {}),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const result = (text: string) => ({ rightText: text, hunks: [] });
const editor = (wrapper: ReturnType<typeof mount>) =>
  EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;

it("temporarily protects a restored file without losing selection or undo after failure", async () => {
  const store = useFileViewerStore();
  await store.open("a.txt");
  const tab = store.tabs[0]!;
  const wrapper = mount(FileViewer, { props: { tabId: tab.id } });
  await flushPromises();
  const cm = editor(wrapper);
  cm.dispatch({ changes: { from: 0, to: 4, insert: "saved" }, selection: { anchor: 3 } });
  await store.save(tab.id);
  const selection = cm.state.selection;
  const lock = beginWorktreeRestore("repo-A", ["a.txt"]);
  await flushPromises();
  expect(editor(wrapper)).toBe(cm);
  expect(cm.state.facet(EditorState.readOnly)).toBe(true);
  expect(wrapper.get('[role="status"]').text()).toContain("history.restoring");
  expect(wrapper.attributes("aria-busy")).toBe("true");
  expect(cm.contentDOM.getAttribute("contenteditable")).toBe("false");
  expect(undo(cm)).toBe(false);
  expect(cm.state.doc.toString()).toBe("saved\n");
  lock.release();
  await flushPromises();
  expect(editor(wrapper)).toBe(cm);
  expect(cm.state.selection.eq(selection)).toBe(true);
  expect(cm.state.facet(EditorState.readOnly)).toBe(false);
  expect(undo(cm)).toBe(true);
  expect(tab.text).toBe("base\n");
  expect(tab.dirty).toBe(true);
});
it("reveals a search result after loading and keeps a cached draft and undo history", async () => {
  mocks.fsReadFile.mockResolvedValue("first\n😀 match\nlast");
  const store = useFileViewerStore();
  const pending = store.open("a.txt", { folderPath: "C:/plain", line: 2, column: 4 });
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await pending;
  await flushPromises();
  const view = editor(wrapper);
  expect(view.state.selection.main.head).toBe(9);
  view.dispatch({ changes: { from: view.state.doc.length, insert: " draft" } });
  await store.open("a.txt", { folderPath: "C:/plain", line: 999, column: 999 });
  await flushPromises();
  expect(editor(wrapper)).toBe(view);
  expect(view.state.selection.main.head).toBe(view.state.doc.length);
  expect(view.state.doc.toString()).toContain(" draft");
  undo(view);
  expect(view.state.doc.toString()).not.toContain(" draft");
});

it("renders the first asynchronous file result after the loading host is replaced", async () => {
  const response = deferred();
  mocks.fsReadFile.mockReturnValue(response.promise);
  const store = useFileViewerStore();
  const pending = store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  expect(wrapper.text()).toContain("Loading");
  expect(wrapper.find(".cm-editor").exists()).toBe(false);
  response.resolve("base\nworking\n");
  await pending;
  await flushPromises();
  expect(wrapper.text()).not.toContain("Loading");
  expect(editor(wrapper).state.doc.toString()).toBe("base\nworking\n");
  expect(wrapper.findAll(".cm-editor")).toHaveLength(1);
});
it("preserves the editor instance and undo on rename and can reopen the old path", async () => {
  mocks.fsReadFile.mockResolvedValue("original");
  const store = useFileViewerStore();
  await store.open("a.txt", { folderPath: "C:/plain" });
  const id = store.activeId!;
  const wrapper = mount(FileViewer, { props: { tabId: id } });
  await flushPromises();
  const view = editor(wrapper);
  view.dispatch({ changes: { from: 0, to: 8, insert: "draft" } });
  store.applyFileMutation("C:/plain", "rename", [{ path: "a.txt", destination: "b.txt" }]);
  await flushPromises();
  expect(editor(wrapper)).toBe(view);
  expect(store.activeId).toBe(id);
  expect(store.tabs[0]?.path).toBe("b.txt");
  undo(view);
  expect(view.state.doc.toString()).toBe("original");
  await store.open("a.txt", { folderPath: "C:/plain" });
  expect(new Set(store.tabs.map((tab) => tab.id)).size).toBe(2);
});

it("displays an asynchronous load failure instead of a blank document", async () => {
  const response = deferred();
  mocks.fsReadFile.mockReturnValue(response.promise);
  const store = useFileViewerStore();
  const pending = store.open("missing.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  response.reject(new Error("missing file"));
  await pending;
  await flushPromises();
  expect(editor(wrapper).state.doc.toString()).toContain("missing file");
});

it("renders a rejected binary Commit file read-only and refuses editing or saving", async () => {
  mocks.fsReadFile.mockRejectedValueOnce(new Error("binary files cannot be edited as text"));
  mocks.diffFile.mockResolvedValue({ rightText: null, hunks: [], binary: true });
  const store = useFileViewerStore();
  await store.open("binary.dat");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const cm = editor(wrapper);
  expect(cm.state.facet(EditorState.readOnly)).toBe(true);
  expect(cm.contentDOM.getAttribute("contenteditable")).toBe("false");
  store.setDocument(store.activeId!, "overwrite");
  expect(store.tabs[0]!.text).toContain("binary files cannot be edited as text");
  expect(await store.saveActive()).toBe(false);
  expect(mocks.fileWriteWorktree).not.toHaveBeenCalled();
});

it("renders cached empty files and releases each editor when switching through a loading file", async () => {
  mocks.fsReadFile.mockResolvedValueOnce("");
  const store = useFileViewerStore();
  await store.open("empty.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await nextTick();
  const first = editor(wrapper);
  expect(first.state.doc.length).toBe(0);
  const firstDestroy = vi.spyOn(first, "destroy");

  const response = deferred();
  mocks.fsReadFile.mockReturnValueOnce(response.promise);
  const pending = store.open("later.txt");
  await wrapper.setProps({ tabId: store.activeId! });
  expect(wrapper.text()).toContain("Loading");
  expect(firstDestroy).toHaveBeenCalledOnce();
  response.resolve("later");
  await pending;
  await flushPromises();
  const second = editor(wrapper);
  expect(second.state.doc.toString()).toBe("later");
  const secondDestroy = vi.spyOn(second, "destroy");
  wrapper.unmount();
  expect(firstDestroy).toHaveBeenCalledOnce();
  expect(secondDestroy).toHaveBeenCalledOnce();
});

it("clears repository-specific file tabs and ignores an old response after A → B → A", async () => {
  const old = deferred();
  mocks.fsReadFile.mockReturnValueOnce(old.promise);
  const store = useFileViewerStore();
  const pending = store.open("a.txt");
  mocks.workspace.repoPath = "repo-B";
  expect(store.tabs).toEqual([]);
  expect(store.activeId).toBeNull();
  mocks.workspace.repoPath = "repo-A";
  mocks.fsReadFile.mockResolvedValueOnce("current");
  await store.open("a.txt");
  old.resolve("obsolete");
  await pending;
  expect(store.tabs).toHaveLength(1);
  expect(store.tabs[0]!.text).toBe("current");
});

it("does not overwrite a reopened file with the closed tab's late response", async () => {
  const old = deferred();
  mocks.fsReadFile.mockReturnValueOnce(old.promise);
  const store = useFileViewerStore();
  const pending = store.open("a.txt");
  store.closeTab(store.activeId!);
  mocks.fsReadFile.mockResolvedValueOnce("reopened");
  await store.open("a.txt");
  old.resolve("closed");
  await pending;
  expect(store.tabs).toHaveLength(1);
  expect(store.tabs[0]!.text).toBe("reopened");
});

it("marks the tab dirty after edits and clears dirty when restored to baseline", async () => {
  mocks.fsReadFile.mockResolvedValueOnce("base\n");
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await nextTick();
  const cm = editor(wrapper);
  expect(cm.state.facet(EditorState.readOnly)).toBe(false);
  expect(cm.contentDOM.getAttribute("contenteditable")).toBe("true");
  cm.dispatch({
    changes: { from: 0, to: cm.state.doc.length, insert: "edited\n" },
  });
  await flushPromises();
  expect(store.tabs[0]!.dirty).toBe(true);
  expect(store.tabs[0]!.text).toBe("edited\n");
  cm.dispatch({
    changes: { from: 0, to: cm.state.doc.length, insert: "base\n" },
  });
  await flushPromises();
  expect(store.tabs[0]!.dirty).toBe(false);
});

it.each([
  ["BOM and CRLF", "\ufefffirst\r\nsecond\r\n"],
  ["mixed line endings", "\ufefffirst\r\nsecond\nthird\rfourth\r\n"],
])("restores the exact saved %s bytes after undo", async (_label, baseline) => {
  mocks.fsReadFile.mockResolvedValueOnce(baseline);
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const cm = editor(wrapper);
  cm.dispatch({ changes: { from: 1, to: 6, insert: "changed" } });
  expect(store.tabs[0]!.dirty).toBe(true);
  expect(undo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe(baseline);
  expect(store.tabs[0]!.dirty).toBe(false);
  expect(await store.saveActive()).toBe(true);
  expect(mocks.fileWriteWorktree).not.toHaveBeenCalled();
  expect(redo(cm)).toBe(true);
  expect(store.tabs[0]!.dirty).toBe(true);
  expect(undo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe(baseline);
  expect(store.tabs[0]!.dirty).toBe(false);
});

it("compares undo against the latest successful save instead of the initial baseline", async () => {
  const baseline = "\ufefffirst\r\nsecond\nthird\r";
  mocks.fsReadFile.mockResolvedValueOnce(baseline);
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const cm = editor(wrapper);
  cm.dispatch({ changes: { from: 1, to: 6, insert: "saved" }, userEvent: "input.paste" });
  const saved = store.tabs[0]!.text;
  expect(await store.saveActive()).toBe(true);
  cm.dispatch({
    changes: { from: cm.state.doc.length, insert: "later" },
    userEvent: "input.paste",
  });
  expect(undo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe(saved);
  expect(store.tabs[0]!.dirty).toBe(false);
  expect(undo(cm)).toBe(true);
  expect(store.tabs[0]!.dirty).toBe(true);
  expect(store.tabs[0]!.baseline).toBe(saved);
});

it.each([
  ["CRLF", "first\r\nsecond\r\n"],
  ["BOM and mixed endings", "\ufefffirst\r\nsecond\nthird\rfourth"],
  ["CR", "first\rsecond\r"],
  ["LF", "first\nsecond\n"],
])("preserves untouched %s bytes when editing and saving one word", async (_label, baseline) => {
  mocks.fsReadFile.mockResolvedValueOnce(baseline);
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const cm = editor(wrapper);
  const from = cm.state.doc.toString().indexOf("second");
  cm.dispatch({ changes: { from, to: from + 6, insert: "changed" } });
  const expected = baseline.replace("second", "changed");
  expect(store.tabs[0]!.text).toBe(expected);
  expect(await store.saveActive()).toBe(true);
  expect(mocks.fileWriteWorktree.mock.calls[0]![0].content).toBe(expected);
  expect(store.tabs[0]!.dirty).toBe(false);
  expect(undo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe(baseline);
  expect(store.tabs[0]!.dirty).toBe(true);
  expect(redo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe(expected);
  expect(store.tabs[0]!.dirty).toBe(false);
});

it("uses the existing newline style for inserted lines in a non-Git file", async () => {
  const baseline = "\ufeffone\r\ntwo\nthree\rfour";
  mocks.workspace.isRepo = false;
  mocks.fsReadFile.mockResolvedValueOnce(baseline);
  const store = useFileViewerStore();
  await store.open("note.txt", { folderPath: "C:/plain" });
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const cm = editor(wrapper);
  cm.dispatch({ changes: { from: 4, insert: "\nnew" } });
  const expected = "\ufeffone\r\nnew\r\ntwo\nthree\rfour";
  expect(store.tabs[0]!.text).toBe(expected);
  expect(await store.saveActive()).toBe(true);
  expect(mocks.fsWriteFile.mock.calls[0]![0].content).toBe(expected);
  expect(undo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe(baseline);
  expect(redo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe(expected);
});

it("restores mixed endings across a multi-line deletion after saving and remounting", async () => {
  const baseline = "one\r\ntwo\nthree\rfour";
  mocks.fsReadFile.mockResolvedValueOnce(baseline);
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const cm = editor(wrapper);
  cm.dispatch({ changes: { from: 2, to: 10, insert: "X\nY" } });
  const expected = "onX\r\nYree\rfour";
  expect(store.tabs[0]!.text).toBe(expected);
  expect(await store.saveActive()).toBe(true);
  expect(undo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe(baseline);
  expect(redo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe(expected);
  wrapper.unmount();
  const remounted = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const reopened = editor(remounted);
  reopened.dispatch({ changes: { from: 0, insert: "edited " } });
  expect(await store.saveActive()).toBe(true);
  expect(mocks.fileWriteWorktree.mock.calls[1]![0].content).toBe("edited " + expected);
});

it("keeps each original separator through Replace All, save and undo", async () => {
  const baseline = "\ufeffmatch\r\nmatch\nmatch\rlast";
  mocks.fsReadFile.mockResolvedValueOnce(baseline);
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const cm = editor(wrapper);
  cm.dispatch({
    effects: setSearchQuery.of(new SearchQuery({ search: "match", replace: "done" })),
  });
  expect(replaceAll(cm)).toBe(true);
  const expected = "\ufeffdone\r\ndone\ndone\rlast";
  expect(store.tabs[0]!.text).toBe(expected);
  expect(await store.saveActive()).toBe(true);
  expect(mocks.fileWriteWorktree.mock.calls[0]![0].content).toBe(expected);
  expect(undo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe(baseline);
  expect(redo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe(expected);
  expect(store.tabs[0]!.dirty).toBe(false);
});

it.each(["middle", "end"])(
  "preserves line endings and caret position when pasting CRLF text at the %s",
  async (position) => {
    const baseline = "\ufeffone\r\nlast tail";
    mocks.fsReadFile.mockResolvedValueOnce(baseline);
    const clipboard = deferred();
    vi.mocked(navigator.clipboard.readText).mockReturnValueOnce(clipboard.promise);
    const store = useFileViewerStore();
    await store.open("a.txt");
    const wrapper = mount(FileViewer, {
      props: { tabId: store.activeId! },
      attachTo: document.body,
    });
    await flushPromises();
    const cm = editor(wrapper);
    const from = position === "middle" ? 1 : cm.state.doc.length;
    cm.dispatch({ selection: { anchor: from } });
    await clickEditorMenu(wrapper, "paste");
    // Avoid happy-dom's synchronous selectionchange during a focused CM update.
    cm.contentDOM.blur();
    clipboard.resolve("A\r\nB");
    await flushPromises();
    const expected = position === "middle" ? "\ufeffA\r\nBone\r\nlast tail" : baseline + "A\r\nB";
    expect(store.tabs[0]!.text).toBe(expected);
    expect(cm.state.selection.main.head).toBe(from + 3);
    expect(await store.saveActive()).toBe(true);
    expect(mocks.fileWriteWorktree.mock.calls[0]![0].content).toBe(expected);
    expect(undo(cm)).toBe(true);
    expect(store.tabs[0]!.text).toBe(baseline);
  },
);

it("keeps newline metadata with edits made during a pending save", async () => {
  const baseline = "one\r\ntwo\nthree\r";
  mocks.fsReadFile.mockResolvedValueOnce(baseline);
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const cm = editor(wrapper);
  cm.dispatch({ changes: { from: 0, insert: "saved " }, userEvent: "input.paste" });
  const write = deferred();
  mocks.fileWriteWorktree.mockReturnValueOnce(write.promise);
  const saving = store.saveActive();
  cm.dispatch({
    changes: { from: cm.state.doc.length, insert: "later\n" },
    userEvent: "input.paste",
  });
  write.resolve(null);
  expect(await saving).toBe(true);
  expect(store.tabs[0]!.baseline).toBe("saved " + baseline);
  expect(store.tabs[0]!.text).toBe("saved " + baseline + "later\r\n");
  expect(store.tabs[0]!.dirty).toBe(true);
  expect(undo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe("saved " + baseline);
  expect(store.tabs[0]!.dirty).toBe(false);
  expect(redo(cm)).toBe(true);
  expect(await store.saveActive()).toBe(true);
  expect(mocks.fileWriteWorktree.mock.calls[1]![0].content).toBe("saved " + baseline + "later\r\n");
});

it("writes through Ctrl/Cmd+S path, clears dirty, and refreshes Changes", async () => {
  mocks.diffFile
    .mockResolvedValueOnce(result("base\n"))
    .mockResolvedValueOnce({ rightText: "saved\n", hunks: [] });
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, {
    props: { tabId: store.activeId! },
    attachTo: document.body,
  });
  await nextTick();
  const cm = editor(wrapper);
  cm.dispatch({
    changes: { from: 0, to: cm.state.doc.length, insert: "saved\n" },
  });
  await flushPromises();
  expect(store.tabs[0]!.dirty).toBe(true);
  expect(await store.save(store.activeId)).toBe(true);
  expect(mocks.fileWriteWorktree).toHaveBeenCalledExactlyOnceWith({
    repoId: "repo-A",
    path: "repo-A",
    filePath: "a.txt",
    content: "saved\n",
  });
  expect(store.tabs[0]!.dirty).toBe(false);
  expect(store.tabs[0]!.baseline).toBe("saved\n");
  expect(mocks.changes.refresh).toHaveBeenCalledOnce();
});

it("offers Cut/Copy on a selection and Save/Undo on empty editor chrome", async () => {
  mocks.fsReadFile.mockResolvedValueOnce("hello\n");
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, {
    props: { tabId: store.activeId! },
    attachTo: document.body,
  });
  await nextTick();
  const cm = editor(wrapper);
  cm.dispatch({ selection: { anchor: 0, head: 5 } });
  await wrapper.get("[data-file-viewer-host]").trigger("contextmenu", { clientX: 20, clientY: 30 });
  await flushPromises();
  const selected = document.querySelector('[role="menu"]')!;
  expect(selected.textContent).toContain("editor.cut");
  expect(selected.textContent).toContain("editor.copy");
  expect(selected.textContent).toContain("editor.save");
  selected.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flushPromises();

  cm.dispatch({
    changes: { from: 0, to: cm.state.doc.length, insert: "edited\n" },
    selection: { anchor: 0 },
  });
  await flushPromises();
  await wrapper.get("[data-file-viewer-host]").trigger("contextmenu", { clientX: 24, clientY: 36 });
  await flushPromises();
  const empty = document.querySelector('[role="menu"]')!;
  expect(empty.textContent).not.toContain("editor.cut");
  expect(empty.textContent).toContain("editor.paste");
  expect(empty.textContent).toContain("editor.undo");
  expect(empty.textContent).toContain("editor.save");
  const save = Array.from(empty.querySelectorAll('[role="menuitem"]')).find((item) =>
    item.textContent?.includes("editor.save"),
  ) as HTMLButtonElement;
  expect(save.disabled).toBe(false);
  save.click();
  await flushPromises();
  expect(mocks.fileWriteWorktree).toHaveBeenCalledOnce();
  expect(store.tabs[0]!.dirty).toBe(false);
});

it("retains edits made during a save and gutter refresh, and saves them on the next request", async () => {
  const write = deferred();
  const refresh = deferred();
  mocks.diffFile.mockResolvedValueOnce(result("base\n")).mockReturnValueOnce(refresh.promise);
  mocks.fileWriteWorktree.mockReturnValueOnce(write.promise);
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const cm = editor(wrapper);
  cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: "saved\n" } });
  const saving = store.save(store.activeId);
  cm.dispatch({ changes: { from: cm.state.doc.length, insert: "during write\n" } });
  expect(store.tabs[0]!.text).toBe("saved\nduring write\n");
  expect(await store.save(store.activeId)).toBe(false);
  expect(mocks.fileWriteWorktree).toHaveBeenCalledOnce();
  write.resolve(null);
  await flushPromises();
  expect(store.tabs[0]!.baseline).toBe("saved\n");
  expect(store.tabs[0]!.dirty).toBe(true);
  cm.dispatch({ changes: { from: cm.state.doc.length, insert: "during refresh\n" } });
  refresh.resolve(result("saved\n"));
  await saving;
  await flushPromises();
  expect(editor(wrapper)).toBe(cm);
  expect(cm.state.doc.toString()).toBe("saved\nduring write\nduring refresh\n");
  expect(store.tabs[0]!.dirty).toBe(true);
  mocks.diffFile.mockResolvedValueOnce(result(store.tabs[0]!.text));
  expect(await store.save(store.activeId)).toBe(true);
  expect(mocks.fileWriteWorktree.mock.calls[1]![0].content).toBe(
    "saved\nduring write\nduring refresh\n",
  );
  expect(store.tabs[0]!.dirty).toBe(false);
});

it("allows a second save and keeps selection and undo while Git line marks are pending", async () => {
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const cm = editor(wrapper);
  const read = deferred();
  mocks.diffFile.mockReturnValueOnce(read.promise);
  cm.dispatch({ changes: { from: 0, insert: "first " }, userEvent: "input.paste" });
  const first = store.saveActive();
  await flushPromises();
  expect(wrapper.text()).not.toContain("editor.saving");
  cm.dispatch({
    changes: { from: 0, insert: "second " },
    selection: { anchor: 2, head: 4 },
    userEvent: "input.paste",
  });
  mocks.diffFile.mockResolvedValueOnce(result("second first base\n"));
  const second = store.saveActive();
  await flushPromises();
  expect(mocks.fileWriteWorktree.mock.calls[1]![0].content).toBe("second first base\n");
  read.resolve(result("first base\n"));
  expect(await Promise.all([first, second])).toEqual([true, true]);
  await flushPromises();
  expect(editor(wrapper)).toBe(cm);
  expect(cm.state.selection.main.anchor).toBe(2);
  expect(cm.state.selection.main.head).toBe(4);
  expect(undo(cm)).toBe(true);
  expect(store.tabs[0]).toMatchObject({ text: "first base\n", dirty: true });
});

it("retains the editor, selection and undo history when saved highlights refresh", async () => {
  mocks.diffFile.mockResolvedValueOnce(result("base\n")).mockResolvedValueOnce({
    rightText: "saved\n",
    hunks: [
      {
        index: 0,
        header: "@@ -1 +1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ["-base", "+saved"],
      },
    ],
  });
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const cm = editor(wrapper);
  cm.dispatch({
    changes: { from: 0, to: cm.state.doc.length, insert: "saved\n" },
    selection: { anchor: 2, head: 4 },
  });
  await store.save(store.activeId);
  await flushPromises();
  expect(editor(wrapper)).toBe(cm);
  expect(cm.state.selection.main.anchor).toBe(2);
  expect(cm.state.selection.main.head).toBe(4);
  expect(wrapper.find(".cm-file-modified").exists()).toBe(true);
  expect(undo(cm)).toBe(true);
  expect(store.tabs[0]!.text).toBe("base\n");
  expect(store.tabs[0]!.dirty).toBe(true);
});

it("keeps later edits after a write failure and retries with the latest draft", async () => {
  const write = deferred();
  mocks.diffFile.mockResolvedValue(result("base\n"));
  mocks.fileWriteWorktree.mockReturnValueOnce(write.promise);
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const cm = editor(wrapper);
  cm.dispatch({ changes: { from: 0, insert: "initial " } });
  const saving = store.save(store.activeId);
  cm.dispatch({ changes: { from: 0, insert: "later " } });
  write.reject(new Error("write failed"));
  expect(await saving).toBe(false);
  expect(store.tabs[0]!.text).toBe("later initial base\n");
  expect(store.tabs[0]!.baseline).toBe("base\n");
  expect(store.tabs[0]!.dirty).toBe(true);
  expect(await store.save(store.activeId)).toBe(true);
  expect(mocks.fileWriteWorktree.mock.calls[1]![0].content).toBe("later initial base\n");
});

async function clickEditorMenu(wrapper: ReturnType<typeof mount>, action: string) {
  await wrapper.get("[data-file-viewer-host]").trigger("contextmenu", { clientX: 20, clientY: 30 });
  await flushPromises();
  const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) =>
    item.textContent?.includes(`editor.${action}`),
  ) as HTMLButtonElement;
  expect(item.disabled).toBe(false);
  item.click();
  await flushPromises();
}

it("does not apply a pending paste to a different file or the disposed editor", async () => {
  const clipboard = deferred();
  vi.mocked(navigator.clipboard.readText).mockReturnValueOnce(clipboard.promise);
  mocks.fsReadFile.mockResolvedValueOnce("first").mockResolvedValueOnce("second");
  const store = useFileViewerStore();
  await store.open("a.txt");
  const first = store.tabs[0]!;
  const wrapper = mount(FileViewer, { props: { tabId: first.id }, attachTo: document.body });
  await flushPromises();
  const original = editor(wrapper);
  await clickEditorMenu(wrapper, "paste");
  await store.open("b.txt");
  await wrapper.setProps({ tabId: store.activeId! });
  const oldDispatch = vi.spyOn(original, "dispatch");
  clipboard.resolve("clipboard text");
  await flushPromises();
  expect(oldDispatch).not.toHaveBeenCalled();
  expect(first.text).toBe("first");
  expect(store.tabs[1]!.text).toBe("second");
  expect(editor(wrapper).state.doc.toString()).toBe("second");
});

it("does not cut stale positions after the draft changed while copying", async () => {
  const clipboard = deferred();
  vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(clipboard.promise);
  mocks.fsReadFile.mockResolvedValueOnce("hello world");
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! }, attachTo: document.body });
  await flushPromises();
  const cm = editor(wrapper);
  cm.dispatch({ selection: { anchor: 0, head: 5 } });
  await clickEditorMenu(wrapper, "cut");
  cm.contentDOM.blur();
  cm.dispatch({ changes: { from: 0, insert: "new " } });
  clipboard.resolve(undefined);
  await flushPromises();
  expect(store.tabs[0]!.text).toBe("new hello world");
});

it("abandons pending paste after the user moves the selection", async () => {
  const clipboard = deferred();
  vi.mocked(navigator.clipboard.readText).mockReturnValueOnce(clipboard.promise);
  mocks.fsReadFile.mockResolvedValueOnce("hello world");
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! }, attachTo: document.body });
  await flushPromises();
  const cm = editor(wrapper);
  await clickEditorMenu(wrapper, "paste");
  cm.contentDOM.blur();
  cm.dispatch({ selection: { anchor: 6, head: 11 } });
  clipboard.resolve("new");
  await flushPromises();
  expect(store.tabs[0]!.text).toBe("hello world");
  expect(cm.state.selection.main.from).toBe(6);
  expect(cm.state.selection.main.to).toBe(11);
});

it.each(["cut", "paste"])(
  "still applies a current %s operation as an undoable edit",
  async (action) => {
    const clipboard = deferred();
    if (action === "cut")
      vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(clipboard.promise);
    else vi.mocked(navigator.clipboard.readText).mockReturnValueOnce(clipboard.promise);
    mocks.fsReadFile.mockResolvedValueOnce("hello world");
    const store = useFileViewerStore();
    await store.open("a.txt");
    const wrapper = mount(FileViewer, {
      props: { tabId: store.activeId! },
      attachTo: document.body,
    });
    await flushPromises();
    const cm = editor(wrapper);
    cm.dispatch({ selection: { anchor: 0, head: 5 } });
    await clickEditorMenu(wrapper, action);
    // happy-dom fires selectionchange synchronously during focused CM updates.
    cm.contentDOM.blur();
    clipboard.resolve(action === "cut" ? undefined : "pasted");
    await flushPromises();
    expect(store.tabs[0]!.text).toBe(action === "cut" ? " world" : "pasted world");
    expect(store.tabs[0]!.dirty).toBe(true);
    expect(undo(cm)).toBe(true);
    expect(store.tabs[0]!.text).toBe("hello world");
  },
);

it("abandons a pending paste after closing and reopening the same file", async () => {
  const clipboard = deferred();
  vi.mocked(navigator.clipboard.readText).mockReturnValueOnce(clipboard.promise);
  mocks.fsReadFile.mockResolvedValueOnce("first").mockResolvedValueOnce("reopened");
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! }, attachTo: document.body });
  await flushPromises();
  const original = editor(wrapper);
  await clickEditorMenu(wrapper, "paste");
  store.closeTab(store.activeId!);
  await flushPromises();
  await store.open("a.txt");
  await flushPromises();
  const oldDispatch = vi.spyOn(original, "dispatch");
  clipboard.resolve("clipboard text");
  await flushPromises();
  expect(oldDispatch).not.toHaveBeenCalled();
  expect(store.tabs[0]!.text).toBe("reopened");
  expect(store.tabs[0]!.dirty).toBe(false);
});

it("edits and saves a non-Git file through the same editor component", async () => {
  mocks.workspace.isRepo = false;
  mocks.workspace.folderPath = "C:/plain";
  mocks.workspace.repoPath = "C:/plain";
  mocks.fsReadFile.mockResolvedValue("plain text\n");
  const store = useFileViewerStore();
  await store.open("note.txt", { folderPath: "C:/plain" });
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await flushPromises();
  const view = editor(wrapper);
  view.dispatch({ changes: { from: 0, insert: "edited " } });
  await store.saveActive();
  expect(mocks.fsWriteFile).toHaveBeenCalledExactlyOnceWith({
    folderPath: "C:/plain",
    filePath: "note.txt",
    content: "edited plain text\n",
  });
  expect(mocks.diffFile).not.toHaveBeenCalled();
  expect(store.tabs[0]!.dirty).toBe(false);
});
