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
  expect(view.state.facet(EditorState.readOnly)).toBe(false);
  expect(view.contentDOM.getAttribute("contenteditable")).toBe("true");
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

it("keeps the three conflict panes' scroll positions linked", async () => {
  mocks.store.mergeTabs = [makeTab("first", 80)];
  const wrapper = mount(MergeViewer, { attachTo: document.body });
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 40));
  const panes = views(wrapper).map((view) => view.scrollDOM);
  expect(panes).toHaveLength(3);
  panes[1]!.scrollTop = 120;
  panes[1]!.dispatchEvent(new Event("scroll"));
  expect(panes[0]!.scrollTop).toBe(120);
  expect(panes[2]!.scrollTop).toBe(120);
});

// happy-dom has no layout/clamping or deferred native scroll events. Model
// those browser boundaries explicitly, retaining the real three EditorViews.
function limitScroll(pane: HTMLElement, maxTop: number, maxLeft: number) {
  let top = 0;
  let left = 0;
  Object.defineProperties(pane, {
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = Math.max(0, Math.min(maxTop, value)); },
    },
    scrollLeft: {
      configurable: true,
      get: () => left,
      set: (value: number) => { left = Math.max(0, Math.min(maxLeft, value)); },
    },
  });
}

it("does not feed a shorter pane's clamped scroll position back into the source", async () => {
  const wrapper = mount(MergeViewer);
  await flushPromises();
  const [left, result, right] = views(wrapper).map((view) => view.scrollDOM);
  limitScroll(left!, 2000, 1000);
  limitScroll(result!, 300, 100);
  limitScroll(right!, 1200, 600);
  left!.scrollTop = 800;
  left!.scrollLeft = 500;
  left!.dispatchEvent(new Event("scroll"));
  expect(result!.scrollTop).toBe(300);
  expect(result!.scrollLeft).toBe(100);
  // Programmatic writes dispatch scroll after the source handler has returned.
  result!.dispatchEvent(new Event("scroll"));
  right!.dispatchEvent(new Event("scroll"));
  expect(left!.scrollTop).toBe(800);
  expect(left!.scrollLeft).toBe(500);
  expect(right!.scrollTop).toBe(800);
  expect(right!.scrollLeft).toBe(500);
});

it("accepts a new user scroll immediately without moving the other axis", async () => {
  const wrapper = mount(MergeViewer);
  await flushPromises();
  const [left, result, right] = views(wrapper).map((view) => view.scrollDOM);
  limitScroll(left!, 2000, 1000);
  limitScroll(result!, 300, 100);
  limitScroll(right!, 1200, 600);
  left!.scrollTop = 800;
  left!.scrollLeft = 500;
  left!.dispatchEvent(new Event("scroll"));
  // A real horizontal movement can arrive before the queued feedback event.
  result!.scrollLeft = 60;
  result!.dispatchEvent(new Event("scroll"));
  expect(left!.scrollLeft).toBe(60);
  expect(right!.scrollLeft).toBe(60);
  expect(left!.scrollTop).toBe(800);
  expect(right!.scrollTop).toBe(800);
  result!.scrollTop = 180;
  result!.dispatchEvent(new Event("scroll"));
  expect(left!.scrollTop).toBe(180);
  expect(right!.scrollTop).toBe(180);
});

it("unbinds old scroll panes on tab replacement and unmount", async () => {
  const wrapper = mount(MergeViewer);
  await flushPromises();
  const original = views(wrapper).map((view) => view.scrollDOM);
  mocks.store.mergeTabs.push(makeTab("second"));
  mocks.store.activeMergeId = "second";
  await flushPromises();
  original[0]!.scrollTop = 400;
  original[0]!.dispatchEvent(new Event("scroll"));
  expect(original[1]!.scrollTop).toBe(0);
  const current = views(wrapper).map((view) => view.scrollDOM);
  expect(current[0]!.scrollTop).toBe(0);
  current[1]!.scrollTop = 120;
  current[1]!.dispatchEvent(new Event("scroll"));
  expect(current[0]!.scrollTop).toBe(120);
  wrapper.unmount();
  current[1]!.scrollTop = 200;
  current[1]!.dispatchEvent(new Event("scroll"));
  expect(current[0]!.scrollTop).toBe(120);
});
