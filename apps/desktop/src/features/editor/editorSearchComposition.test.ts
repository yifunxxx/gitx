import { afterEach, beforeEach, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { SearchQuery, searchPanelOpen, setSearchQuery } from "@codemirror/search";
import { editorSearch, runEditorSearch } from "./editorSearch";
import { registerEditorSearchActions } from "@/actions/definitions/editorSearchActions";

let view: EditorView;
beforeEach(() => {
  registerEditorSearchActions();
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: "hit hit", extensions: [editorSearch()] }),
  });
  runEditorSearch("Editor.Replace", view);
  view.dispatch({
    effects: setSearchQuery.of(new SearchQuery({ search: "hit", replace: "替换" })),
    selection: { anchor: 0, head: 3 },
  });
});
afterEach(() => view.destroy());

const actions = [
  { name: "find", field: "search", key: "Enter" },
  { name: "replace", field: "replace", key: "Enter" },
  { name: "close", field: "search", key: "Escape" },
] as const;

function dispatch(action: (typeof actions)[number], init: KeyboardEventInit, consumed = false) {
  const input = view.dom.querySelector<HTMLInputElement>(`input[name="${action.field}"]`)!;
  input.focus();
  const event = new KeyboardEvent("keydown", {
    key: action.key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  if (consumed) event.preventDefault();
  input.dispatchEvent(event);
  return event;
}

for (const action of actions) {
  it.each([
    { name: "active composition", init: { isComposing: true } },
    { name: "IME keyCode 229", init: { keyCode: 229 } },
    { name: "already consumed input", init: {}, consumed: true },
  ])(`does not ${action.name} on $name in the search panel`, ({ init, consumed }) => {
    const selection = view.state.selection;
    const event = dispatch(action, init, consumed);
    expect(view.state.doc.toString()).toBe("hit hit");
    expect(view.state.selection.eq(selection)).toBe(true);
    expect(searchPanelOpen(view.state)).toBe(true);
    expect(event.defaultPrevented).toBe(!!consumed);
  });

  it(`still handles a normal ${action.name} key in the search panel`, () => {
    const event = dispatch(action, {});
    expect(event.defaultPrevented).toBe(true);
    if (action.name === "find") {
      expect(view.state.selection.main.from).toBe(4);
      expect(view.state.doc.toString()).toBe("hit hit");
    } else if (action.name === "replace") {
      expect(view.state.doc.toString()).toBe("替换 hit");
    } else {
      expect(searchPanelOpen(view.state)).toBe(false);
    }
  });
}
