import { EditorView } from "@codemirror/view";

// CodeMirror retains mounted style modules for the lifetime of the DOM root.
// Allocate fixed themes once, across component instances and refreshes.
// CSS variables keep light/dark and material changes live without reallocation.

export const diffTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    backgroundColor: "var(--color-background)",
    color: "var(--color-foreground)",
  },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.45" },
  ".cm-gutters": {
    backgroundColor: "var(--color-background)",
    color: "var(--color-muted-foreground)",
    borderRight: "1px solid var(--color-border)",
  },
  ".cm-diff-insert": {
    backgroundColor: "rgb(var(--diff-insert-bg) / 0.9)",
  },
  ".cm-diff-delete": {
    backgroundColor: "rgb(var(--diff-delete-bg) / 0.9)",
  },
  ".cm-diff-word-insert": {
    backgroundColor: "rgb(var(--diff-word-insert) / 1)",
    borderRadius: "2px",
  },
  ".cm-diff-word-delete": {
    backgroundColor: "rgb(var(--diff-word-delete) / 1)",
    borderRadius: "2px",
  },
  ".cm-diff-change-gutter": {
    width: "4px",
    minWidth: "4px",
  },
  ".cm-diff-hunk-gutter .cm-gutterElement": { padding: "0 2px" },
  ".diff-hunk-actions": { display: "inline-flex", gap: "2px", verticalAlign: "top" },
  ".diff-hunk-action": {
    width: "19px", height: "18px", lineHeight: "16px", padding: "0",
    color: "var(--color-foreground)", backgroundColor: "var(--color-muted)",
    border: "1px solid var(--color-border)", borderRadius: "3px", cursor: "pointer",
    fontSize: "14px", fontFamily: "sans-serif",
  },
  ".diff-hunk-action:hover:not(:disabled)": { backgroundColor: "var(--color-accent)" },
  ".diff-hunk-action:focus-visible": { outline: "2px solid var(--color-ring)", outlineOffset: "1px" },
  ".diff-hunk-action:disabled": { opacity: "0.45", cursor: "default" },
  ".cm-diff-gutter-insert": {
    width: "3px",
    height: "100%",
    marginLeft: "1px",
    backgroundColor: "rgb(var(--gutter-added) / 1)",
  },
  ".cm-diff-gutter-delete": {
    width: "3px",
    height: "100%",
    marginLeft: "1px",
    backgroundColor: "rgb(var(--gutter-deleted) / 1)",
  },
});

export const fileTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12.5px",
    backgroundColor: "var(--color-background)",
    color: "var(--color-foreground)",
  },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono, monospace)" },
  ".cm-gutters": {
    backgroundColor: "var(--color-background)",
    color: "var(--color-muted-foreground)",
    borderRight: "1px solid var(--color-border)",
  },
  ".cm-diff-insert": {
    backgroundColor: "color-mix(in oklab, var(--color-success, #16a34a) 22%, transparent)",
  },
  ".cm-file-modified": {
    backgroundColor: "color-mix(in oklab, var(--color-warning, #ca8a04) 22%, transparent)",
  },
});

export const shelfPatchTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    backgroundColor: "var(--color-background)",
    color: "var(--color-foreground)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono, monospace)",
    lineHeight: "20px",
  },
  ".cm-gutters": {
    backgroundColor: "var(--color-background)",
    color: "var(--color-muted-foreground)",
    borderRight: "1px solid var(--color-border)",
  },
  ".cm-patch-added": {
    backgroundColor: "color-mix(in oklab, var(--color-success, #16a34a) 20%, transparent)",
  },
  ".cm-patch-removed": {
    backgroundColor: "color-mix(in oklab, var(--color-destructive) 18%, transparent)",
  },
  ".cm-patch-header": { color: "var(--color-muted-foreground)", fontWeight: "600" },
});

export const mergeTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    backgroundColor: "var(--color-background)",
    color: "var(--color-foreground)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono, monospace)",
    lineHeight: "22px",
  },
  ".cm-content": { padding: "8px 0" },
  ".cm-gutters": {
    backgroundColor: "var(--color-background)",
    color: "var(--color-muted-foreground)",
    borderColor: "var(--color-border)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-merge-pending": {
    backgroundColor: "rgb(var(--diff-conflict-bg))",
    boxShadow: "inset 3px 0 var(--color-warning)",
  },
  ".cm-merge-accepted": {
    backgroundColor: "rgb(var(--diff-insert-bg))",
    boxShadow: "inset 3px 0 var(--color-success)",
  },
  ".cm-merge-ignored": { opacity: "0.55" },
  ".cm-merge-manual": {
    backgroundColor: "rgb(var(--diff-conflict-bg))",
    boxShadow: "inset 3px 0 var(--color-info)",
  },
  ".cm-merge-actions": { minWidth: "48px", color: "var(--color-foreground)" },
  ".cm-merge-actions .cm-gutterElement": { padding: "0 2px" },
  ".merge-actions": { display: "inline-flex", gap: "2px", verticalAlign: "top" },
  ".merge-action": {
    width: "21px",
    height: "21px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "3px",
    cursor: "pointer",
    color: "var(--color-foreground)",
    backgroundColor: "var(--color-muted)",
    border: "1px solid var(--color-border)",
    padding: "0",
    fontSize: "15px",
  },
  ".merge-action:hover:not(:disabled)": { backgroundColor: "var(--color-accent)" },
  ".merge-action:focus-visible": {
    outline: "2px solid var(--color-ring)",
    outlineOffset: "1px",
  },
  ".merge-action:disabled": { cursor: "default", opacity: "0.45" },
  ".merge-action[data-decided=accept]": { color: "var(--color-success)" },
});

export const textViewportTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "12px", backgroundColor: "transparent" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono, monospace)",
    lineHeight: "20px",
  },
  ".cm-content": { padding: "8px 0" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--color-muted-foreground)",
    borderRight: "1px solid var(--color-border)",
  },
  "&.cm-focused": { outline: "none" },
});

export const consoleTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "11px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, monospace" },
  ".cm-content": { padding: "8px" },
  ".console-cmd": { color: "var(--color-info)" },
  ".console-stderr": { color: "var(--color-destructive)" },
});
