import type { Extension } from "@codemirror/state";
import { EditorView, drawSelection } from "@codemirror/view";

/** Shared CM selection + caret chrome for dark/light themes. */
export function editorChrome(opts?: { caret?: boolean }): Extension[] {
  const caret = opts?.caret !== false;
  return [
    drawSelection(),
    EditorView.theme({
      ".cm-content": {
        caretColor: caret ? "var(--color-foreground)" : "transparent",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: caret ? "var(--color-foreground)" : "transparent",
        borderLeftWidth: "2px",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: "var(--color-selection)",
      },
      "::selection": {
        color: "var(--color-selection-foreground)",
      },
    }),
  ];
}
