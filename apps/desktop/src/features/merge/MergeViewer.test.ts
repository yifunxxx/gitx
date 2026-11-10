import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import MergeViewer from "./MergeViewer.vue";
import VirtualList from "@/components/common/VirtualList.vue";

const mocks = vi.hoisted(() => ({ store: {} as any }));
vi.mock("@/stores/conflictsStore", () => ({ useConflictsStore: () => mocks.store }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const blocks = Array.from({ length: 5000 }, (_, i) => ({
    kind: "conflict",
    oursLines: [`ours ${i}\n`],
    theirsLines: [`theirs ${i}\n`],
    baseLines: [],
    resultLines: [],
    isSimple: false,
  }));
  mocks.store = reactive({
    activeMergeId: "first",
    acceptBlock: vi.fn(),
    applyMergeResult: vi.fn(),
    mergeTabs: [
      {
        id: "first",
        title: "Merge",
        merge3: { blocks, conflictCount: 5000 },
        resultText: "draft\r\n\r\nlast",
        yoursLabel: "Ours",
        theirsLabel: "Theirs",
        saving: false,
        error: null,
      },
    ],
  });
});
afterEach(() => vi.unstubAllGlobals());

it("bounds all three text panes and block rows, and accepts the correct offscreen block", async () => {
  const wrapper = mount(MergeViewer, { attachTo: document.body });
  expect(wrapper.findAll(".cm-editor")).toHaveLength(3);
  expect(wrapper.findAll(".cm-line").length).toBeLessThan(250);
  const list = wrapper.findComponent(VirtualList);
  expect(list.findAll("button").length).toBeLessThan(100);
  await list.findAll("button")[0]!.trigger("keydown", { key: "End" });
  await flushPromises();
  expect((document.activeElement as HTMLElement).dataset.mergeBlock).toBe("4999");
  expect((document.activeElement as HTMLElement).dataset.mergeSide).toBe("ours");
  await list
    .get('[data-merge-block="4999"][data-merge-side="ours"]')
    .trigger("keydown", { key: "Tab" });
  expect((document.activeElement as HTMLElement).dataset.mergeSide).toBe("theirs");
  const buttons = list.findAll("button");
  await buttons.at(-1)!.trigger("click");
  expect(mocks.store.acceptBlock).toHaveBeenLastCalledWith("first", 4999, "theirs");
});

it("updates the merge draft before Apply and replaces all editor instances when switching files", async () => {
  const wrapper = mount(MergeViewer);
  const original = wrapper
    .findAll(".cm-editor")
    .map((node) => EditorView.findFromDOM(node.element as HTMLElement)!);
  expect(original[0]!.state.facet(EditorState.readOnly)).toBe(true);
  original[1]!.dispatch({ changes: { from: 0, to: 5, insert: "manual" } });
  expect(mocks.store.mergeTabs[0].resultText).toBe("manual\r\n\r\nlast");
  const destroy = original.map((view) => vi.spyOn(view, "destroy"));
  mocks.store.mergeTabs.push({
    ...mocks.store.mergeTabs[0],
    id: "second",
    resultText: "second file",
  });
  mocks.store.activeMergeId = "second";
  await flushPromises();
  expect(
    EditorView.findFromDOM(
      wrapper.findAll(".cm-editor")[1]!.element as HTMLElement,
    )!.state.doc.toString(),
  ).toBe("second file");
  destroy.forEach((call) => expect(call).toHaveBeenCalledOnce());
});
