import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, reactive } from "vue";
import { enableAutoUnmount, flushPromises, shallowMount } from "@vue/test-utils";
import type { DiffFileResult } from "@/lib/backend";
import { useDiffStore } from "@/stores/diffStore";
import EditorTabs from "./EditorTabs.vue";
import DiffViewer from "@/features/diff/DiffViewer.vue";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { diffViewKey } from "@/features/diff/diffViewState";

const mocks = vi.hoisted(() => ({
  backend: { diffFile: vi.fn(), diffFileAt: vi.fn() },
  layout: {} as any,
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("vue-i18n", async (original) => ({
  ...(await original<typeof import("vue-i18n")>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: () => ({ repoId: "repo", repoPath: "repo", folderPath: "repo" }),
}));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({}) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({ tabs: [] }) }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => ({ tabs: [] }) }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => ({ tabs: [] }) }));
vi.mock("@/stores/conflictsStore", () => ({ useConflictsStore: () => ({}) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({ tabs: [] }) }));

// A selectable editor surface makes unintended remounts observable without
// relying on CodeMirror's browser layout machinery in happy-dom.
const EditorSurface = defineComponent({
  props: ["text", "side", "initialViewState"],
  template: '<textarea :data-side="side" :value="text" />',
});
const result = (path: string, after = "new value"): DiffFileResult => ({
  path,
  leftLabel: "Staged",
  rightLabel: "Local",
  leftText: null,
  rightText: null,
  binary: false,
  tooLarge: false,
  encoding: "utf-8",
  eolMismatch: false,
  hunks: [
    {
      index: 0,
      header: "@@ -1 +1 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: ["-old value", `+${after}`],
    },
  ],
});
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.layout = reactive({ activeEditorKind: "diff" });
  setActivePinia(createPinia());
  mocks.backend.diffFile.mockImplementation(async ({ filePath }) => result(filePath));
});

async function setup() {
  const store = useDiffStore();
  await store.openFileDiff("A.txt");
  const id = store.activeId!;
  const wrapper = shallowMount(EditorTabs, {
    attachTo: document.body,
    global: {
      stubs: {
        DiffViewer: false,
        CodeMirrorDiff: EditorSurface,
        Tip: { template: "<div><slot /></div>" },
        Button: { template: "<button><slot /></button>" },
      },
    },
  });
  await flushPromises();
  const editor = wrapper.get<HTMLTextAreaElement>('[data-side="right"]').element;
  editor.focus();
  editor.setSelectionRange(1, 6);
  editor.scrollTop = 73;
  return { store, wrapper, editor, id };
}

it("preserves selection and scroll when a background tab finishes or refreshes", async () => {
  const { store, wrapper, editor, id } = await setup();
  const viewer = wrapper.getComponent(DiffViewer).element;
  let finish!: (value: DiffFileResult) => void;
  mocks.backend.diffFile.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const opening = store.openFileDiff("B.txt");
  store.activeId = id;
  await flushPromises();
  finish(result("B.txt"));
  await opening;
  await store.reloadTab("index:worktree:B.txt", { soft: true });
  await flushPromises();
  expect(wrapper.getComponent(DiffViewer).element === viewer).toBe(true);
  expect(wrapper.get('[data-side="right"]').element).toBe(editor);
  expect([editor.selectionStart, editor.selectionEnd, editor.scrollTop]).toEqual([1, 6, 73]);
  expect(document.activeElement).toBe(editor);
});

it.each([false, true])(
  "preserves editor state after an unchanged refresh (soft=%s)",
  async (soft) => {
    const { store, wrapper, editor, id } = await setup();
    await store.reloadTab(id, { soft });
    await flushPromises();
    expect(wrapper.get('[data-side="right"]').element).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd, editor.scrollTop]).toEqual([1, 6, 73]);
  },
);

it("paints an equal-length content change immediately without replacing the whole viewer", async () => {
  const { store, wrapper, editor, id } = await setup();
  const viewer = wrapper.getComponent(DiffViewer).element;
  mocks.backend.diffFile.mockResolvedValue(result("A.txt", "NEW VALUE"));
  await store.reloadTab(id, { soft: true });
  await flushPromises();
  expect(wrapper.getComponent(DiffViewer).element === viewer).toBe(true);
  expect(wrapper.get('[data-side="right"]').element).not.toBe(editor);
  expect(wrapper.get<HTMLTextAreaElement>('[data-side="right"]').element.value).toContain(
    "NEW VALUE",
  );
});

it("keeps existing content through a refresh failure and identical successful retry", async () => {
  const { store, wrapper, editor, id } = await setup();
  mocks.backend.diffFile.mockRejectedValueOnce(new Error("temporarily locked"));
  await store.reloadTab(id, { soft: true });
  await flushPromises();
  expect(wrapper.text()).toContain("temporarily locked");
  expect(wrapper.get('[data-side="right"]').element).toBe(editor);
  await store.reloadTab(id);
  await flushPromises();
  expect(wrapper.text()).not.toContain("temporarily locked");
  expect(wrapper.get('[data-side="right"]').element).toBe(editor);
});

it("switches cached comparisons to the correct content", async () => {
  const { store, wrapper, id } = await setup();
  mocks.backend.diffFile.mockResolvedValue(result("B.txt", "another file"));
  await store.openFileDiff("B.txt");
  await flushPromises();
  expect(wrapper.get<HTMLTextAreaElement>('[data-side="right"]').element.value).toContain(
    "another file",
  );
  store.activeId = id;
  await flushPromises();
  expect(wrapper.get<HTMLTextAreaElement>('[data-side="right"]').element.value).toContain(
    "new value",
  );
});

it("passes the outgoing pane snapshot back to the same tab on reactivation", async () => {
  const { store, wrapper, id } = await setup();
  const right = wrapper
    .findAllComponents(EditorSurface)
    .find((pane) => pane.props("side") === "right")!;
  const state = {
    scroll: EditorView.scrollIntoView(4),
    selection: EditorSelection.single(1, 6),
    selectionVisible: true,
    docLength: 9,
  };
  right.vm.$emit("saveViewState", { key: diffViewKey(store.tabs[0]!), side: "right", state });
  await store.openFileDiff("B.txt");
  await flushPromises();
  expect(
    wrapper
      .findAllComponents(EditorSurface)
      .find((pane) => pane.props("side") === "right")!
      .props("initialViewState"),
  ).toBeUndefined();
  await store.openFileDiff("A.txt");
  await flushPromises();
  const restored = wrapper
    .findAllComponents(EditorSurface)
    .find((pane) => pane.props("side") === "right")!
    .props("initialViewState");
  expect(restored.selection.main.anchor).toBe(1);
  expect(restored.selection.main.head).toBe(6);
  expect(store.getPaneViewState(id, "right")).toBe(state);
});
