import { expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { DiffHunk } from "@/lib/backend";
import { fileChangeHighlights } from "./fileChangeHighlights";

it("reuses ranges for selection/viewport transactions and maps edits without rescanning the file", () => {
  let reads = 0;
  const hunk = {
    newStart: 2,
    get lines() {
      reads++;
      return ["-old", "+new", "\\ No newline"];
    },
  } as DiffHunk;
  const field = fileChangeHighlights([hunk]);
  let state = EditorState.create({ doc: "first\nnew\nlast", extensions: [field] });
  const marks = state.field(field);
  const baseline = reads;
  for (let i = 0; i < 200; i++) {
    state = state.update({ selection: { anchor: i % state.doc.length } }).state;
    expect(state.field(field)).toBe(marks);
  }
  expect(reads).toBe(baseline);
  state = state.update({ changes: { from: 0, insert: "inserted\n" } }).state;
  const cursor = state.field(field).iter();
  expect(cursor.from).toBe(state.doc.line(3).from);
  expect(cursor.value?.spec.class).toBe("cm-file-modified");
  expect(reads).toBe(baseline);
});
