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
    onchange,
  }) as HTMLInputElement;
  input.checked = checked;
  const wrap = el("label", { class: "cm-search-toggle", title: label, "aria-label": label }, [
    input,
    el("span", {}, [short]),
  ]);
  return { input, wrap };
}

function button(name: string, onclick: () => void, content: string) {
  return el("button", { type: "button", class: "cm-button", name, onclick }, [content]);
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
          ["▸"],
        ) as HTMLButtonElement);

    const findRow = el("div", { class: "cm-search-row" }, [
      ...(this.expandBtn ? [this.expandBtn] : []),
      this.searchField,
      button("next", () => findNext(view), phrase(view, "next")),
      button("prev", () => findPrevious(view), phrase(view, "previous")),
      button("select", () => selectMatches(view), phrase(view, "all")),
      caseToggle.wrap,
      reToggle.wrap,
      wordToggle.wrap,
      el(
        "button",
        {
          type: "button",
          name: "close",
          class: "cm-search-close",
          "aria-label": phrase(view, "close"),
          onclick: () => closeSearchPanel(view),
        },
        ["×"],
      ),
    ]);

    this.replaceRow = view.state.readOnly
      ? null
      : el("div", { class: "cm-search-row cm-search-replace" }, [
          this.replaceField,
          button("replace", () => replaceNext(view), phrase(view, "replace")),
          button("replaceAll", () => replaceAll(view), phrase(view, "replace all")),
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
    this.expandBtn.textContent = this.expanded ? "▾" : "▸";
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
  // Keep the find bar inside the editor stacking context so global dialogs
  // (Settings etc., DialogHost z-80) paint above it. CM defaults sticky z-300.
  "&": { isolation: "isolate" },
  ".cm-panels": {
    backgroundColor: "var(--color-popover)",
    color: "var(--color-foreground)",
    fontSize: "12px",
    zIndex: "1",
  },
  ".cm-search": {
    padding: "4px 8px",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "4px",
    position: "relative",
  },
  ".cm-search-row": {
    display: "flex",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: "4px",
    minWidth: 0,
  },
  ".cm-search input.cm-textfield": {
    flex: "1 1 10rem",
    minWidth: "8rem",
    border: "1px solid var(--color-border)",
    borderRadius: "4px",
    background: "var(--color-background)",
    color: "var(--color-foreground)",
    padding: "2px 6px",
    height: "24px",
  },
  ".cm-search button.cm-button": {
    border: "1px solid var(--color-border)",
    borderRadius: "4px",
    background: "var(--color-background)",
    color: "var(--color-foreground)",
    padding: "2px 7px",
    height: "24px",
    lineHeight: "1.2",
    cursor: "pointer",
    flex: "0 0 auto",
  },
  ".cm-search-expand, .cm-search-close": {
    width: "24px",
    height: "24px",
    padding: "0",
    border: "none",
    background: "transparent",
    color: "var(--color-foreground)",
    cursor: "pointer",
    flex: "0 0 auto",
    fontSize: "12px",
    lineHeight: "24px",
  },
  ".cm-search-close": { marginLeft: "auto" },
  ".cm-search-toggle": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "2px",
    fontSize: "11px",
    padding: "0 5px",
    height: "24px",
    border: "1px solid transparent",
    borderRadius: "4px",
    cursor: "pointer",
    userSelect: "none",
    flex: "0 0 auto",
  },
  ".cm-search-toggle:has(input:checked)": {
    borderColor: "var(--color-border)",
    background: "color-mix(in srgb, var(--color-foreground) 12%, transparent)",
  },
  ".cm-search-toggle input": { position: "absolute", opacity: "0", width: "0", height: "0" },
  ".cm-searchMatch": { backgroundColor: "#eab30830", outline: "1px solid #eab30860" },
  ".cm-searchMatch-selected": { backgroundColor: "#eab30860" },
});

export function editorSearch(translate?: (key: string) => string): Extension {
  return [
    EditorView.contentAttributes.of({ tabindex: "0" }),
    replaceExpanded,
    search({ top: true, literal: true, createPanel: (view) => new IdeaSearchPanel(view) }),
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
            "Expand replace": translate("editor.expandReplace"),
            "Collapse replace": translate("editor.collapseReplace"),
          }
        : {
            "Expand replace": "Show Replace",
            "Collapse replace": "Hide Replace",
          },
    ),
    searchTheme,
  ];
}
