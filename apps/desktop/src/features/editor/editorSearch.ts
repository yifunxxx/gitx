import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";
import {
  search,
  openSearchPanel,
  closeSearchPanel,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from "@codemirror/search";
import { findActionIdByEvent } from "@/actions/keymap";

let active: EditorView | null = null;
const commands = {
  "Editor.Find": openSearchPanel,
  "Editor.Replace": (view: EditorView) => {
    if (view.state.readOnly) return false;
    openSearchPanel(view);
    view.dom.querySelector<HTMLInputElement>('input[name="replace"]')?.focus();
    return true;
  },
  "Editor.FindNext": findNext,
  "Editor.FindPrevious": findPrevious,
  "Editor.ReplaceNext": replaceNext,
  "Editor.ReplaceAll": replaceAll,
};
export type EditorSearchAction = keyof typeof commands;
export function runEditorSearch(id: EditorSearchAction, view = active) {
  if (!view || !view.dom.isConnected) return false;
  return commands[id](view);
}
export function canSearchEditor(replace = false) {
  return !!active?.dom.isConnected && (!replace || !active.state.readOnly);
}
// CodeMirror style modules outlive individual editors. Reuse one search theme.
const searchTheme = EditorView.theme({
  ".cm-panels": {
    backgroundColor: "var(--color-popover)",
    color: "var(--color-foreground)",
    fontSize: "12px",
  },
  ".cm-search": {
    padding: "8px",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px",
  },
  ".cm-search input, .cm-search button": {
    border: "1px solid var(--color-border)",
    borderRadius: "5px",
    background: "var(--color-background)",
    color: "var(--color-foreground)",
    padding: "3px 7px",
  },
  ".cm-search label": { display: "inline-flex", alignItems: "center", gap: "3px" },
  ".cm-searchMatch": { backgroundColor: "#eab30830", outline: "1px solid #eab30860" },
  ".cm-searchMatch-selected": { backgroundColor: "#eab30860" },
});
export function editorSearch(translate?: (key: string) => string): Extension {
  return [
    EditorView.contentAttributes.of({ tabindex: "0" }),
    search({ top: true, literal: true }),
    keymap.of([{ key: "Escape", run: closeSearchPanel, scope: "editor search-panel" }]),
    ViewPlugin.define((view) => {
      const focus = () => {
        active = view;
      };
      const key = (event: KeyboardEvent) => {
        const id = findActionIdByEvent(event);
        if (id && id in commands) {
          // Resolve on every keystroke, so saved keymap overrides take effect
          // immediately in both editor content and the search panel inputs.
          if (runEditorSearch(id as EditorSearchAction, view)) {
            event.preventDefault();
            event.stopPropagation();
          }
        }
      };
      view.dom.addEventListener("focusin", focus);
      view.dom.addEventListener("keydown", key, true);
      return {
        destroy() {
          view.dom.removeEventListener("focusin", focus);
          view.dom.removeEventListener("keydown", key, true);
          if (active === view) active = null;
        },
      };
    }),
    EditorState.phrases.of(
      translate
        ? {
            Find: translate("editor.find"),
            Replace: translate("editor.replace"),
            next: translate("editor.findNext"),
            previous: translate("editor.findPrevious"),
            all: translate("editor.selectAll"),
            "match case": translate("contentSearch.caseSensitive"),
            "by word": translate("contentSearch.wholeWord"),
            regexp: translate("contentSearch.regex"),
            replace: translate("editor.replaceNext"),
            "replace all": translate("editor.replaceAll"),
            close: translate("common.close"),
          }
        : {},
    ),
    searchTheme,
  ];
}
