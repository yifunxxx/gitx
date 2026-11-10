import { expect, it } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { history, redo, undo } from "@codemirror/commands";
import { parseSource, restoreEndings, sourceExtensions, sourceText } from "./preservedText";

function document(text: string) {
  const parsed = parseSource(text);
  const editor = {
    state: EditorState.create({
      doc: parsed.doc,
      extensions: [sourceExtensions(parsed), history()],
    }),
    dispatch: (transaction: Transaction) => {
      editor.state = transaction.state;
    },
  };
  return editor;
}

it("preserves mixed separators, blank lines and missing final newline through edit/undo/redo", () => {
  const original = "first\r\n\r\nsecond\nthird\rfourth";
  const editor = document(original);
  expect(sourceText(editor.state)).toBe(original);
  editor.dispatch(editor.state.update({ changes: { from: 0, to: 5, insert: "edited" } }));
  expect(sourceText(editor.state)).toBe("edited\r\n\r\nsecond\nthird\rfourth");
  undo(editor);
  expect(sourceText(editor.state)).toBe(original);
  redo(editor);
  expect(sourceText(editor.state)).toBe("edited\r\n\r\nsecond\nthird\rfourth");
});

it("restores original separators when undoing deletion across multiple lines", () => {
  const original = "one\r\ntwo\nthree\rfour";
  const editor = document(original);
  editor.dispatch(editor.state.update({ changes: { from: 2, to: 10, insert: "X\nY" } }));
  expect(sourceText(editor.state)).toBe("onX\r\nYree\rfour");
  undo(editor);
  expect(sourceText(editor.state)).toBe(original);
  redo(editor);
  expect(sourceText(editor.state)).toBe("onX\r\nYree\rfour");
});

it("keeps original newlines at insertion boundaries and uses the file style for new ones", () => {
  const editor = document("A\r\nB\nC");
  editor.dispatch(editor.state.update({ changes: { from: 1, insert: "x\ny" } }));
  expect(sourceText(editor.state)).toBe("Ax\r\ny\r\nB\nC");
  editor.dispatch(editor.state.update({ changes: { from: 5, insert: "z\nw" } }));
  expect(sourceText(editor.state)).toBe("Ax\r\ny\r\nz\r\nwB\nC");
  undo(editor);
  undo(editor);
  expect(sourceText(editor.state)).toBe("A\r\nB\nC");
});

it("restores a mixed document after grouped deletes and whole-file replacement", () => {
  const original = "a\r\nb\nc\rd\r\n";
  const editor = document(original);
  for (let i = 0; i < 3; i++) {
    editor.dispatch(
      editor.state.update({
        changes: { from: 1, to: 2 },
        annotations: Transaction.userEvent.of("delete.forward"),
      }),
    );
  }
  undo(editor);
  expect(sourceText(editor.state)).toBe(original);
  const replacement = parseSource("new\n\nlast");
  editor.dispatch(
    editor.state.update({
      changes: { from: 0, to: editor.state.doc.length, insert: replacement.doc },
      effects: restoreEndings.of(replacement.endings),
    }),
  );
  expect(sourceText(editor.state)).toBe("new\n\nlast");
  undo(editor);
  expect(sourceText(editor.state)).toBe(original);
  redo(editor);
  expect(sourceText(editor.state)).toBe("new\n\nlast");
});

it("keeps an empty document empty, including after undo", () => {
  const editor = document("");
  editor.dispatch(editor.state.update({ changes: { from: 0, insert: "x\n" } }));
  expect(sourceText(editor.state)).toBe("x\n");
  undo(editor);
  expect(sourceText(editor.state)).toBe("");
});
