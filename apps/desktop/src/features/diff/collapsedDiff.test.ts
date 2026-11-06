import { describe, expect, it } from "vitest";
import { buildCollapsedSides, countHunkLines } from "./collapsedDiff";
import type { DiffHunk } from "@/lib/backend";

describe("buildCollapsedSides", () => {
  it("aligns delete/insert runs and marks changed lines", () => {
    const hunks: DiffHunk[] = [
      {
        index: 0,
        header: "@@ -1,3 +1,3 @@",
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [" context", "-old", "+new", " tail"],
      },
    ];
    const { left, right } = buildCollapsedSides(hunks);
    expect(left.text.split("\n")).toEqual(["context", "old", "tail"]);
    expect(right.text.split("\n")).toEqual(["context", "new", "tail"]);
    expect(left.changed.has(2)).toBe(true);
    expect(right.changed.has(2)).toBe(true);
    expect(countHunkLines(hunks)).toBe(4);
  });
});
