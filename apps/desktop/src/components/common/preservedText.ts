import {
  EditorState,
  Facet,
  RangeSet,
  RangeSetBuilder,
  RangeValue,
  StateEffect,
  StateField,
  type Range,
} from "@codemirror/state";
import { invertedEffects } from "@codemirror/commands";

// CodeMirror uses one document position per line break. Keep the source's
// actual separators separately so even mixed LF/CRLF files survive edits/undo.
class LineEnding extends RangeValue {
  override startSide = 1;
  override endSide = -1;
  constructor(readonly text: string) {
    super();
  }
}
const endings = new Map(["\n", "\r\n", "\r"].map((text) => [text, new LineEnding(text)]));
const preferredEnding = Facet.define<string, string>({ combine: (values) => values[0] ?? "\n" });
export const restoreEndings = StateEffect.define<RangeSet<LineEnding>>({
  map: (value, changes) => value.map(changes),
});

const lineEndings = StateField.define<RangeSet<LineEnding>>({
  create: () => RangeSet.empty,
  update(value, transaction) {
    if (transaction.docChanged) {
      value = value.map(transaction.changes);
      const added: Range<LineEnding>[] = [];
      const ending = endings.get(transaction.state.facet(preferredEnding))!;
      transaction.changes.iterChanges((_from, _to, start, _end, inserted) => {
        let offset = start;
        for (let line = 1; line < inserted.lines; line++) {
          offset += inserted.line(line).length;
          added.push(ending.range(offset, offset + 1));
          offset++;
        }
      });
      value = value.update({ add: added, sort: true });
    }
    for (const effect of transaction.effects) {
      if (!effect.is(restoreEndings)) continue;
      const replacements: Range<LineEnding>[] = [];
      const positions = new Set<number>();
      for (const cursor = effect.value.iter(); cursor.value; cursor.next()) {
        positions.add(cursor.from);
        replacements.push(cursor.value.range(cursor.from, cursor.to));
      }
      if (replacements.length) {
        value = value.update({
          filterFrom: replacements[0]!.from,
          filterTo: replacements.at(-1)!.to,
          filter: (from) => !positions.has(from),
          add: replacements,
        });
      }
    }
    return value;
  },
});

export function parseSource(text: string) {
  const marks = new RangeSetBuilder<LineEnding>();
  let removed = 0;
  let preferred = "";
  for (const match of text.matchAll(/\r\n|\r|\n/g)) {
    const from = match.index! - removed;
    marks.add(from, from + 1, endings.get(match[0])!);
    removed += match[0].length - 1;
    preferred ||= match[0];
  }
  return {
    doc: text.replace(/\r\n|\r/g, "\n"),
    endings: marks.finish(),
    preferred: preferred || "\n",
  };
}

export function sourceExtensions(source: ReturnType<typeof parseSource>) {
  return [
    preferredEnding.of(source.preferred),
    lineEndings.init(() => source.endings),
    invertedEffects.of((transaction) => {
      const removed: Range<LineEnding>[] = [];
      const old = transaction.startState.field(lineEndings);
      transaction.changes.iterChangedRanges((from, to) => {
        if (from === to) return;
        old.between(from, to, (start, end, value) => {
          if (start >= from && start < to) removed.push(value.range(start, end));
        });
      });
      return removed.length ? [restoreEndings.of(RangeSet.of(removed, true))] : [];
    }),
  ];
}

export function sourceText(state: EditorState) {
  const doc = state.doc.toString();
  const pieces: string[] = [];
  let offset = 0;
  for (const cursor = state.field(lineEndings).iter(); cursor.value; cursor.next()) {
    if (cursor.value.text === "\n") continue;
    pieces.push(doc.slice(offset, cursor.from), cursor.value.text);
    offset = cursor.to;
  }
  pieces.push(doc.slice(offset));
  return pieces.join("");
}
