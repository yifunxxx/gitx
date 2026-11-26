import type { Extension } from "@codemirror/state";
import { EditorView, drawSelection } from "@codemirror/view";
import { editorSearch } from "./editorSearch";

function createChrome(caret: boolean): readonly Extension[] {
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

// Style modules stay mounted after a view is destroyed; there are only two variants.
const visibleCaret = createChrome(true);
const hiddenCaret = createChrome(false);

/** Shared CM selection + caret chrome for dark/light themes. */
export function editorChrome(opts?: {
  caret?: boolean;
  translate?: (key: string) => string;
}): readonly Extension[] {
  return [opts?.caret === false ? hiddenCaret : visibleCaret, editorSearch(opts?.translate)];
}
