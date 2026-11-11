import { expect, it } from "vitest";
import { undo, redo } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import type { Merge3Block, Merge3Result } from "@/lib/backend";
import { sourceText } from "@/components/common/preservedText";
import {
  createMergeState,
  decideMergeSide,
  mergeRanges,
  pendingMergeCount,
  confirmManualRange,
  syncMergeText,
  decideAllMergeSide,
} from "./mergeDocument";

const block = (base = "base\n", ours = "left\n", theirs = "right\n"): Merge3Block => ({
  kind: "conflict",
  baseLines: [base],
  oursLines: [ours],
  theirsLines: [theirs],
  resultLines: [],
  isSimple: false,
});
const equal = (text: string): Merge3Block => ({
  ...block(text, text, text),
  kind: "equal",
  resultLines: [text],
  isSimple: true,
});
const model = (...blocks: Merge3Block[]): Merge3Result => ({
  blocks,
  conflictCount: blocks.filter((b) => b.kind === "conflict").length,
});
function editor(merge: Merge3Result) {
  let state = createMergeState(merge);
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: { state: EditorState }) {
      state = tr.state;
    },
  };
  const choose = (
    index: number,
    side: "ours" | "theirs",
    choice: "accept" | "ignore",
    exclusive = false,
  ) => {
    const spec = decideMergeSide(state, merge, index, side, choice, exclusive);
    if (spec) state = state.update(spec).state;
    return spec;
  };
  return {
    view,
    choose,
    get state() {
      return state;
    },
    set state(value) {
      state = value;
    },
  };
}

it("accepts one side, ignores the other, and undoes/ redoes both decisions with text", () => {
  const e = editor(model(block()));
  expect(sourceText(e.state)).toBe("base\n");
  e.choose(0, "ours", "accept");
  expect(sourceText(e.state)).toBe("left\n");
  expect(pendingMergeCount(e.state)).toBe(1);
  e.choose(0, "theirs", "ignore");
  expect(pendingMergeCount(e.state)).toBe(0);
  undo(e.view);
  expect(pendingMergeCount(e.state)).toBe(1);
  undo(e.view);
  expect(sourceText(e.state)).toBe("base\n");
  expect(e.state.field(mergeRanges)[0]!.ours).toBe("pending");
  redo(e.view);
  redo(e.view);
  expect(sourceText(e.state)).toBe("left\n");
  expect(pendingMergeCount(e.state)).toBe(0);
});

it("combines accepted sides in click order and keeps the base when both sides are ignored", () => {
  const e = editor(model(block("base", "left", "right")));
  e.choose(0, "theirs", "accept");
  e.choose(0, "ours", "accept");
  expect(sourceText(e.state)).toBe("right\nleft");
  expect(pendingMergeCount(e.state)).toBe(0);
  const ignored = editor(model(block()));
  ignored.choose(0, "ours", "ignore");
  ignored.choose(0, "theirs", "ignore");
  expect(sourceText(ignored.state)).toBe("base\n");
  expect(pendingMergeCount(ignored.state)).toBe(0);
});

it("preserves unrelated hand edits, mixed line endings, blanks and no final newline", () => {
  const e = editor(
    model(equal("prefix\r\n\r\n"), block("base\r\n", "left\r\n\n", "right\r"), equal("tail")),
  );
  e.state = syncMergeText(e.state, sourceText(e.state).replace("prefix", "hand-edited"));
  e.choose(1, "ours", "accept", true);
  expect(sourceText(e.state)).toBe("hand-edited\r\n\r\nleft\r\n\ntail");
  undo(e.view);
  expect(sourceText(e.state)).toBe("hand-edited\r\n\r\nbase\r\ntail");
  undo(e.view);
  expect(sourceText(e.state)).toBe("prefix\r\n\r\nbase\r\ntail");
});

it("does not overwrite a manually edited conflict and explicitly confirms that result", () => {
  const e = editor(model(block(), equal("tail")));
  e.state = syncMergeText(e.state, "manual\n\ntail");
  expect(e.choose(0, "ours", "accept")).toBeNull();
  expect(sourceText(e.state)).toBe("manual\n\ntail");
  const spec = confirmManualRange(e.state, 0)!;
  e.state = e.state.update(spec).state;
  expect(pendingMergeCount(e.state)).toBe(0);
  undo(e.view);
  expect(pendingMergeCount(e.state)).toBe(1);
  undo(e.view);
  expect(e.state.field(mergeRanges)[0]!.manual).toBe(false);
});

it("handles empty base insertions, deletions and adjacent identical conflicts by identity", () => {
  const e = editor(model(block("", "new\n", "other\n"), block("base\n", "", "right\n"), block()));
  e.choose(0, "ours", "accept", true);
  expect(e.state.field(mergeRanges)[1]!.from).toBe(4);
  e.choose(1, "ours", "accept", true);
  expect(sourceText(e.state)).toBe("new\nbase\n");
  e.choose(2, "theirs", "accept", true);
  expect(sourceText(e.state)).toBe("new\nright\n");
  expect(pendingMergeCount(e.state)).toBe(0);
  undo(e.view);
  undo(e.view);
  undo(e.view);
  expect(sourceText(e.state)).toBe("base\nbase\n");
});

it("retains source content around the selected block in a large merge", () => {
  const merge = model(...Array.from({ length: 5000 }, () => block()));
  const e = editor(merge);
  e.choose(4999, "theirs", "accept", true);
  expect(sourceText(e.state)).toBe("base\n".repeat(4999) + "right\n");
  expect(pendingMergeCount(e.state)).toBe(4999);
  expect(e.choose(4999, "ours", "accept")).toBeNull();
});

it("accepts 5,000 conflicts as a single undo step and keeps all adjacent ranges correct", () => {
  const merge = model(...Array.from({ length: 5000 }, () => block()));
  const e = editor(merge);
  e.state = e.state.update(decideAllMergeSide(e.state, merge, "theirs")!).state;
  expect(sourceText(e.state)).toBe("right\n".repeat(5000));
  expect(pendingMergeCount(e.state)).toBe(0);
  expect(e.state.field(mergeRanges).at(-1)!.from).toBe(4999 * 6);
  undo(e.view);
  expect(sourceText(e.state)).toBe("base\n".repeat(5000));
  expect(pendingMergeCount(e.state)).toBe(5000);
});
