import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive } from "vue";
import { EditorView } from "@codemirror/view";
import FileViewer from "./FileViewer.vue";
import { useFileViewerStore } from "@/stores/fileViewerStore";

const mocks = vi.hoisted(() => ({
  diffFile: vi.fn(),
  fileWriteWorktree: vi.fn(),
  workspace: {} as any,
  layout: {} as any,
  changes: { refresh: vi.fn() },
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
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
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const result = (text: string) => ({ rightText: text, hunks: [] });
const editor = (wrapper: ReturnType<typeof mount>) =>
  EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;

it("renders the first asynchronous file result after the loading host is replaced", async () => {
  const response = deferred();
  mocks.diffFile.mockReturnValue(response.promise);
  const store = useFileViewerStore();
  const pending = store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  expect(wrapper.text()).toContain("Loading");
  expect(wrapper.find(".cm-editor").exists()).toBe(false);
  response.resolve(result("base\nworking\n"));
  await pending;
  await flushPromises();
  expect(wrapper.text()).not.toContain("Loading");
  expect(editor(wrapper).state.doc.toString()).toBe("base\nworking\n");
  expect(wrapper.findAll(".cm-editor")).toHaveLength(1);
});

it("displays an asynchronous load failure instead of a blank document", async () => {
  const response = deferred();
  mocks.diffFile.mockReturnValue(response.promise);
  const store = useFileViewerStore();
  const pending = store.open("missing.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  response.reject(new Error("missing file"));
  await pending;
  await flushPromises();
  expect(editor(wrapper).state.doc.toString()).toContain("missing file");
});

it("renders cached empty files and releases each editor when switching through a loading file", async () => {
  mocks.diffFile.mockResolvedValueOnce(result(""));
  const store = useFileViewerStore();
  await store.open("empty.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await nextTick();
  const first = editor(wrapper);
  expect(first.state.doc.length).toBe(0);
  const firstDestroy = vi.spyOn(first, "destroy");

  const response = deferred();
  mocks.diffFile.mockReturnValueOnce(response.promise);
  const pending = store.open("later.txt");
  await wrapper.setProps({ tabId: store.activeId! });
  expect(wrapper.text()).toContain("Loading");
  expect(firstDestroy).toHaveBeenCalledOnce();
  response.resolve(result("later"));
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
  mocks.diffFile.mockReturnValueOnce(old.promise);
  const store = useFileViewerStore();
  const pending = store.open("a.txt");
  mocks.workspace.repoPath = "repo-B";
  expect(store.tabs).toEqual([]);
  expect(store.activeId).toBeNull();
  mocks.workspace.repoPath = "repo-A";
  mocks.diffFile.mockResolvedValueOnce(result("current"));
  await store.open("a.txt");
  old.resolve(result("obsolete"));
  await pending;
  expect(store.tabs).toHaveLength(1);
  expect(store.tabs[0]!.text).toBe("current");
});

it("does not overwrite a reopened file with the closed tab's late response", async () => {
  const old = deferred();
  mocks.diffFile.mockReturnValueOnce(old.promise);
  const store = useFileViewerStore();
  const pending = store.open("a.txt");
  store.closeTab(store.activeId!);
  mocks.diffFile.mockResolvedValueOnce(result("reopened"));
  await store.open("a.txt");
  old.resolve(result("closed"));
  await pending;
  expect(store.tabs).toHaveLength(1);
  expect(store.tabs[0]!.text).toBe("reopened");
});

it("marks the tab dirty after edits and clears dirty when restored to baseline", async () => {
  mocks.diffFile.mockResolvedValueOnce(result("base\n"));
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, { props: { tabId: store.activeId! } });
  await nextTick();
  const cm = editor(wrapper);
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
  mocks.diffFile.mockResolvedValueOnce(result("hello\n"));
  const store = useFileViewerStore();
  await store.open("a.txt");
  const wrapper = mount(FileViewer, {
    props: { tabId: store.activeId! },
    attachTo: document.body,
  });
  await nextTick();
  const cm = editor(wrapper);
  cm.dispatch({ selection: { anchor: 0, head: 5 } });
  await wrapper
    .get("[data-file-viewer-host]")
    .trigger("contextmenu", { clientX: 20, clientY: 30 });
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
  await wrapper
    .get("[data-file-viewer-host]")
    .trigger("contextmenu", { clientX: 24, clientY: 36 });
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
