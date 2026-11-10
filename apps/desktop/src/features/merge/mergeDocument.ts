import {
  Compartment,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  Transaction,
  type ChangeDesc,
  type TransactionSpec,
} from "@codemirror/state";
import { history, invertedEffects, isolateHistory } from "@codemirror/commands";
import type { Merge3Result } from "@/lib/backend";
import {
  parseSource,
  restoreEndings,
  sourceExtensions,
  sourceText,
} from "@/components/common/preservedText";

export type MergeSide = "ours" | "theirs";
export type MergeChoice = "pending" | "accept" | "ignore";
export type MergeRange = {
  index: number;
  from: number;
  to: number;
  ours: MergeChoice;
  theirs: MergeChoice;
  order: MergeSide[];
  manual: boolean;
  confirmed: boolean;
};
export const mergeViewConfig = new Compartment();
function mapRanges(ranges: readonly MergeRange[], changes: ChangeDesc) {
  return ranges.map((range) => {
    const from = changes.mapPos(range.from, 1);
    return { ...range, from, to: Math.max(from, changes.mapPos(range.to, -1)) };
  });
}
const restoreRanges = StateEffect.define<readonly MergeRange[]>({ map: mapRanges });
export const mergeRanges = StateField.define<readonly MergeRange[]>({
  create: () => [],
  update(ranges, tr) {
    // Explicit resolutions and undo restore both document positions and decisions.
    const restored = tr.effects.find((effect) => effect.is(restoreRanges));
    if (restored) return restored.value;
    if (!tr.docChanged) return ranges;
    return ranges.map((range) => {
      let touched = false;
      tr.changes.iterChangedRanges((from, to) => {
        if (
          from === to ? from >= range.from && from <= range.to : from < range.to && to > range.from
        )
          touched = true;
      });
      const from = tr.changes.mapPos(range.from, touched ? -1 : 1);
      return {
        ...range,
        from,
        to: Math.max(from, tr.changes.mapPos(range.to, touched ? 1 : -1)),
        manual: range.manual || touched,
        confirmed: touched ? false : range.confirmed,
      };
    });
  },
});

export function initialMergeText(merge: Merge3Result) {
  return merge.blocks
    .map((b) => (b.kind === "conflict" ? b.baseLines : b.resultLines).join(""))
    .join("");
}
export function createMergeState(merge: Merge3Result) {
  let offset = 0;
  const ranges: MergeRange[] = [];
  for (const [index, block] of merge.blocks.entries()) {
    const text = (block.kind === "conflict" ? block.baseLines : block.resultLines).join("");
    const length = parseSource(text).doc.length;
    if (block.kind === "conflict")
      ranges.push({
        index,
        from: offset,
        to: offset + length,
        ours: "pending",
        theirs: "pending",
        order: [],
        manual: false,
        confirmed: false,
      });
    offset += length;
  }
  const source = parseSource(initialMergeText(merge));
  return EditorState.create({
    doc: source.doc,
    extensions: [
      sourceExtensions(source),
      history(),
      mergeRanges.init(() => ranges),
      mergeViewConfig.of([]),
      invertedEffects.of((tr) =>
        tr.docChanged || tr.effects.some((e) => e.is(restoreRanges))
          ? [restoreRanges.of(tr.startState.field(mergeRanges))]
          : [],
      ),
    ],
  });
}
export const rangePending = (range: MergeRange) =>
  range.manual ? !range.confirmed : range.ours === "pending" || range.theirs === "pending";
export const pendingMergeCount = (state: EditorState) =>
  state.field(mergeRanges).filter(rangePending).length;
export const hasMergeDecisions = (state: EditorState) =>
  state.field(mergeRanges).some((r) => r.ours !== "pending" || r.theirs !== "pending" || r.manual);

function chosenText(merge: Merge3Result, range: MergeRange) {
  const block = merge.blocks[range.index]!;
  if (!range.order.length) return block.baseLines.join("");
  const ending =
    [...block.baseLines, ...block.oursLines, ...block.theirsLines]
      .join("")
      .match(/\r\n|\r|\n/)?.[0] ?? "\n";
  return range.order.reduce((text, side) => {
    const part = (side === "ours" ? block.oursLines : block.theirsLines).join("");
    // When combining two EOF insertions, keep them on separate lines.
    return text + (text && part && !/[\r\n]$/.test(text) ? ending : "") + part;
  }, "");
}

/** A block action never reconstructs the rest of the document. */
export function decideMergeSide(
  state: EditorState,
  merge: Merge3Result,
  index: number,
  side: MergeSide,
  choice: Exclude<MergeChoice, "pending">,
  exclusive = false,
): TransactionSpec | null {
  const ranges = state.field(mergeRanges);
  const current = ranges.find((r) => r.index === index);
  if (!current || current.manual || current[side] !== "pending") return null;
  const next: MergeRange = {
    ...current,
    [side]: choice,
    order: choice === "accept" ? [...current.order, side] : current.order,
  };
  if (exclusive) {
    next[side === "ours" ? "theirs" : "ours"] = "ignore";
    next.order = choice === "accept" ? [side] : [];
  }
  const parsed = parseSource(chosenText(merge, next));
  const changes = state.changes({ from: current.from, to: current.to, insert: parsed.doc });
  const updated = mapRanges(ranges, changes).map((r) =>
    r.index === index ? { ...next, from: current.from, to: current.from + parsed.doc.length } : r,
  );
  // Keep exact CRLF/LF/CR tokens in the inserted fragment, including mixed endings.
  const endings = [];
  for (const cursor = parsed.endings.iter(); cursor.value; cursor.next())
    endings.push(cursor.value.range(cursor.from + current.from, cursor.to + current.from));
  return {
    changes,
    effects: [restoreRanges.of(updated), restoreEndings.of(RangeSet.of(endings))],
    annotations: [isolateHistory.of("full"), Transaction.userEvent.of("input.merge")],
  };
}

export function confirmManualRange(state: EditorState, index: number): TransactionSpec | null {
  const current = state.field(mergeRanges).find((r) => r.index === index);
  if (!current?.manual || current.confirmed) return null;
  return {
    effects: restoreRanges.of(
      state.field(mergeRanges).map((r) => (r.index === index ? { ...r, confirmed: true } : r)),
    ),
    annotations: [isolateHistory.of("full"), Transaction.userEvent.of("input.merge")],
  };
}

/** Bulk acceptance is one transaction and one undo step, even for large merges. */
export function decideAllMergeSide(
  state: EditorState,
  merge: Merge3Result,
  side: MergeSide,
): TransactionSpec | null {
  const changes = [];
  const endings = [];
  const ranges: MergeRange[] = [];
  let delta = 0;
  for (const range of state.field(mergeRanges)) {
    const from = range.from + delta;
    if (!rangePending(range) || range.manual) {
      ranges.push({ ...range, from, to: range.to + delta });
      continue;
    }
    const next: MergeRange = {
      ...range,
      ours: "ignore",
      theirs: "ignore",
      [side]: "accept",
      order: [side],
    };
    const parsed = parseSource(chosenText(merge, next));
    changes.push({ from: range.from, to: range.to, insert: parsed.doc });
    ranges.push({ ...next, from, to: from + parsed.doc.length });
    for (const cursor = parsed.endings.iter(); cursor.value; cursor.next())
      endings.push(cursor.value.range(cursor.from + from, cursor.to + from));
    delta += parsed.doc.length - (range.to - range.from);
  }
  if (!changes.length) return null;
  return {
    changes,
    effects: [restoreRanges.of(ranges), restoreEndings.of(RangeSet.of(endings, true))],
    annotations: [isolateHistory.of("full"), Transaction.userEvent.of("input.merge")],
  };
}

/** Integrate changes made by another editor without guessing block identities. */
export function syncMergeText(state: EditorState, text: string) {
  const previous = sourceText(state);
  if (previous === text) return state;
  const old = state.doc.toString();
  const parsed = parseSource(text);
  let from = 0,
    tail = 0;
  while (from < old.length && from < parsed.doc.length && old[from] === parsed.doc[from]) from++;
  while (
    tail < old.length - from &&
    tail < parsed.doc.length - from &&
    old[old.length - tail - 1] === parsed.doc[parsed.doc.length - tail - 1]
  )
    tail++;
  return state.update({
    changes: {
      from,
      to: old.length - tail,
      insert: parsed.doc.slice(from, parsed.doc.length - tail),
    },
    effects: restoreEndings.of(parsed.endings),
    annotations: isolateHistory.of("full"),
  }).state;
}

export function sourceBlockPositions(merge: Merge3Result, side: MergeSide) {
  let offset = 0;
  return merge.blocks.map((block, index) => {
    const from = offset;
    offset += parseSource((side === "ours" ? block.oursLines : block.theirsLines).join("")).doc
      .length;
    return { index, from, to: offset };
  });
}
