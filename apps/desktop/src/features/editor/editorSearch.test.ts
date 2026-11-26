import { afterEach, beforeEach, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { SearchQuery, setSearchQuery, getSearchQuery, searchPanelOpen } from "@codemirror/search";
import { editorSearch, runEditorSearch } from "./editorSearch";
import { registerEditorSearchActions } from "@/actions/definitions/editorSearchActions";
import { setKeymapOverridesProvider } from "@/actions/keymap";
let view: EditorView;
let release: (() => void) | undefined;
beforeEach(() => {
  registerEditorSearchActions();
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: "Hit hit hits\n😀hit",
      extensions: [history(), editorSearch()],
    }),
  });
});
afterEach(() => {
  release?.();
  release = undefined;
  view.destroy();
});
function key(key: string, options = {}) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
  );
}
it("opens find, seeds a selection, navigates matches and closes with Escape", () => {
  view.dispatch({ selection: { anchor: 4, head: 7 } });
  key("f", { ctrlKey: true });
  expect(searchPanelOpen(view.state)).toBe(true);
  expect(getSearchQuery(view.state).search).toBe("hit");
  key("F3");
  expect(view.state.selection.main.from).toBe(8);
  key("F3", { shiftKey: true });
  expect(view.state.selection.main.from).toBe(4);
  key("Escape");
  expect(searchPanelOpen(view.state)).toBe(false);
});
it("supports whole-word/case/regex replacement with undo and no implicit save", () => {
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({ search: "hit", caseSensitive: true, wholeWord: true, replace: "new" }),
    ),
  });
  runEditorSearch("Editor.ReplaceAll", view);
  expect(view.state.doc.toString()).toBe("Hit new hits\n😀new");
  undo(view);
  expect(view.state.doc.toString()).toBe("Hit hit hits\n😀hit");
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({ search: "(h)(it)", regexp: true, caseSensitive: true, replace: "$2$1" }),
    ),
  });
  runEditorSearch("Editor.ReplaceAll", view);
  expect(view.state.doc.toString()).toContain("ith");
});
it("honors changed and disabled shortcuts in both editor and panel without hardcoded fallback", () => {
  release = setKeymapOverridesProvider(() => ({ "Editor.Find": ["mod+j"], "Editor.FindNext": [] }));
  key("f", { ctrlKey: true });
  expect(searchPanelOpen(view.state)).toBe(false);
  key("j", { ctrlKey: true });
  expect(searchPanelOpen(view.state)).toBe(true);
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "hit" })) });
  const selection = view.state.selection;
  key("F3");
  expect(view.state.selection.eq(selection)).toBe(true);
});
it("read-only diff/source panes find text but cannot replace even via commands", () => {
  view.destroy();
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: "hit",
      extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false), editorSearch()],
    }),
  });
  runEditorSearch("Editor.Find", view);
  expect(view.dom.querySelector('input[name="search"]')).toBeTruthy();
  expect(view.dom.querySelector('input[name="replace"]')).toBeNull();
  view.dispatch({
    effects: setSearchQuery.of(new SearchQuery({ search: "hit", replace: "changed" })),
  });
  expect(runEditorSearch("Editor.Replace", view)).toBe(false);
  runEditorSearch("Editor.ReplaceAll", view);
  expect(view.state.doc.toString()).toBe("hit");
});
