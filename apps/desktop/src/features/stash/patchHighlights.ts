import { RangeSetBuilder, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

const added = Decoration.line({ class: "cm-patch-added" });
const removed = Decoration.line({ class: "cm-patch-removed" });
const header = Decoration.line({ class: "cm-patch-header" });

function build(doc: Text) {
  const builder = new RangeSetBuilder<Decoration>();
  let oldRemaining = 0,
    newRemaining = 0,
    offset = 0;
  for (const line of doc.iterLines()) {
    let mark: Decoration | undefined;
    if (oldRemaining > 0 || newRemaining > 0) {
      if (line.startsWith("+") && newRemaining > 0) {
        newRemaining--;
        mark = added;
      } else if (line.startsWith("-") && oldRemaining > 0) {
        oldRemaining--;
        mark = removed;
      } else if (line.startsWith(" ") && oldRemaining > 0 && newRemaining > 0) {
        oldRemaining--;
        newRemaining--;
      } else if (!line.startsWith("\\")) {
        oldRemaining = 0;
        newRemaining = 0;
      }
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldRemaining = Number(hunk[1] ?? 1);
      newRemaining = Number(hunk[2] ?? 1);
      mark = header;
    } else if (
      !mark &&
      /^(diff --git |--- |\+\+\+ |rename (from|to) |(old|new) mode |(new|deleted) file mode |GIT binary patch|Binary files )/.test(
        line,
      )
    ) {
      mark = header;
    }
    if (mark) builder.add(offset, offset, mark);
    offset += line.length + 1;
  }
  return builder.finish();
}

/** Parse hunk counts once per document, retaining decorations during scrolling. */
export const patchHighlights = StateField.define<DecorationSet>({
  create: (state) => build(state.doc),
  update: (marks, tr) => (tr.docChanged ? build(tr.state.doc) : marks),
  provide: (field) => EditorView.decorations.from(field),
});
