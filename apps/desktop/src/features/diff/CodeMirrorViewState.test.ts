import { afterEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirrorDiff from "./CodeMirrorDiff.vue";
import type { DiffPaneSnapshot } from "./diffViewState";

enableAutoUnmount(afterEach);
afterEach(() => vi.restoreAllMocks());

it("saves a small snapshot, destroys the editor and restores selection on a fresh instance", async () => {
  const props = {
    text: "first\nsecond\nthird",
    hunks: [],
    side: "right" as const,
    paintKey: "tab-v1",
  };
  const wrapper = mount(CodeMirrorDiff, { props, attachTo: document.body });
  await flushPromises();
  const editor = EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;
  editor.dispatch({ selection: EditorSelection.single(2, 9) });
  const scroll = EditorView.scrollIntoView(6, { y: "start" });
  vi.spyOn(editor, "scrollSnapshot").mockReturnValue(
    scroll as ReturnType<EditorView["scrollSnapshot"]>,
  );
  const destroy = vi.spyOn(editor, "destroy");
  const host = wrapper.element;
  wrapper.unmount();
  const snapshot = wrapper.emitted("saveViewState")![0]![0] as DiffPaneSnapshot;
  expect(snapshot.key).toBe("tab-v1");
  expect(snapshot.side).toBe("right");
  expect(snapshot.state.scroll).toBe(scroll);
  expect(snapshot.state.selection.main.anchor).toBe(2);
  expect(snapshot.state.selection.main.head).toBe(9);
  expect(Object.keys(snapshot.state).sort()).toEqual([
    "docLength",
    "scroll",
    "selection",
    "selectionVisible",
  ]);
  expect(destroy).toHaveBeenCalledOnce();
  expect(host.querySelector(".cm-editor")).toBeNull();

  const next = mount(CodeMirrorDiff, {
    props: { ...props, initialViewState: snapshot.state },
    attachTo: document.body,
  });
  await flushPromises();
  const restored = EditorView.findFromDOM(next.get(".cm-editor").element as HTMLElement)!;
  expect(restored === editor).toBe(false);
  expect(restored.state.selection.main.anchor).toBe(2);
  expect(restored.state.selection.main.head).toBe(9);
});

it("does not mount an editor after being closed before its queued mount", async () => {
  const wrapper = mount(CodeMirrorDiff, {
    props: { text: "unused", hunks: [], side: "left", paintKey: "closed" },
  });
  const host = wrapper.element;
  wrapper.unmount();
  await flushPromises();
  expect(host.querySelector(".cm-editor")).toBeNull();
  expect(wrapper.emitted("saveViewState")).toBeUndefined();
});

it("remembers the last selected pane when navigation selects a file name", async () => {
  const left = mount(CodeMirrorDiff, {
    props: { text: "left text", hunks: [], side: "left", paintKey: "same-tab" },
    attachTo: document.body,
  });
  const right = mount(CodeMirrorDiff, {
    props: { text: "right text", hunks: [], side: "right", paintKey: "same-tab" },
    attachTo: document.body,
  });
  await flushPromises();
  const selection = document.getSelection()!;
  const select = (node: Node) => {
    selection.setBaseAndExtent(node, 0, node, 4);
    document.dispatchEvent(new Event("selectionchange"));
  };
  select(right.get(".cm-line").element.firstChild!);
  select(left.get(".cm-line").element.firstChild!);
  const fileName = document.createTextNode("file.txt");
  document.body.append(fileName);
  try {
    select(fileName);
    left.unmount();
    right.unmount();
    const savedLeft = left.emitted("saveViewState")![0]![0] as DiffPaneSnapshot;
    const savedRight = right.emitted("saveViewState")![0]![0] as DiffPaneSnapshot;
    expect(savedLeft.state.selectionVisible).toBe(true);
    expect(savedRight.state.selectionVisible).toBe(false);
    expect(savedLeft.state.selection.main.head).toBe(4);
  } finally {
    fileName.remove();
    selection.removeAllRanges();
  }
});
