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
function replaceRow() {
  return view.dom.querySelector<HTMLElement>(".cm-search-replace");
}
it("opens find, seeds a selection, navigates matches and closes with Escape", () => {
  view.dispatch({ selection: { anchor: 4, head: 7 } });
  key("f", { ctrlKey: true });
  expect(searchPanelOpen(view.state)).toBe(true);
  expect(getSearchQuery(view.state).search).toBe("hit");
  expect(replaceRow()?.hidden).toBe(true);
  expect(view.dom.querySelector(".cm-search-expand")?.getAttribute("aria-expanded")).toBe("false");
  key("F3");
  expect(view.state.selection.main.from).toBe(8);
  key("F3", { shiftKey: true });
  expect(view.state.selection.main.from).toBe(4);
  key("Escape");
  expect(searchPanelOpen(view.state)).toBe(false);
});
it("keeps find-only by default and expands replace from the chevron or Replace action", () => {
  runEditorSearch("Editor.Find", view);
  expect(replaceRow()?.hidden).toBe(true);
  view.dom.querySelector<HTMLButtonElement>(".cm-search-expand")!.click();
  expect(replaceRow()?.hidden).toBe(false);
  expect(view.dom.querySelector(".cm-search-expand")?.getAttribute("aria-expanded")).toBe("true");
  view.dom.querySelector<HTMLButtonElement>(".cm-search-expand")!.click();
  expect(replaceRow()?.hidden).toBe(true);
  runEditorSearch("Editor.Replace", view);
  expect(searchPanelOpen(view.state)).toBe(true);
  expect(replaceRow()?.hidden).toBe(false);
  expect(document.activeElement).toBe(view.dom.querySelector('input[name="replace"]'));
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
  expect(view.dom.querySelector(".cm-search-expand")).toBeNull();
  view.dispatch({
    effects: setSearchQuery.of(new SearchQuery({ search: "hit", replace: "changed" })),
  });
  expect(runEditorSearch("Editor.Replace", view)).toBe(false);
  runEditorSearch("Editor.ReplaceAll", view);
  expect(view.state.doc.toString()).toBe("hit");
});
it("keeps the find panel below dialog stacking by isolating the editor", () => {
  const style = getComputedStyle(view.dom);
  expect(style.isolation).toBe("isolate");
  runEditorSearch("Editor.Find", view);
  const panels = view.dom.querySelector(".cm-panels") as HTMLElement;
  expect(getComputedStyle(panels).zIndex).toBe("1");
});
it("keeps compact IDEA row alignment and soft focus styling", () => {
  document.documentElement.style.setProperty("--radius-sm", "4px");
  document.documentElement.style.setProperty("--dbx-radius-sm", "4px");
  runEditorSearch("Editor.Replace", view);
  const panel = view.dom.querySelector(".cm-search") as HTMLElement;
  expect(panel.querySelector(".cm-search-actions")).toBeTruthy();
  expect(panel.querySelector(".cm-search-options")).toBeTruthy();
  expect(panel.querySelector(".cm-search-replace .cm-search-expand-spacer")).toBeTruthy();
  expect(panel.querySelector(".cm-search-replace .cm-search-action-spacer")).toBeTruthy();
  const next = panel.querySelector('button[name="next"]') as HTMLButtonElement;
  const select = panel.querySelector('button[name="select"]') as HTMLButtonElement;
  const replaceAll = panel.querySelector('button[name="replaceAll"]') as HTMLButtonElement;
  expect(next.textContent).toBe("Next");
  expect(next.getAttribute("aria-label")).toBe("Find Next");
  expect(select.textContent).toBe("Find All");
  expect(replaceAll.textContent).toBe("Replace All");
  expect(getComputedStyle(next).borderRadius).toBe("4px");
  const findRow = panel.querySelector(".cm-search-row:not(.cm-search-replace)") as HTMLElement;
  const replaceRow = panel.querySelector(".cm-search-replace") as HTMLElement;
  const findInput = findRow.querySelector('input[name="search"]') as HTMLInputElement;
  const replaceInput = replaceRow.querySelector('input[name="replace"]') as HTMLInputElement;
  expect(findInput.getBoundingClientRect().left).toBe(replaceInput.getBoundingClientRect().left);
  const findActions = findRow.querySelector(".cm-search-actions") as HTMLElement;
  const replaceActions = replaceRow.querySelector(".cm-search-actions") as HTMLElement;
  expect(getComputedStyle(findActions).display).toBe("grid");
  expect(getComputedStyle(findActions).gridTemplateColumns.split(" ").length).toBe(3);
  expect(getComputedStyle(replaceActions).width).toBe(getComputedStyle(findActions).width);
  expect(findActions.getBoundingClientRect().left).toBe(replaceActions.getBoundingClientRect().left);
  expect(getComputedStyle(replaceInput).outlineStyle === "none" || getComputedStyle(replaceInput).outlineWidth === "0px").toBe(
    true,
  );
  expect(getComputedStyle(view.dom.querySelector(".cm-panels") as HTMLElement).backgroundColor).not.toBe("");
});
