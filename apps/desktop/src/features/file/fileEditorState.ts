import { Compartment, EditorState, type StateEffect } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { parseSource, sourceExtensions } from "@/components/common/preservedText";
import { editorSearchState } from "@/features/editor/editorSearch";

// Component callbacks and view-specific extensions are removed before caching.
// Only document state survives; hidden tabs do not retain EditorViews or DOM.
export const fileViewConfig = new Compartment();
export type FileEditorSnapshot = {
  state: EditorState;
  scroll: StateEffect<unknown>;
  text: string;
  generation: number;
  editable: boolean;
};

export function createFileEditorState(text: string) {
  const source = parseSource(text);
  return EditorState.create({
    doc: source.doc,
    extensions: [sourceExtensions(source), history(), editorSearchState, fileViewConfig.of([])],
  });
}
