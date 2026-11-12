import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive } from "vue";
import { EditorView } from "@codemirror/view";
import FileViewer from "./FileViewer.vue";
import { useFileViewerStore } from "@/stores/fileViewerStore";

const mocks = vi.hoisted(() => ({ diffFile: vi.fn(), workspace: {} as any, layout: {} as any }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.workspace = reactive({ repoPath: "repo-A", repoId: "repo-A" });
  mocks.layout = reactive({ activeEditorKind: "welcome" });
});

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
