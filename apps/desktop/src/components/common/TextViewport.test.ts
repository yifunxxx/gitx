import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import TextViewport from "./TextViewport.vue";

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
const editor = (wrapper: ReturnType<typeof mount>) =>
  EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;

it("bounds a 50,000-line document without serializing it during selection/scroll", async () => {
  const text = Array.from({ length: 50_000 }, (_, i) => `row ${i}`).join("\n");
  const wrapper = mount(TextViewport, { props: { text, label: "Revision" } });
  const view = editor(wrapper);
  expect(view.state.doc.lines).toBe(50_000);
  expect(wrapper.findAll(".cm-line").length).toBeLessThan(100);
  expect(view.state.facet(EditorState.readOnly)).toBe(true);
  view.dispatch({ selection: EditorSelection.range(100, 110) });
  view.scrollDOM.dispatchEvent(new Event("scroll"));
  expect(wrapper.emitted("update:text")).toBeUndefined();
  const destroy = vi.spyOn(view, "destroy");
  wrapper.unmount();
  expect(destroy).toHaveBeenCalledOnce();
});

it("emits exact source on edits, preserves selection on v-model echoes and supports undo", async () => {
  const text = "one\r\n\r\nlast";
  const wrapper = mount(TextViewport, { props: { text, label: "Result", editable: true } });
  const view = editor(wrapper);
  view.dispatch({ changes: { from: 0, to: 3, insert: "edited" }, selection: { anchor: 6 } });
  expect(wrapper.emitted("update:text")?.at(-1)).toEqual(["edited\r\n\r\nlast"]);
  await wrapper.setProps({ text: "edited\r\n\r\nlast" });
  expect(editor(wrapper)).toBe(view);
  expect(view.state.selection.main.head).toBe(6);
  undo(view);
  expect(wrapper.emitted("update:text")?.at(-1)).toEqual([text]);
});

it("applies external conflict resolution without echoing and disables editing during save", async () => {
  const wrapper = mount(TextViewport, {
    props: { text: "ours\r\ntheirs", label: "Result", editable: true },
  });
  const view = editor(wrapper);
  await wrapper.setProps({ text: "resolved\n\n", disabled: true });
  expect(view.state.doc.toString()).toBe("resolved\n\n");
  expect(wrapper.emitted("update:text")).toBeUndefined();
  expect(view.state.facet(EditorState.readOnly)).toBe(true);
  expect(view.contentDOM.getAttribute("aria-disabled")).toBe("true");
  await wrapper.setProps({ disabled: false });
  expect(view.state.facet(EditorState.readOnly)).toBe(false);
  undo(view);
  expect(wrapper.emitted("update:text")?.at(-1)).toEqual(["ours\r\ntheirs"]);
});
