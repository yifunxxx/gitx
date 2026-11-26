import { afterEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { deleteCharBackward } from "@codemirror/commands";
import CodeMirrorDiff from "./CodeMirrorDiff.vue";
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

enableAutoUnmount(afterEach);

it.each(["left", "right", "unified"] as const)(
  "keeps the %s diff read-only through commands, input transactions and refreshes",
  async (side) => {
    const hunks = [
      {
        index: 0,
        header: "@@ -1 +1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ["-before", "+after"],
      },
    ];
    const wrapper = mount(CodeMirrorDiff, {
      props: { text: "before\nafter", hunks, side, paintKey: "read-only" },
      attachTo: document.body,
    });
    await flushPromises();
    const getEditor = () =>
      EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;
    let editor = getEditor();
    const original = editor.state.doc.toString();
    expect(editor.state.facet(EditorState.readOnly)).toBe(true);
    expect(editor.contentDOM.getAttribute("contenteditable")).toBe("false");
    expect(editor.contentDOM.getAttribute("aria-readonly")).toBe("true");

    // Reading, selecting and copying remain possible even though edits are rejected.
    editor.dispatch({ selection: { anchor: 0, head: original.length }, scrollIntoView: true });
    expect(
      editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to),
    ).toBe(original);
    expect(deleteCharBackward(editor)).toBe(false);
    for (const userEvent of ["input.type", "input.paste", "delete.cut", "input.drop"]) {
      editor.dispatch({ ...editor.state.replaceSelection("changed"), userEvent });
      expect(editor.state.doc.toString()).toBe(original);
    }
    editor.dispatch({ changes: { from: 0, to: original.length, insert: "command edit" } });
    expect(editor.state.doc.toString()).toBe(original);

    // Repository refreshes replace the preview and keep the new editor protected.
    await wrapper.setProps({
      text: "refreshed",
      hunks: [{ ...hunks[0]!, lines: ["-before", "+refreshed"] }],
    });
    await flushPromises();
    editor = getEditor();
    expect(editor.state.doc.toString()).toContain("refreshed");
    expect(editor.state.facet(EditorState.readOnly)).toBe(true);
    editor.dispatch({ changes: { from: 0, insert: "changed" } });
    expect(editor.state.doc.toString()).not.toContain("changed");
  },
);
