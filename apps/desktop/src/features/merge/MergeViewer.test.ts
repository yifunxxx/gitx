import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { markRaw, reactive } from "vue";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import type { Merge3Result } from "@/lib/backend";
import { sourceText } from "@/components/common/preservedText";
import { createMergeState, pendingMergeCount } from "./mergeDocument";
import MergeViewer from "./MergeViewer.vue";

const mocks = vi.hoisted(() => ({ store: {} as any }));
vi.mock("@/stores/conflictsStore", () => ({ useConflictsStore: () => mocks.store }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
enableAutoUnmount(afterEach);
function makeTab(id: string, count = 2) {
  const merge3: Merge3Result = {
    blocks: Array.from({ length: count }, (_, i) => ({
      kind: "conflict",
      oursLines: ["left " + i + "\r\n"],
      theirsLines: ["right " + i + "\n"],
      baseLines: ["base " + i + "\r\n"],
      resultLines: [],
      isSimple: false,
    })),
    conflictCount: count,
  };
  const mergeState = markRaw(createMergeState(merge3));
  return {
    id,
    title: "Merge " + id,
    path: id,
    merge3,
    mergeState,
    resultText: sourceText(mergeState),
    yoursLabel: "Ours",
    theirsLabel: "Theirs",
    saving: false,
    error: null,
  };
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.store = reactive({
    activeMergeId: "first",
    applyMergeResult: vi.fn(),
    mergeTabs: [makeTab("first")],
    updateMergeState(id: string, state: EditorState) {
      const tab = this.mergeTabs.find((item: any) => item.id === id)!;
      tab.mergeState = markRaw(state);
      tab.resultText = sourceText(state);
      tab.error = null;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
const views = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll(".cm-editor").map((node) => EditorView.findFromDOM(node.element as HTMLElement)!);
const button = (wrapper: ReturnType<typeof mount>, text: string) =>
  wrapper.findAll("button").find((b) => b.text() === text)!;

it("shows native inline arrows and ignore buttons, and updates only the chosen conflict", async () => {
  const wrapper = mount(MergeViewer, { attachTo: document.body });
  await flushPromises();
  // Wait for CodeMirror's measured gutter DOM to expose its interactive controls.
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(wrapper.get(".merge-action").element.closest('[aria-hidden="true"]')).toBeNull();
  expect(views(wrapper)).toHaveLength(3);
  expect(views(wrapper)[0]!.state.facet(EditorState.readOnly)).toBe(true);
  await wrapper
    .get('[data-merge-block="0"][data-merge-side="ours"][data-merge-choice="accept"]')
    .trigger("click");
  await flushPromises();
  expect(mocks.store.mergeTabs[0].resultText).toBe("left 0\r\nbase 1\r\n");
  await wrapper
    .get('[data-merge-block="0"][data-merge-side="theirs"][data-merge-choice="ignore"]')
    .trigger("click");
  await flushPromises();
  expect(pendingMergeCount(mocks.store.mergeTabs[0].mergeState)).toBe(1);
  expect(button(wrapper, "merge.saveResolved").attributes("disabled")).toBeDefined();
  undo(views(wrapper)[1]!);
  await flushPromises();
  expect(
    wrapper
      .get('[data-merge-block="0"][data-merge-side="theirs"][data-merge-choice="ignore"]')
      .attributes("disabled"),
  ).toBeUndefined();
  views(wrapper)[1]!.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Z",
      code: "KeyZ",
      keyCode: 90,
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  await flushPromises();
  expect(pendingMergeCount(mocks.store.mergeTabs[0].mergeState)).toBe(1);
  expect(
    wrapper
      .get('[data-merge-block="0"][data-merge-side="theirs"][data-merge-choice="ignore"]')
      .attributes("disabled"),
  ).toBeDefined();
});

it("keeps 5,000 conflicts virtualized and accepts all as one undo step", async () => {
  mocks.store.mergeTabs = [makeTab("first", 5000)];
  const wrapper = mount(MergeViewer);
  await flushPromises();
  expect(wrapper.findAll(".cm-line").length).toBeLessThan(250);
  expect(wrapper.findAll(".merge-action").length).toBeLessThan(250);
  await button(wrapper, "merge.acceptRight").trigger("click");
  expect(pendingMergeCount(mocks.store.mergeTabs[0].mergeState)).toBe(0);
  expect(mocks.store.mergeTabs[0].resultText).toContain("right 4999\n");
  undo(views(wrapper)[1]!);
  expect(pendingMergeCount(mocks.store.mergeTabs[0].mergeState)).toBe(5000);
});

it("protects manual edits with an explicit keep action and allows undo", async () => {
  const wrapper = mount(MergeViewer);
  const view = views(wrapper)[1]!;
  view.dispatch({ changes: { from: 0, to: 6, insert: "manual" } });
  await flushPromises();
  expect(
    wrapper
      .get('[data-merge-block="0"][data-merge-side="ours"][data-merge-choice="accept"]')
      .attributes("disabled"),
  ).toBeDefined();
  await button(wrapper, "merge.keepManual").trigger("click");
  expect(mocks.store.mergeTabs[0].resultText.startsWith("manual")).toBe(true);
  expect(pendingMergeCount(mocks.store.mergeTabs[0].mergeState)).toBe(1);
  undo(view);
  expect(pendingMergeCount(mocks.store.mergeTabs[0].mergeState)).toBe(2);
});

it("keeps decisions and undo history across tab switches, and disposes editor views", async () => {
  const wrapper = mount(MergeViewer);
  await button(wrapper, "merge.acceptLeft").trigger("click");
  const original = views(wrapper),
    destroy = original.map((view) => vi.spyOn(view, "destroy"));
  mocks.store.mergeTabs.push(makeTab("second"));
  mocks.store.activeMergeId = "second";
  await flushPromises();
  destroy.forEach((call) => expect(call).toHaveBeenCalledOnce());
  mocks.store.activeMergeId = "first";
  await flushPromises();
  expect(sourceText(views(wrapper)[1]!.state)).toBe("left 0\r\nleft 1\r\n");
  undo(views(wrapper)[1]!);
  expect(mocks.store.mergeTabs[0].resultText).toBe("base 0\r\nbase 1\r\n");
});

it("navigates with F7 and disables changes while a save is pending", async () => {
  const wrapper = mount(MergeViewer);
  await wrapper.trigger("keydown", { key: "F7", ctrlKey: true });
  expect(wrapper.text()).toContain("1/2");
  await wrapper.trigger("keydown", { key: "F7" });
  expect(wrapper.text()).toContain("2/2");
  await wrapper.trigger("keydown", { key: "F7", shiftKey: true });
  expect(wrapper.text()).toContain("1/2");
  mocks.store.mergeTabs[0].saving = true;
  await flushPromises();
  expect(views(wrapper)[1]!.state.facet(EditorState.readOnly)).toBe(true);
  expect(
    wrapper.findAll(".merge-action").every((b) => b.attributes("disabled") !== undefined),
  ).toBe(true);
});
