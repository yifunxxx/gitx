import { RangeSetBuilder, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { DiffHunk } from "@/lib/backend";

const added = Decoration.line({ class: "cm-diff-insert" });
const modified = Decoration.line({ class: "cm-file-modified" });

function build(doc: Text, hunks: DiffHunk[]): DecorationSet {
  const marks = new Map<number, Decoration>();
  for (const hunk of hunks) {
    const mark = hunk.lines.some((line) => line.startsWith("-")) ? modified : added;
    let number = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.startsWith("-") || line.startsWith("\\")) continue;
      if (line.startsWith("+") && number > 0 && number <= doc.lines) marks.set(number, mark);
      number++;
    }
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const [number, mark] of [...marks].sort(([a], [b]) => a - b)) {
    const pos = doc.line(number).from;
    builder.add(pos, pos, mark);
  }
  return builder.finish();
}

/** Compute once per loaded file; scroll/selection updates reuse the same ranges. */
export function fileChangeHighlights(hunks: DiffHunk[]) {
  return StateField.define<DecorationSet>({
    create: (state) => build(state.doc, hunks),
    update: (marks, transaction) =>
      transaction.docChanged ? marks.map(transaction.changes) : marks,
    provide: (field) => EditorView.decorations.from(field),
  });
}
