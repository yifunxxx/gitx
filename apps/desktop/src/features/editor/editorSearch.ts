import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  keymap,
  runScopeHandlers,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";
import {
  search,
  openSearchPanel,
  closeSearchPanel,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  selectMatches,
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  searchPanelOpen,
} from "@codemirror/search";
import { findActionIdByEvent } from "@/actions/keymap";

let active: EditorView | null = null;

/** Whether the replace row is expanded (IDEA-style). */
const setReplaceExpanded = StateEffect.define<boolean>();
const replaceExpanded = StateField.define({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setReplaceExpanded)) value = effect.value;
    }
    return value;
  },
});

function phrase(view: EditorView, key: string) {
  return view.state.phrase(key);
}

function el(
  tag: string,
  attrs: Record<string, string | boolean | ((event: Event) => void) | null | undefined> = {},
  children: (Node | string)[] = [],
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (typeof value === "function") {
      node.addEventListener(key.replace(/^on/i, "").toLowerCase(), value as EventListener);
    } else if (value === true) node.setAttribute(key, "");
    else if (key === "checked" && node instanceof HTMLInputElement) node.checked = true;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function toggle(
  name: string,
  checked: boolean,
  label: string,
  short: string,
  onchange: () => void,
) {
  const input = el("input", {
    type: "checkbox",
    name,
    form: "",
    checked: checked || undefined,
    "aria-label": label,
    onchange,
  }) as HTMLInputElement;
  input.checked = checked;
  const wrap = el("label", { class: "cm-search-toggle", title: label, "aria-label": label }, [
    input,
    el("span", {}, [short]),
  ]);
  return { input, wrap };
}

function button(name: string, onclick: () => void, content: string, title?: string) {
  return el(
    "button",
    {
      type: "button",
      class: "cm-button",
      name,
      onclick,
      title: title || content,
      "aria-label": title || content,
    },
    [content],
  );
}

function icon(name: "next" | "prev" | "expand" | "close" | "search") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute(
    "d",
    {
      next: "M12 5v14m-6-6 6 6 6-6",
      prev: "M12 19V5m-6 6 6-6 6 6",
      expand: "m9 5 7 7-7 7",
      close: "m6 6 12 12M6 18 18 6",
      search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    }[name],
  );
  svg.append(path);
  return svg;
}

function navigationButton(name: "next" | "prev", view: EditorView) {
  const node = button(
    name,
    () => (name === "next" ? findNext : findPrevious)(view),
    "",
    phrase(view, name === "next" ? "Find Next" : "Find Previous"),
  );
  node.classList.add("cm-search-navigation");
  node.append(icon(name));
  return node;
}

class IdeaSearchPanel implements Panel {
  dom: HTMLElement;
  readonly view: EditorView;
  private query: SearchQuery;
  private readonly searchField: HTMLInputElement;
  private readonly replaceField: HTMLInputElement;
  private readonly caseField: HTMLInputElement;
  private readonly reField: HTMLInputElement;
  private readonly wordField: HTMLInputElement;
  private readonly replaceRow: HTMLElement | null;
  private readonly expandBtn: HTMLButtonElement | null;
  private expanded: boolean;

  constructor(view: EditorView) {
    this.view = view;
    this.query = getSearchQuery(view.state);
    this.expanded = view.state.field(replaceExpanded) && !view.state.readOnly;
    this.commit = this.commit.bind(this);

    this.searchField = el("input", {
      value: this.query.search,
      placeholder: phrase(view, "Find"),
      "aria-label": phrase(view, "Find"),
      class: "cm-textfield",
      name: "search",
      form: "",
      spellcheck: "false",
      autocomplete: "off",
      "main-field": "true",
      oninput: this.commit,
      onchange: this.commit,
    }) as HTMLInputElement;
    this.searchField.value = this.query.search;

    this.replaceField = el("input", {
      value: this.query.replace,
      placeholder: phrase(view, "Replace"),
      "aria-label": phrase(view, "Replace"),
      class: "cm-textfield",
      name: "replace",
      form: "",
      spellcheck: "false",
      autocomplete: "off",
      oninput: this.commit,
      onchange: this.commit,
    }) as HTMLInputElement;
    this.replaceField.value = this.query.replace;

    const caseToggle = toggle(
      "case",
      this.query.caseSensitive,
      phrase(view, "match case"),
      "Aa",
      this.commit,
    );
    const reToggle = toggle("re", this.query.regexp, phrase(view, "regexp"), ".*", this.commit);
    const wordToggle = toggle(
      "word",
      this.query.wholeWord,
      phrase(view, "by word"),
      "W",
      this.commit,
    );
    this.caseField = caseToggle.input;
    this.reField = reToggle.input;
    this.wordField = wordToggle.input;

    this.expandBtn = view.state.readOnly
      ? null
      : (el(
          "button",
          {
            type: "button",
            class: "cm-search-expand",
            name: "expand",
            "aria-expanded": String(this.expanded),
            "aria-label": phrase(view, "Expand replace"),
            title: phrase(view, "Expand replace"),
            onclick: () => this.setExpanded(!this.expanded),
          },
          [icon("expand")],
        ) as HTMLButtonElement);

    // Both rows share the panel's grid tracks. Options live inside the field,
    // keeping navigation distinct from the two replacement actions.
    const findActions = el("div", { class: "cm-search-actions" }, [
      navigationButton("prev", view),
      navigationButton("next", view),
      button("select", () => selectMatches(view), phrase(view, "all"), phrase(view, "Select All")),
    ]);
    const findOptions = el("div", { class: "cm-search-options" }, [
      caseToggle.wrap,
      reToggle.wrap,
      wordToggle.wrap,
    ]);
    const findRow = el("div", { class: "cm-search-row" }, [
      this.expandBtn ||
        el("span", { class: "cm-search-symbol", "aria-hidden": "true" }, [icon("search")]),
      el("div", { class: "cm-search-field" }, [this.searchField, findOptions]),
      findActions,
      el(
        "button",
        {
          type: "button",
          name: "close",
          class: "cm-search-close",
          "aria-label": phrase(view, "close"),
          title: phrase(view, "close"),
          onclick: () => closeSearchPanel(view),
        },
        [icon("close")],
      ),
    ]);

    this.replaceRow = view.state.readOnly
      ? null
      : el("div", { class: "cm-search-row cm-search-replace" }, [
          el("div", { class: "cm-search-field" }, [this.replaceField]),
          el("div", { class: "cm-search-actions" }, [
            button(
              "replace",
              () => replaceNext(view),
              phrase(view, "replace"),
              phrase(view, "Replace Next"),
            ),
            button(
              "replaceAll",
              () => replaceAll(view),
              phrase(view, "replace all"),
              phrase(view, "Replace All"),
            ),
          ]),
        ]);

    this.dom = el(
      "div",
      {
        class: "cm-search",
        onkeydown: (event) => this.keydown(event as KeyboardEvent),
      },
      this.replaceRow ? [findRow, this.replaceRow] : [findRow],
    );
    this.applyExpanded();
  }

  private setExpanded(on: boolean) {
    if (this.view.state.readOnly) return;
    this.expanded = on;
    this.applyExpanded();
    this.view.dispatch({ effects: setReplaceExpanded.of(on) });
    if (on) this.replaceField.focus();
    else this.searchField.focus();
  }

  private applyExpanded() {
    if (!this.replaceRow || !this.expandBtn) return;
    this.replaceRow.hidden = !this.expanded;
    this.expandBtn.setAttribute("aria-expanded", String(this.expanded));
    const label = phrase(this.view, this.expanded ? "Collapse replace" : "Expand replace");
    this.expandBtn.setAttribute("aria-label", label);
    this.expandBtn.title = label;
  }

  commit() {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseField.checked,
      regexp: this.reField.checked,
      wholeWord: this.wordField.checked,
      replace: this.replaceField.value,
    });
    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
  }

  keydown(event: KeyboardEvent) {
    // Candidate confirmation/cancellation belongs to the IME, not the search command.
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault();
    } else if (event.key === "Enter" && event.target === this.searchField) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(this.view);
    } else if (event.key === "Enter" && event.target === this.replaceField) {
      event.preventDefault();
      replaceNext(this.view);
    }
  }

  update(update: ViewUpdate) {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) this.setQuery(effect.value);
        if (
          effect.is(setReplaceExpanded) &&
          effect.value !== this.expanded &&
          !this.view.state.readOnly
        ) {
          this.expanded = effect.value;
          this.applyExpanded();
          if (this.expanded) {
            this.replaceField.focus();
            this.replaceField.select();
          }
        }
      }
    }
  }

  setQuery(query: SearchQuery) {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    this.caseField.checked = query.caseSensitive;
    this.reField.checked = query.regexp;
    this.wordField.checked = query.wholeWord;
  }

  mount() {
    if (this.expanded && !this.view.state.readOnly) {
      this.replaceField.select();
      return;
    }
    this.searchField.select();
  }

  get pos() {
    return 80;
  }

  get top() {
    return true;
  }
}

const commands = {
  "Editor.Find": (view: EditorView) => {
    if (!searchPanelOpen(view.state)) {
      // Fresh Ctrl+F opens find-only; do not inherit a prior replace expansion.
      view.dispatch({ effects: setReplaceExpanded.of(false) });
      openSearchPanel(view);
    }
    // When already open, focus find and leave an expanded replace row as-is (IDEA).
    queueMicrotask(() =>
      view.dom.querySelector<HTMLInputElement>('input[name="search"]')?.select(),
    );
    return true;
  },
  "Editor.Replace": (view: EditorView) => {
    if (view.state.readOnly) return false;
    view.dispatch({ effects: setReplaceExpanded.of(true) });
    if (!searchPanelOpen(view.state)) openSearchPanel(view);
    queueMicrotask(() => {
      const input = view.dom.querySelector<HTMLInputElement>('input[name="replace"]');
      input?.focus();
      input?.select();
    });
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
  // Keep editor panels below application dialogs and size against the editor,
  // including split diff panes, rather than the application window.
  "&": { isolation: "isolate", containerType: "inline-size", containerName: "editor-search" },
  ".cm-panels": {
    backgroundColor: "var(--color-dbx-chrome, var(--color-popover))",
    color: "var(--color-foreground)",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    zIndex: "1",
  },
  ".cm-panels-top": { borderBottom: "1px solid var(--color-border)" },
  // Match the specificity of CM's default search panel. Its margins and
  // absolutely positioned close button otherwise escape the custom grid.
  ".cm-panel.cm-search": {
    padding: "7px 8px",
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr) max-content 24px",
    alignItems: "center",
    gap: "6px",
    position: "relative",
  },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": {
    margin: "0",
    fontFamily: "inherit",
  },
  ".cm-search-row": { display: "contents" },
  ".cm-search-row[hidden]": { display: "none" },
  ".cm-search-field": {
    gridColumn: "2",
    gridRow: "1",
    display: "flex",
    alignItems: "center",
    minWidth: "0",
    height: "28px",
    boxSizing: "border-box",
    background: "var(--color-background)",
    border: "1px solid var(--color-input, var(--color-border))",
    borderRadius: "6px",
    overflow: "hidden",
  },
  ".cm-search-field:focus-within": {
    borderColor: "color-mix(in srgb, var(--color-ring) 65%, var(--color-border))",
    boxShadow: "0 0 0 2px color-mix(in srgb, var(--color-ring) 12%, transparent)",
  },
  ".cm-search input.cm-textfield": {
    flex: "1 1 0",
    width: "0",
    minWidth: "0",
    height: "26px",
    padding: "0 8px",
    boxSizing: "border-box",
    border: "none",
    borderRadius: "0",
    background: "transparent",
    color: "var(--color-foreground)",
    fontSize: "12px",
    lineHeight: "26px",
    outline: "none",
    boxShadow: "none",
  },
  ".cm-search input.cm-textfield::placeholder": {
    color: "var(--color-muted-foreground)",
    opacity: "0.8",
  },
  ".cm-search-actions": {
    gridColumn: "3",
    gridRow: "1",
    display: "grid",
    gridTemplateColumns: "28px 28px minmax(70px, 1fr)",
    gap: "4px",
    alignItems: "center",
    minWidth: "0",
  },
  ".cm-search button.cm-button": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    height: "28px",
    minWidth: "0",
    padding: "0 9px",
    border: "1px solid var(--color-border)",
    borderRadius: "6px",
    background: "var(--color-background)",
    color: "var(--color-foreground)",
    fontSize: "12px",
    lineHeight: "1",
    whiteSpace: "nowrap",
    cursor: "pointer",
    boxShadow: "none",
  },
  ".cm-search button.cm-search-navigation": {
    padding: "0",
    borderColor: "transparent",
    background: "transparent",
    color: "var(--color-muted-foreground)",
  },
  ".cm-search button:hover": {
    background: "var(--color-accent)",
    color: "var(--color-foreground)",
  },
  ".cm-search button:focus-visible, .cm-search-toggle:has(input:focus-visible)": {
    outline: "2px solid var(--color-ring)",
    outlineOffset: "1px",
  },
  ".cm-search-expand, .cm-search-symbol, .cm-panel.cm-search button[name=close]": {
    position: "static",
    gridColumn: "1",
    gridRow: "1",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "28px",
    padding: "0",
    border: "none",
    borderRadius: "5px",
    background: "transparent",
    color: "var(--color-muted-foreground)",
    cursor: "pointer",
    boxSizing: "border-box",
  },
  ".cm-panel.cm-search button[name=close]": { gridColumn: "4" },
  ".cm-search-expand[aria-expanded=true] svg": { transform: "rotate(90deg)" },
  ".cm-search-options": {
    display: "flex",
    alignItems: "center",
    flex: "0 0 auto",
    gap: "2px",
    padding: "0 3px",
  },
  ".cm-panel.cm-search .cm-search-toggle": {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "23px",
    height: "22px",
    border: "1px solid transparent",
    borderRadius: "4px",
    boxSizing: "border-box",
    fontSize: "11px",
    lineHeight: "1",
    fontWeight: "500",
    color: "var(--color-muted-foreground)",
    cursor: "pointer",
    userSelect: "none",
  },
  ".cm-search-toggle:hover": { background: "var(--color-accent)" },
  ".cm-search-toggle:has(input:checked)": {
    background: "var(--color-selection)",
    color: "var(--color-selection-foreground)",
    borderColor: "color-mix(in srgb, var(--color-ring) 35%, transparent)",
  },
  ".cm-search-toggle input": {
    position: "absolute",
    opacity: "0",
    inset: "0",
    width: "100%",
    height: "100%",
    cursor: "pointer",
  },
  '.cm-search-toggle:has(input[name="word"]) span': {
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },
  ".cm-search-replace .cm-search-field": { gridRow: "2" },
  ".cm-search-replace .cm-search-actions": {
    gridRow: "2",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  },
  "@container editor-search (max-width: 520px)": {
    ".cm-panel.cm-search": { gridTemplateColumns: "24px minmax(0, 1fr) 24px", gap: "6px" },
    ".cm-search-field": { gridColumn: "2", gridRow: "1" },
    ".cm-panel.cm-search button[name=close]": { gridColumn: "3" },
    ".cm-search-actions": { gridColumn: "2", gridRow: "2", justifySelf: "start" },
    ".cm-search-replace .cm-search-field": { gridRow: "3" },
    ".cm-search-replace .cm-search-actions": { gridColumn: "2", gridRow: "4" },
  },
  ".cm-searchMatch": { backgroundColor: "#eab30830", outline: "1px solid #eab30860" },
  ".cm-searchMatch-selected": { backgroundColor: "#eab30860" },
});
// Stable document extensions can survive a view being destroyed and recreated.
// They contain no component callbacks or DOM references.
export const editorSearchState = [
  replaceExpanded,
  search({ top: true, literal: true, createPanel: (view) => new IdeaSearchPanel(view) }),
];

export function editorSearch(translate?: (key: string) => string): Extension {
  return [
    EditorView.contentAttributes.of({ tabindex: "0" }),
    editorSearchState,
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
            all: translate("editor.selectMatches"),
            "Find Next": translate("editor.findNextAction"),
            "Find Previous": translate("editor.findPreviousAction"),
            "Select All": translate("editor.selectAll"),
            "match case": translate("contentSearch.caseSensitive"),
            "by word": translate("contentSearch.wholeWord"),
            regexp: translate("contentSearch.regex"),
            replace: translate("editor.replaceNext"),
            "replace all": translate("editor.replaceAll"),
            "Replace Next": translate("editor.replaceNextAction"),
            "Replace All": translate("editor.replaceAllAction"),
            close: translate("common.close"),
            "Expand replace": translate("editor.expandReplace"),
            "Collapse replace": translate("editor.collapseReplace"),
          }
        : {
            next: "Next",
            previous: "Prev",
            all: "Find All",
            "Find Next": "Find Next",
            "Find Previous": "Find Previous",
            "Select All": "Find All Matches",
            replace: "Replace",
            "replace all": "Replace All",
            "Replace Next": "Replace Current Match",
            "Replace All": "Replace All in File",
            "Expand replace": "Show Replace",
            "Collapse replace": "Hide Replace",
          },
    ),
    searchTheme,
  ];
}
