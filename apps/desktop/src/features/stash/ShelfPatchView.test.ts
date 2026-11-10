import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import ShelfPatchView from "./ShelfPatchView.vue";
import { patchHighlights } from "./patchHighlights";

enableAutoUnmount(afterEach);
beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => vi.unstubAllGlobals());
it("colors content by hunk counts, distinguishing headers, triple prefixes and binary payload", () => {
  const doc = [
    "diff --git a/x b/x",
    "--- a/x",
    "+++ b/x",
    "@@ -1,2 +1,2 @@",
    "---old",
    "+++new",
    " same",
    "GIT binary patch",
    "+base85",
    "-base85",
    "@@ -0,0 +1 @@",
    "+added",
    "\\ No newline at end of file",
    "-- ",
    "mail footer",
  ].join("\n");
  let state = EditorState.create({ doc, extensions: [patchHighlights] });
  const marks: [number, string][] = [];
  state.field(patchHighlights).between(0, state.doc.length, (from, _to, mark) => {
    marks.push([state.doc.lineAt(from).number, mark.spec.class]);
  });
  expect(marks).toEqual([
    [1, "cm-patch-header"],
    [2, "cm-patch-header"],
    [3, "cm-patch-header"],
    [4, "cm-patch-header"],
    [5, "cm-patch-removed"],
    [6, "cm-patch-added"],
    [8, "cm-patch-header"],
    [11, "cm-patch-header"],
    [12, "cm-patch-added"],
  ]);
  const ranges = state.field(patchHighlights);
  for (let i = 0; i < 100; i++) {
    state = state.update({ selection: { anchor: i } }).state;
    expect(state.field(patchHighlights)).toBe(ranges);
  }
});
it("bounds large patch DOM, supports selection, stays read-only and releases its editor", async () => {
  const text =
    "@@ -0,0 +1,50000 @@\n" + Array.from({ length: 50000 }, (_, i) => `+line ${i}`).join("\n");
  const wrapper = mount(ShelfPatchView, { props: { text, label: "Saved patch" } });
  await flushPromises();
  const view = EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;
  expect(view.state.doc.lines).toBe(50001);
  expect(wrapper.findAll(".cm-line").length).toBeLessThan(100);
  expect(view.state.facet(EditorState.readOnly)).toBe(true);
  expect(view.state.facet(EditorView.editable)).toBe(false);
  expect(view.contentDOM.getAttribute("aria-label")).toBe("Saved patch");
  const ranges = view.state.field(patchHighlights);
  view.dispatch({ selection: { anchor: 5, head: 12 } });
  view.scrollDOM.dispatchEvent(new Event("scroll"));
  expect(view.state.field(patchHighlights)).toBe(ranges);
  const destroy = vi.spyOn(view, "destroy");
  wrapper.unmount();
  expect(destroy).toHaveBeenCalledOnce();
});
